"""CLI entrypoint: sync every configured league into the warehouse.

Separate from `fantasy_ingest.warehouse`'s own `main()` (which syncs the
platform-wide teams/players catalogs) — different trigger, different data,
same manual-invocation state as the rest of this repo (no scheduler yet).
"""

from fantasy_ingest.league_config import build_league_sync_jobs
from fantasy_ingest.warehouse import sync_all_leagues


def main() -> None:
    jobs = build_league_sync_jobs()
    if not jobs:
        print("sync_leagues: no leagues configured — see .env.example")
        return

    results = sync_all_leagues(jobs)
    for key, result in results.items():
        if "error" in result:
            print(f"{key}: FAILED — {result['error']}")
        else:
            print(
                f"{key}: {result['teams']} teams, {result['weekly_scores']} weekly scores, "
                f"{result['roster_players']} roster rows"
            )


if __name__ == "__main__":
    main()
