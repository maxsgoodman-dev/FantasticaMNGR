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
from fantasy_ingest.sources.fpl_community_sheet import fetch_fpl_sheet_data


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


def _projection_rows(adapter: FantasySourceAdapter, week: int) -> list[dict]:
    return [
        {
            "source_id": adapter.source,
            "sport_id": adapter.sport,
            "week": week,
            "external_player_id": projection.player_external_id,
            "projected_points": projection.projected_points,
        }
        for projection in adapter.fetch_projections(week)
    ]


def sync_projections(
    adapter: FantasySourceAdapter, week: int, client: httpx.Client | None = None
) -> dict[str, int]:
    """Fetch one adapter's current-week projections and upsert them.

    Separate from sync_adapter (platform-wide teams/players, no week
    dimension) since this is a different table with a different natural
    cadence — a caller discovers `week` itself (FPLAdapter.current_gameweek
    / SleeperAdapter.current_week) rather than this function guessing it,
    so each adapter's own current-week logic stays in exactly one place.
    """
    owns_client = client is None
    client = client or _client()
    try:
        rows = _projection_rows(adapter, week)
        if rows:
            response = client.post(
                "/player_projections?on_conflict=source_id,sport_id,week,external_player_id", json=rows
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"projections": len(rows)}


def _next_week_projection_rows(adapter: FantasySourceAdapter, week: int) -> list[dict]:
    return [
        {
            "source_id": adapter.source,
            "sport_id": adapter.sport,
            "week": week,
            "external_player_id": projection.player_external_id,
            "projected_points": projection.projected_points,
        }
        for projection in adapter.fetch_next_week_projections()
    ]


def sync_next_week_projections(adapter: FantasySourceAdapter, client: httpx.Client | None = None) -> dict[str, int]:
    """Fetch and upsert next-gameweek projections (ep_next) at
    week = adapter.current_gameweek() + 1, into the same
    player_projections table sync_projections uses for the current week.

    FPL-only for now: fetch_next_week_projections isn't part of the
    FantasySourceAdapter interface — Sleeper/ESPN have no confirmed
    equivalent "look ahead" endpoint. See
    docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
    """
    owns_client = client is None
    client = client or _client()
    try:
        week = adapter.current_gameweek() + 1
        rows = _next_week_projection_rows(adapter, week)
        if rows:
            response = client.post(
                "/player_projections?on_conflict=source_id,sport_id,week,external_player_id", json=rows
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"projections": len(rows)}


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


def _h2h_fixture_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": fixture.team_external_id,
            "week": fixture.week,
            "opponent_external_team_id": fixture.opponent_external_id,
        }
        for fixture in result.h2h_fixtures
    ]


def _entry_gameweek_stat_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": stat.team_external_id,
            "week": stat.week,
            "event_transfers": stat.event_transfers,
            "event_transfers_cost": stat.event_transfers_cost,
            "points_on_bench": stat.points_on_bench,
            "bank": stat.bank,
            "team_value": stat.team_value,
            "overall_rank": stat.overall_rank,
            "active_chip": stat.active_chip,
        }
        for stat in result.entry_gameweek_stats
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
        # `league["name"]` is only ever the placeholder league_config.py
        # built before any fetch happened (it has nothing better — just a
        # numeric ID). The adapter's fetch just pulled the platform's own
        # real league name (Sleeper's league.name, FPL standings'
        # league.name); prefer that whenever the fetch actually got one.
        league_row_source = {**league, "name": result.league_name or league["name"]}
        response = client.post(
            "/leagues?on_conflict=source_id,external_league_id", json=[_league_row(league_row_source)]
        )
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

        fixture_rows = _h2h_fixture_rows(league, result)
        if fixture_rows:
            response = client.post(
                "/h2h_fixtures?on_conflict=source_id,external_league_id,external_team_id,week", json=fixture_rows
            )
            response.raise_for_status()

        entry_stat_rows = _entry_gameweek_stat_rows(league, result)
        if entry_stat_rows:
            response = client.post(
                "/fpl_entry_gameweek_stats?on_conflict=source_id,external_league_id,external_team_id,week",
                json=entry_stat_rows,
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {
        "teams": len(team_rows),
        "weekly_scores": len(score_rows),
        "roster_players": len(roster_rows),
        "h2h_fixtures": len(fixture_rows),
        "entry_gameweek_stats": len(entry_stat_rows),
    }


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


def sync_fpl_sheet(client: httpx.Client | None = None) -> dict[str, int]:
    """Fetch + upsert the community FPL sheet's Data tab.

    Same PostgREST upsert pattern as everything else, targeting
    `fpl_sheet_player_data` on `(external_player_id, data_fetched)` — a
    rerun on the same UTC day is always a no-op update, not a duplicate
    row, even if the scheduled sync runs multiple times before the
    sheet's own next daily refresh.
    """
    owns_client = client is None
    client = client or _client()
    try:
        rows = fetch_fpl_sheet_data()
        if rows:
            response = client.post(
                "/fpl_sheet_player_data?on_conflict=external_player_id,data_fetched", json=rows
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"fpl_sheet_rows": len(rows)}


def _sync_projections_for(source: str, week_fn: Callable[[], int], adapter: FantasySourceAdapter) -> None:
    # ESPN has no fetch_projections override, so it's simply never passed
    # here — no NotImplementedError to catch, unlike sync_all's per-adapter
    # isolation, which does need to catch a raise.
    try:
        week = week_fn()
        result = sync_projections(adapter, week)
        print(f"{source}: {result['projections']} projections (week {week})")
    except Exception as error:  # noqa: BLE001 - a bad projections pull must not block the catalog sync
        print(f"{source}: projections FAILED — {error}")


def main() -> None:
    from fantasy_ingest.adapters.espn import ESPNAdapter
    from fantasy_ingest.adapters.fpl import FPLAdapter
    from fantasy_ingest.adapters.sleeper import SleeperAdapter

    fpl = FPLAdapter()
    sleeper = SleeperAdapter()

    results = sync_all([fpl, sleeper, ESPNAdapter()])
    for source, result in results.items():
        if "error" in result:
            print(f"{source}: FAILED — {result['error']}")
        else:
            print(f"{source}: {result['teams']} teams, {result['players']} players")

    # Projections are FPL/Sleeper-only (ESPN has no per-player projection
    # endpoint reachable without a league-scoped call) — see
    # docs/superpowers/specs/2026-09-10-matchup-prep-design.md.
    _sync_projections_for("fpl", fpl.current_gameweek, fpl)
    _sync_projections_for("sleeper", sleeper.current_week, sleeper)

    try:
        next_week_result = sync_next_week_projections(fpl)
        print(f"fpl-next-week-projections: {next_week_result['projections']} projections")
    except Exception as error:  # noqa: BLE001 - a bad next-week pull must not block everything else
        print(f"fpl-next-week-projections: FAILED — {error}")

    try:
        sheet_result = sync_fpl_sheet()
        print(f"fpl-community-sheet: {sheet_result['fpl_sheet_rows']} rows")
    except Exception as error:  # noqa: BLE001 - a bad sheet pull must not block everything else
        print(f"fpl-community-sheet: FAILED — {error}")


if __name__ == "__main__":
    main()
