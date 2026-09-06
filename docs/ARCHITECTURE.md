# Architecture

Fantasy Analytics Dashboard pulls data from multiple, unaffiliated fantasy
sports platforms and turns it into cross-league analytics behind a single
dashboard. The pipeline is designed in five stages. Stages 1 and 3 are
built (three source adapters, a Postgres warehouse); stage 5 now reads
from that warehouse instead of one platform's API directly. Stage 2
(scheduling) and stage 4 (a real analytics/mart layer beyond raw rows)
are still open.

## 1. Source adapters — **built** (FPL, Sleeper, ESPN)

One adapter per platform (FPL, ESPN, Sleeper, Yahoo, ...), each implementing
a common `FantasySourceAdapter` interface (`fetch_players`, `fetch_teams`,
`fetch_matchups`) and normalizing that platform's response shape into shared
`Player` and `Team` models. This keeps every downstream stage platform-agnostic.
Each adapter also declares a `sport` (`"nfl"` or `"premier-league"` today —
see stage 5), since a platform never spans sports.

Lives in `services/ingestion/fantasy_ingest/`. Currently implemented:

- **FPL (`adapters/fpl.py`, sport `premier-league`)** — fetches the public
  `bootstrap-static` endpoint and normalizes `elements` → `Player` and
  `teams` → `Team`. HTTP fetching is split from normalization so the mapping
  logic is unit-testable without a network call.
- **Sleeper (`adapters/sleeper.py`, sport `nfl`)** — fetches the public
  `players/nfl` endpoint and normalizes it into `Player`; `Team` is a
  hardcoded 32-team NFL reference table since Sleeper has no "list all
  teams" endpoint (the 32 teams don't get renumbered mid-season the way
  FPL's clubs do). Standard Sleeper leagues draft rather than buy players,
  so there's no salary-cap concept to populate `price` from, and
  `total_points`/`form` would need a separate per-week stats pull this
  adapter doesn't do yet — both are left at 0 with a comment explaining
  why, not faked.
- **ESPN (`adapters/espn.py`, sport `nfl`)** — fetches the public site-API
  `/teams` list, then each team's `/roster` (32 calls total; ESPN's core
  API `/athletes` list is paginated `$ref` links, one HTTP call per
  player, not viable for a full-league pull). **Response shape unverified
  against a live call** — this sandbox's egress proxy blocks
  `site.api.espn.com`, so the endpoint URLs and fields come from
  cross-referenced public documentation, not a captured response.
  Normalization is written defensively (skip malformed entries, don't
  crash) for exactly this reason — see the module docstring.
  `price`/`total_points`/`form` are left at 0, same reasoning as Sleeper's.

Not yet implemented: Yahoo adapter; FPL, Sleeper, and ESPN head-to-head
matchup data, all of which need a league ID (ESPN's private leagues
additionally need `espn_s2`/`SWID` auth cookies) not available yet.

## 2. Scheduled sync / polling — **planned**

A scheduler that polls each connected source on an interval, tightening the
interval during live games (e.g. Sunday NFL windows, active PL matchdays) and
backing off between them. Not built yet. `fantasy_ingest.warehouse.sync_all`
(stage 3) does the actual fetch-and-upsert work already — running it on a
schedule is the remaining piece, not a rewrite. Right now it's invoked
manually (`python -m fantasy_ingest.warehouse`).

## 3. Shared warehouse — **built** (Supabase/Postgres)

A Supabase Postgres project (`fantasticamngr`) with `sports`, `sources`,
`teams`, and `players` tables — `players`/`teams` both carry `source_id`
+ `sport_id` and a `unique(source_id, external_id)` constraint, so a
sync is always an upsert, never a duplicate. Row-level security is
enabled on every table: anyone can `SELECT` (the dashboard's anon key is
bound to this), and only the service role key — held server-side by
`services/ingestion`, never shipped to `apps/web` — can write.

