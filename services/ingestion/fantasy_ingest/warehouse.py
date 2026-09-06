"""Sync adapter output into the Supabase warehouse.

Talks to Supabase's PostgREST API directly over httpx (no supabase-py
dependency, consistent with the rest of this package) using the service
role key, which bypasses the row-level-security policies that restrict
the anon/publishable key (used by apps/web) to read-only.

The two tables this writes to (`teams`, `players`) both have a
`unique(source_id, external_id)` constraint; `on_conflict` + the
`resolution=merge-duplicates` Prefer header turn every POST into an
upsert, so re-running a sync is always safe.
"""

from __future__ import annotations

import os

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter


def _client() -> httpx.Client:
    url = os.environ["SUPABASE_URL"]
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return httpx.Client(
        base_url=f"{url}/rest/v1",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )


def _team_rows(adapter: FantasySourceAdapter) -> list[dict]:
    return [
        {
            "source_id": adapter.source,
            "sport_id": adapter.sport,
            "external_id": team.id,
            "name": team.name,
            "short_name": team.short_name,
        }
        for team in adapter.fetch_teams()
    ]


def _player_rows(adapter: FantasySourceAdapter) -> list[dict]:
    return [
        {
            "source_id": adapter.source,
            "sport_id": adapter.sport,
            "external_id": player.id,
            "name": player.name,
            "team": player.team,
            "position": player.position,
            "price": player.price,
            "total_points": player.total_points,
            "form": player.form,
        }
        for player in adapter.fetch_players()
    ]


def sync_adapter(adapter: FantasySourceAdapter, client: httpx.Client | None = None) -> dict[str, int]:
    """Fetch one adapter's teams and players and upsert them into Supabase."""
    owns_client = client is None
    client = client or _client()
    try:
        team_rows = _team_rows(adapter)
        if team_rows:
            response = client.post("/teams?on_conflict=source_id,external_id", json=team_rows)
            response.raise_for_status()

        player_rows = _player_rows(adapter)
        if player_rows:
            response = client.post("/players?on_conflict=source_id,external_id", json=player_rows)
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"teams": len(team_rows), "players": len(player_rows)}


def sync_all(adapters: list[FantasySourceAdapter]) -> dict[str, dict[str, int]]:
    client = _client()
    try:
        return {adapter.source: sync_adapter(adapter, client=client) for adapter in adapters}
    finally:
        client.close()


def main() -> None:
    from fantasy_ingest.adapters.espn import ESPNAdapter
    from fantasy_ingest.adapters.fpl import FPLAdapter
    from fantasy_ingest.adapters.sleeper import SleeperAdapter

    results = sync_all([FPLAdapter(), SleeperAdapter(), ESPNAdapter()])
    for source, counts in results.items():
        print(f"{source}: {counts['teams']} teams, {counts['players']} players")


if __name__ == "__main__":
    main()
