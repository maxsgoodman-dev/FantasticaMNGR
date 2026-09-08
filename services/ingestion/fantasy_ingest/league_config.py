"""Build the league-scoped sync jobs from environment configuration.

Each job is `(league, fetch_fn)`, the shape `warehouse.sync_all_leagues`
expects. Season strings are hardcoded to the current season — bump
CURRENT_NFL_SEASON / CURRENT_FPL_SEASON here once a year; they're only a
display label, not used for any lookup.
"""

import os

from fantasy_ingest.adapters.fpl import FPLAdapter
from fantasy_ingest.adapters.sleeper import SleeperAdapter

CURRENT_NFL_SEASON = "2026"
CURRENT_FPL_SEASON = "2026-27"


def build_league_sync_jobs() -> list[tuple[dict, callable]]:
    jobs: list[tuple[dict, callable]] = []

    sleeper_user_id = os.environ.get("SLEEPER_USER_ID")
    if sleeper_user_id:
        league_ids = [x for x in os.environ.get("SLEEPER_LEAGUE_IDS", "").split(",") if x]
        adapter = SleeperAdapter()
        for league_id in league_ids:
            league = {
                "source_id": "sleeper",
                "sport_id": "nfl",
                "external_league_id": league_id,
                "name": f"Sleeper league {league_id}",
                "season": CURRENT_NFL_SEASON,
                "format": "head_to_head",
            }
            jobs.append((league, lambda a=adapter, lid=league_id: a.fetch_league_data(lid, sleeper_user_id)))

    fpl_entry_id = os.environ.get("FPL_ENTRY_ID")
    if fpl_entry_id:
        adapter = FPLAdapter()

        h2h_league_id = os.environ.get("FPL_H2H_LEAGUE_ID")
        if h2h_league_id:
            league = {
                "source_id": "fpl",
                "sport_id": "premier-league",
                "external_league_id": h2h_league_id,
                "name": f"FPL h2h league {h2h_league_id}",
                "season": CURRENT_FPL_SEASON,
                "format": "head_to_head",
            }
            jobs.append((league, lambda a=adapter, lid=h2h_league_id: a.fetch_h2h_league_data(lid, fpl_entry_id)))

        classic_league_id = os.environ.get("FPL_CLASSIC_LEAGUE_ID")
        if classic_league_id:
            league = {
                "source_id": "fpl",
                "sport_id": "premier-league",
                "external_league_id": classic_league_id,
                "name": f"FPL classic league {classic_league_id}",
                "season": CURRENT_FPL_SEASON,
                "format": "classic",
            }
            jobs.append(
                (league, lambda a=adapter, lid=classic_league_id: a.fetch_classic_league_data(lid, fpl_entry_id))
            )

    return jobs
