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

# sync all adapters into the warehouse — needs SUPABASE_URL and
# SUPABASE_SERVICE_ROLE_KEY in the environment (see .env.example)
python -m fantasy_ingest.warehouse
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
`0` rather than faked; ESPN's `/teams` list includes at least one team
id whose `/roster` 404s while others return 200 (confirmed live,
2026-09-06 — an ESPN-side inconsistency, not a URL bug), which is why
`fetch_players()` skips a team whose roster call fails instead of
aborting the whole fetch. The exact roster response body shape is still
inferred from public docs, not a captured payload — see `espn.py`'s
module docstring before trusting it further.

Both `sync_all` (warehouse.py) and `fetch_players` (espn.py) follow the
same rule as a result: one team/adapter failing partway through must
never lose the data that already succeeded around it.

### Network egress is restricted in this sandbox — including to our own Supabase project

`fantasy.premierleague.com`, `api.sleeper.app`, `site.api.espn.com`, *and*
this project's own Supabase host (`*.supabase.co`) are all blocked by
this environment's egress proxy (confirmed via direct `curl`/build
attempts — the proxy denies the connection, not the upstream service).
This is why every adapter's tests use hand-written fixtures instead of
live calls, why `warehouse.py`'s tests use `httpx.MockTransport`, and why
`apps/web`'s Supabase queries (`lib/players.ts`) have an explicit
graceful-failure path (`page.tsx` shows a per-section inline error, the
API route returns `502`) rather than assuming the query succeeds. Don't
spend time trying to `curl` these hosts directly to "verify" something
from inside this environment — it will fail regardless of whether the
code is correct. A normal deployment (Vercel, an unrestricted machine)
does not have this restriction, and the Supabase MCP tools (`execute_sql`,
`apply_migration`, etc.) work fine from here even though direct HTTP
calls to the same project don't — they go through different
infrastructure than this sandbox's own network stack.

### The warehouse (Supabase/Postgres) — `services/ingestion/fantasy_ingest/warehouse.py`

`sports`, `sources`, `teams`, `players` tables (`teams`/`players` keyed
`unique(source_id, external_id)`, so every sync is an upsert). RLS is on
for every table: public `SELECT`, writes require the service role key.
`sync_adapter(adapter)` / `sync_all([...])` fetch one or more adapters'
`teams`/`players` and POST them to Supabase's PostgREST API directly over
httpx (`on_conflict` + `Prefer: resolution=merge-duplicates` — no
`supabase-py` dependency). `apps/web` reads the same tables read-only via
`@supabase/supabase-js` with the anon/publishable key (`lib/supabase.ts`,
`lib/players.ts`) — never the service role key, which stays server-side.

**A real sync has run** (2026-09-06, from the repo owner's own machine —
see the network-egress note above for why it can't be run from this
sandbox): FPL and Sleeper both hold live data now. `sync_all` isolates
one adapter's failure from the rest specifically because of what that
first live run found (ESPN's `/teams`-vs-`/roster` inconsistency above)
— don't assume every table's contents are still the original
hand-seeded fixture values, but don't assume every source has been
successfully synced live either; check `updated_at` per row if it
matters for what you're doing.

`.github/workflows/sync.yml` runs this (and `fantasy_ingest.sync_leagues`)
on a 6-hour cron schedule, plus manual `workflow_dispatch` — see
`docs/ARCHITECTURE.md`'s "Scheduled sync / polling" section for the
required repository secrets. Invoking it by hand
(`python -m fantasy_ingest.warehouse`) still works for local testing.

### `services/fpl-planner` data provenance

The CSVs under `services/fpl-planner/data/` are a point-in-time ingest
(see that package's own `README.md` and `docs/` for full provenance,
known upstream data-quality gotchas, and the squad optimiser's
methodology/config surface). They are not auto-refreshed — re-ingesting
means re-pulling from the two upstream GitHub repos by hand.
