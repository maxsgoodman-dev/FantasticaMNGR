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
from typing import Callable

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.league_models import LeagueSyncResult


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


def sync_all(adapters: list[FantasySourceAdapter], client: httpx.Client | None = None) -> dict[str, dict]:
    """Sync every adapter, one failure at a time.

    One adapter's data being temporarily broken (a bad endpoint, a
    format change) shouldn't stop the others from syncing — each result
    is either the normal `{"teams": N, "players": N}` count dict or
    `{"error": "..."}` if that adapter raised.
    """
    owns_client = client is None
    client = client or _client()
    results: dict[str, dict] = {}
    try:
        for adapter in adapters:
            try:
                results[adapter.source] = sync_adapter(adapter, client=client)
            except Exception as error:  # noqa: BLE001 - deliberately broad, see docstring
                results[adapter.source] = {"error": str(error)}
    finally:
        if owns_client:
            client.close()
    return results


def _league_row(league: dict) -> dict:
    return {
        "source_id": league["source_id"],
        "sport_id": league["sport_id"],
        "external_league_id": league["external_league_id"],
        "name": league["name"],
        "season": league["season"],
        "format": league["format"],
    }


def _fantasy_team_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": team.external_id,
            "team_name": team.name,
            "owner_name": team.owner_name,
            "is_mine": team.is_mine,
        }
        for team in result.teams
    ]


def _weekly_score_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": score.team_external_id,
            "week": score.week,
            "points": score.points,
            "opponent_external_team_id": score.opponent_external_id,
        }
        for score in result.weekly_scores
    ]


def _roster_player_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": entry.team_external_id,
            "week": entry.week,
            "player_external_id": entry.player_external_id,
            "player_name": entry.player_name,
            "is_starter": entry.is_starter,
            "points": entry.points,
        }
        for entry in result.roster_players
    ]


def sync_league_data(
    league: dict, result: LeagueSyncResult, client: httpx.Client | None = None
) -> dict[str, int]:
    """Upsert one league's already-fetched sync result into the warehouse.

    `league` describes the league itself (source_id, sport_id,
    external_league_id, name, season, format); `result` is what
    `fetch_league_data` / `fetch_h2h_league_data` / `fetch_classic_league_data`
    returned. Kept separate from `sync_adapter` (which syncs the platform-wide
    teams/players catalogs, untouched by this function).
    """
    owns_client = client is None
    client = client or _client()
    try:
        response = client.post("/leagues?on_conflict=source_id,external_league_id", json=[_league_row(league)])
        response.raise_for_status()

        team_rows = _fantasy_team_rows(league, result)
        if team_rows:
            response = client.post(
                "/fantasy_teams?on_conflict=source_id,external_league_id,external_team_id", json=team_rows
            )
            response.raise_for_status()

        score_rows = _weekly_score_rows(league, result)
        if score_rows:
            response = client.post(
                "/weekly_scores?on_conflict=source_id,external_league_id,external_team_id,week", json=score_rows
            )
            response.raise_for_status()

        roster_rows = _roster_player_rows(league, result)
        if roster_rows:
            response = client.post(
                "/roster_players?on_conflict=source_id,external_league_id,external_team_id,week,player_external_id",
                json=roster_rows,
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"teams": len(team_rows), "weekly_scores": len(score_rows), "roster_players": len(roster_rows)}


def sync_all_leagues(
    jobs: list[tuple[dict, Callable[[], LeagueSyncResult]]], client: httpx.Client | None = None
) -> dict[str, dict]:
    """Fetch and sync every configured league, isolating one league's failure.

    Each job is `(league, fetch_fn)` — `fetch_fn` is called here (not before),
    so a fetch-time failure is caught per-league too, same as an upsert
    failure, matching sync_all's isolation guarantee for the platform-wide
    catalogs.
    """
    owns_client = client is None
    client = client or _client()
    results: dict[str, dict] = {}
    try:
        for league, fetch_fn in jobs:
            key = f"{league['source_id']}:{league['external_league_id']}"
            try:
                result = fetch_fn()
                results[key] = sync_league_data(league, result, client=client)
            except Exception as error:  # noqa: BLE001 - deliberately broad, see sync_all's docstring
                results[key] = {"error": str(error)}
    finally:
        if owns_client:
            client.close()
    return results


def main() -> None:
    from fantasy_ingest.adapters.espn import ESPNAdapter
    from fantasy_ingest.adapters.fpl import FPLAdapter
    from fantasy_ingest.adapters.sleeper import SleeperAdapter

    results = sync_all([FPLAdapter(), SleeperAdapter(), ESPNAdapter()])
    for source, result in results.items():
        if "error" in result:
            print(f"{source}: FAILED — {result['error']}")
        else:
            print(f"{source}: {result['teams']} teams, {result['players']} players")


if __name__ == "__main__":
    main()
