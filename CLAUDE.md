# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A multi-league fantasy sports analytics tool: ingests data from separate,
unaffiliated fantasy platforms (NFL — ESPN, Sleeper, Yahoo; soccer —
Fantasy Premier League) and will eventually turn it into cross-platform
projections, matchup analysis, and trade-opportunity detection behind one
dashboard. See `docs/ARCHITECTURE.md` for the full pipeline design and
what's built vs. planned at each stage.

## Repo layout — three independent subprojects, no shared root tooling

There is no root `package.json`/`pyproject.toml`/lockfile tying these
together. Each has its own dependency management and must be set up
separately:

- `apps/web/` — Next.js (App Router) + TypeScript + Tailwind dashboard.
- `services/ingestion/` — Python package (`fantasy_ingest`), **live**
  source adapters (current-season data via public APIs).
- `services/fpl-planner/` — Python package (`fpl_planner`), **historical**
  FPL data (2016-27, two upstream sources) + a squad/XI LP optimiser.
  FPL-only; not merged with `services/ingestion`'s live FPL adapter yet
  (open item, see `docs/ARCHITECTURE.md`).

## Commands

### apps/web
```bash
cd apps/web && npm install
npm run dev      # http://localhost:3000
npm run build    # production build; also type-checks and lints
```

### services/ingestion
```bash
cd services/ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -e . pytest
pytest                                              # all tests
pytest tests/test_fpl_adapter.py -v                 # one adapter
pytest tests/test_fpl_adapter.py::test_normalize_players -v  # one test
```

### services/fpl-planner
```bash
cd services/fpl-planner
python3 -m venv .venv && source .venv/bin/activate
pip install -e . pytest
pytest
python -m fpl_planner.optimise --use-defaults       # run the optimiser CLI
python -m fpl_planner.optimise --use-defaults --lock <code> --exclude <code>
```

## Architecture notes that span multiple files

### The adapter interface (`services/ingestion/fantasy_ingest/adapters/`)

Every platform adapter subclasses `FantasySourceAdapter` (`base.py`) and
implements `fetch_players()` / `fetch_teams()` / `fetch_matchups()`,
returning the shared `Player`/`Team` dataclasses from `models.py`. Two
class attributes are required on every adapter: `source` (e.g. `"fpl"`)
and `sport` (`"nfl"` or `"premier-league"` today — a platform never spans
sports, and the dashboard nav groups by this).

Convention followed by every adapter: split the HTTP fetch from a pure
`_normalize_*(raw_json)` function, so normalization is unit-testable with
a hand-written fixture and no network call. `fetch_matchups()` raises
`NotImplementedError` on every current adapter — head-to-head data is
league-scoped and no adapter has a league ID to call it with yet.

fpl.py, sleeper.py, and espn.py each also document real cross-platform
gotchas worth knowing before touching them: FPL's `now_cost` is tenths of
a £m while fpl-core's own `now_cost` (in `services/fpl-planner`) is
already in £m; Sleeper/ESPN have no per-player salary or points endpoint
usable without a league ID, so `price`/`total_points`/`form` are left at
`0` rather than faked; ESPN's roster response shape is documented from
public references, not a captured live response (see `espn.py`'s module
docstring) — verify before trusting it in production.

### Network egress is restricted in this sandbox

`fantasy.premierleague.com`, `api.sleeper.app`, and `site.api.espn.com`
are all blocked by this environment's egress proxy (confirmed via direct
`curl`/build attempts — 403 at the proxy, not the upstream API). This is
why every adapter's tests use hand-written fixtures instead of live
calls, and why `apps/web`'s live FPL fetch (`lib/fpl.ts`) has an explicit
graceful-failure path (`page.tsx` shows an inline error, the API route
returns `502`) rather than assuming the fetch succeeds. Don't spend time
trying to `curl` these APIs directly to "verify" an adapter from inside
this environment — it will fail regardless of whether the adapter code
is correct. A normal deployment (Vercel, an unrestricted machine) does
not have this restriction.

### `apps/web`'s FPL logic is a hand-synced port, not shared code

`apps/web/lib/fpl.ts` reimplements the same normalization as
`services/ingestion/fantasy_ingest/adapters/fpl.py` in TypeScript, since
the Next.js app and the Python ingestion service don't share a runtime.
If you change FPL's normalization logic in one, check whether the other
needs the same change — there's no build step or generator keeping them
in sync.

### No warehouse yet — everything fetches and normalizes in-process

Neither `services/ingestion` nor `services/fpl-planner` writes to a
database. Both are invoked on demand and return in-memory data. The
planned Postgres warehouse (stage 3 in `docs/ARCHITECTURE.md`) doesn't
exist yet; when it's built, Supabase is the intended host (already
connected as an MCP tool in Claude Code sessions on this project — no
separate credential setup needed).

### `services/fpl-planner` data provenance

The CSVs under `services/fpl-planner/data/` are a point-in-time ingest
(see that package's own `README.md` and `docs/` for full provenance,
known upstream data-quality gotchas, and the squad optimiser's
methodology/config surface). They are not auto-refreshed — re-ingesting
means re-pulling from the two upstream GitHub repos by hand.
