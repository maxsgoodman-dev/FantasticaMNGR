# fpl-planner

Historical FPL data + a squad/XI optimiser, ingested from two upstream
sources and ported in from a prior "FPL Manager" Claude Project. See
`docs/` for full provenance, data-source notes, and the optimiser's
methodology/known gaps.

## Setup

```bash
cd services/fpl-planner
python3 -m venv .venv
source .venv/bin/activate
pip install -e . pytest
pytest
```

## Layout

```
data/
  fpl-core-insights/2025-2026/, 2026-2027/    olbauday/FPL-Core-Insights snapshot
  vaastav-fpl-history/2016-17 .. 2026-27/     vaastav/Fantasy-Premier-League snapshot
docs/
  data-sources-fpl-core-insights.md
  data-sources-vaastav-fpl-history.md
  analysis-2026-27-optimal-starting-squad.md
fpl_planner/
  loaders.py      load_players / resolve_team / unify_seasons / cross_source_join / available
  config.py       ManagerRules, risk-discount table, default_manager_rules()
  optimise.py     the squad/XI LP optimiser (PuLP + CBC) + a CLI
tests/
```

## Re-ingesting

The data in `data/` is a point-in-time snapshot (this ingest: 2026-09-06).
Both upstream repos are public and update live; to refresh, re-clone them
and re-copy the same files listed in `docs/data-sources-*.md` — there is
no automated re-ingest script yet (see `docs/ARCHITECTURE.md` at the repo
root for the planned scheduled-sync layer this currently lacks).

## Running the optimiser

```bash
python -m fpl_planner.optimise --use-defaults
```

`--use-defaults` starts from the manager's currently agreed rules
(`config.default_manager_rules()`: budget £100.0m, Haaland locked as
captain, the rest of the current squad's locks/excludes). Override or
extend from the CLI:

```bash
python -m fpl_planner.optimise --use-defaults --lock <code> --exclude <code> --allow-lone-striker
```

Player `code`s (not `id`s — `id` is season-scoped) can be found via
`fpl_planner.loaders.load_players("vaastav", "2026-27")`.