`fantasy_ingest.warehouse.sync_adapter(adapter)` fetches one adapter's
teams and players and upserts them via Supabase's PostgREST API
(`on_conflict` + `Prefer: resolution=merge-duplicates`) — direct httpx
calls, no `supabase-py` dependency, consistent with the rest of this
package. `sync_all([...])` runs every adapter through one shared client.
Tested with `httpx.MockTransport` (no live network call, same pattern as
the adapters' own fixture-based tests).

**The warehouse currently holds hand-seeded data, not a live sync
result** — this sandbox's egress proxy blocks the Supabase project's own
host the same way it blocks the three platforms' APIs (confirmed via
direct `curl` and via `apps/web`'s build/dev-server graceful-failure
path — see stage 5), so `sync_all` has never actually been run against
live upstream data from inside this environment. What's in the tables
now was inserted by hand (via the Supabase SQL editor/MCP tools) using
the same values as the adapters' own test fixtures, specifically to
prove the warehouse → dashboard read path works. Running a real sync
needs to happen from an environment that can reach both the three
platform APIs and Supabase — a normal deployment, not this sandbox.

## 4. Analytics / mart layer — **planned** (one piece built standalone)

Derived metrics computed from the warehouse, e.g.:

- Consistency score (variance of weekly output)
- Opportunity / target share, red zone efficiency
- Matchup-adjusted projections (offense/defense)
- Trade value and player-vs-player comparisons
- Team strength/weakness breakdowns, automated trade-opportunity detection

`services/fpl-planner` is a first, standalone piece of this layer for FPL
specifically: historical player data (2016-17 → 2026-27, two sources) plus
a squad/starting-XI optimiser (linear programming via PuLP). It still
loads its own CSVs in-process rather than reading from the warehouse
(stage 3) — that CSV archive is FPL-only and season-by-season, a
different shape from the warehouse's current-snapshot `players` table,
so merging them is real design work, not a rename. See
`services/fpl-planner/docs/` for data provenance and the optimiser's
methodology/known gaps (notably: no fixture-difficulty term yet).

## 5. Dashboard UI — **reads from the warehouse** (both sports)

`apps/web` is a Next.js (App Router) app. It queries the Supabase
warehouse directly with the `@supabase/supabase-js` client
(`lib/supabase.ts`, `lib/players.ts`) using the anon/publishable key —
RLS restricts that key to `SELECT`, so this is safe to ship to the
browser. The homepage renders a top-10-by-points table per sport
(Premier League, NFL) behind `/api/players?sport=<id>`. This replaces
the earlier direct-to-FPL-API prototype entirely — there's no more
`lib/fpl.ts` or FPL-specific fetch in this app; all platform-specific
logic now lives in `services/ingestion`'s adapters, and `apps/web` only
ever talks to the warehouse. This still isn't the final design (no mart
layer/API layer sits between the warehouse and this app yet — it's a
direct table read), but it's a real database in the loop instead of a
hand-synced port of one platform's parsing logic.

Both fetch paths degrade gracefully on failure, same as before: the page
shows an inline per-section error, the API route returns `502`.

**Sport is a first-class dimension, not just league.** The nav switches
between sports (currently NFL and Premier League; both are the two
`sport` values `FantasySourceAdapter` subclasses declare — see stage 1)
before drilling into that sport's leagues/platforms — not one flat list
mixing an ESPN NFL league with an FPL Premier League squad. NFL groups
ESPN/Sleeper/Yahoo; Premier League currently only has FPL, with room for
other soccer leagues later without renaming this dimension.

## FPL Manager port-over — **done for data + analysis, adapter integration still open**

Max had a prior "FPL Manager" Claude Project (not a git repo, data +
markdown docs only, no code) with an existing structure/analysis approach
for FPL specifically. Its 30 CSVs and 3 markdown docs have been ported
into `services/fpl-planner` (docs reconstructed from a written ingestion
brief, since the originals were only reachable from that Claude Project's
own knowledge base — see `services/fpl-planner/docs/` for the provenance
note on each). Its squad optimiser — never saved as a file, only run as
inline heredocs in a chat session — has been rebuilt from a spec written
down at the same time, at `services/fpl-planner/fpl_planner/optimise.py`.

Still open: `services/fpl-planner` is a separate package from
`services/ingestion`'s live `adapters/fpl.py` — merging the two into one
FPL adapter (live current-season data + this historical archive +
optimiser) is future work, not done here.

## Reference projects

See the README's "Reference projects" section for prior art this design
draws on.
