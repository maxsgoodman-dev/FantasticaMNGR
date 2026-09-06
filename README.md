# Fantasy Analytics Dashboard

A multi-league fantasy sports analytics tool. It ingests data from separate,
unaffiliated fantasy platforms (NFL fantasy hosts like ESPN, Sleeper, and
Yahoo, plus Fantasy Premier League soccer, with room for more later), keeps
it live/regularly updated during games, and will eventually support weekly
player/team projections, offense/defense projections, opportunity/trap
analysis, player-vs-player comparisons for trades and waiver pickups, team
strength/weakness analysis (your own team and every team in the league),
automated trade-opportunity detection, and head-to-head matchup analysis —
all behind a simple dashboard UI.

## Status

Three live source adapters (FPL, Sleeper, ESPN, all via their public APIs),
a historical FPL data + squad optimiser ported in from a prior "FPL Manager"
project, and a dashboard that renders live FPL player data with its nav
grouped by sport (Premier League, NFL) — the first real wiring between a
source adapter and the UI. No shared warehouse yet: the dashboard talks
directly to FPL's API, not through `services/ingestion`. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for what's built vs.
planned.

## Repo structure

```
apps/web/              Next.js (App Router) dashboard — live FPL data, sport-grouped nav
services/ingestion/    Python package of live source adapters (FPL, Sleeper, ESPN)
services/fpl-planner/  Python package: historical FPL data + a squad/XI optimiser (PuLP)
docs/ARCHITECTURE.md   Proposed pipeline: adapters → sync → warehouse → analytics → UI
```

## Setup

### apps/web (Next.js dashboard)

```bash
cd apps/web
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

### services/ingestion (Python live adapters)

```bash
cd services/ingestion
python3 -m venv .venv
source .venv/bin/activate
pip install -e . pytest
pytest
```

### services/fpl-planner (Python historical data + optimiser)

```bash
cd services/fpl-planner
python3 -m venv .venv
source .venv/bin/activate
pip install -e . pytest
pytest
python -m fpl_planner.optimise --use-defaults
```

See [`services/fpl-planner/README.md`](services/fpl-planner/README.md) and
its `docs/` for data provenance and the optimiser's methodology/known gaps.

## Reference projects

- [darkonda/fantasy](https://github.com/darkonda/fantasy) — multi-league
  scoreboard aggregator (ESPN + Sleeper), Flask + BigQuery, live scoring and
  adaptive projections. Closest existing model for "multiple unaffiliated
  leagues, one dashboard."
- [anrg-bot/nfl-fantasy-data-pipeline](https://github.com/anrg-bot/nfl-fantasy-data-pipeline) —
  nfl_data_py → Snowflake → dbt → Power BI pipeline. Useful mart-level metric
  ideas: consistency score, red zone efficiency, ROI vs. salary.
- Max's prior "FPL Manager" Claude Project (not a git repo) has been
  ported into `services/fpl-planner`: its 30 CSVs of historical FPL data
  and 3 markdown docs were ingested (docs reconstructed from the ingestion
  brief — see `services/fpl-planner/docs/` for provenance notes), and its
  squad optimiser was rebuilt from spec (the original was never saved as
  a file — see `services/fpl-planner/docs/analysis-2026-27-optimal-starting-squad.md`).
