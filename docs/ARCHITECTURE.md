# Architecture

Fantasy Analytics Dashboard pulls data from multiple, unaffiliated fantasy
sports platforms and turns it into cross-league analytics behind a single
dashboard. The pipeline is designed in five stages; only the first and last
are built today.

## 1. Source adapters — **built** (FPL, ESPN)

One adapter per platform (FPL, ESPN, Sleeper, Yahoo, ...), each implementing
a common `FantasySourceAdapter` interface (`fetch_players`, `fetch_teams`,
`fetch_matchups`) and normalizing that platform's response shape into shared
`Player` and `Team` models. This keeps every downstream stage platform-agnostic.

Lives in `services/ingestion/fantasy_ingest/`. Currently implemented:

- **FPL (`adapters/fpl.py`)** — fetches the public
  `bootstrap-static` endpoint and normalizes `elements` → `Player` and
  `teams` → `Team`. HTTP fetching is split from normalization so the mapping
  logic is unit-testable without a network call.
- **ESPN (`adapters/espn.py`)** — fetches the public site-API `/teams` list,
  then each team's `/roster` (32 calls total; ESPN's core API `/athletes`
  list is paginated `$ref` links, one HTTP call per player, not viable for
  a full-league pull). **Response shape unverified against a live call** —
  this sandbox's egress proxy blocks `site.api.espn.com`, so the endpoint
  URLs and fields come from cross-referenced public documentation, not a
  captured response. Normalization is written defensively (skip malformed
  entries, don't crash) for exactly this reason — see the module docstring.
  `price`/`total_points`/`form` are left at 0 (no built-in per-player salary
  in standard ESPN leagues; points need a league-scoped stats view not
  implemented yet).

Not yet implemented: Sleeper, Yahoo adapters; FPL and ESPN head-to-head
matchup data, both of which need a league ID (ESPN's private leagues
additionally need `espn_s2`/`SWID` auth cookies) not available yet.

## 2. Scheduled sync / polling — **planned**

A scheduler that polls each connected source on an interval, tightening the
interval during live games (e.g. Sunday NFL windows, active PL matchdays) and
backing off between them. Not built yet — `services/ingestion` currently only
exposes adapters that fetch and normalize in-process, invoked on demand.

## 3. Shared warehouse — **planned**

A Postgres database holding normalized players, teams, matchups, and
historical snapshots across all connected leagues and platforms, so
analytics can run across sources instead of per-adapter. Not stood up yet.

## 4. Analytics / mart layer — **planned** (one piece built standalone)

Derived metrics computed from the warehouse, e.g.:

- Consistency score (variance of weekly output)
- Opportunity / target share, red zone efficiency
- Matchup-adjusted projections (offense/defense)
- Trade value and player-vs-player comparisons
- Team strength/weakness breakdowns, automated trade-opportunity detection

`services/fpl-planner` is a first, standalone piece of this layer for FPL
specifically: historical player data (2016-17 → 2026-27, two sources) plus
a squad/starting-XI optimiser (linear programming via PuLP). It is not yet
wired to a warehouse — it loads its own CSVs in-process, the same
placeholder-architecture pattern `services/ingestion` uses. See
`services/fpl-planner/docs/` for data provenance and the optimiser's
methodology/known gaps (notably: no fixture-difficulty term yet).

## 5. Dashboard UI — **placeholder built**

`apps/web` is a Next.js (App Router) app. Today it renders a static shell —
an empty "Leagues" nav and a "coming soon" main panel — with no data wired
up. It will eventually read from the mart layer via an API layer (not yet
designed).

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
