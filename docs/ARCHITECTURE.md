# Architecture

Fantasy Analytics Dashboard pulls data from multiple, unaffiliated fantasy
sports platforms and turns it into cross-league analytics behind a single
dashboard. The pipeline is designed in five stages; only the first and last
are built today.

## 1. Source adapters — **built** (FPL, Sleeper)

One adapter per platform (FPL, ESPN, Sleeper, Yahoo, ...), each implementing
a common `FantasySourceAdapter` interface (`fetch_players`, `fetch_teams`,
`fetch_matchups`) and normalizing that platform's response shape into shared
`Player` and `Team` models. This keeps every downstream stage platform-agnostic.

Lives in `services/ingestion/fantasy_ingest/`. Currently implemented:

- **FPL (`adapters/fpl.py`)** — fetches the public
  `bootstrap-static` endpoint and normalizes `elements` → `Player` and
  `teams` → `Team`. HTTP fetching is split from normalization so the mapping
  logic is unit-testable without a network call.
- **Sleeper (`adapters/sleeper.py`)** — fetches the public `players/nfl`
  endpoint and normalizes it into `Player`; `Team` is a hardcoded 32-team
  NFL reference table since Sleeper has no "list all teams" endpoint (the
  32 teams don't get renumbered mid-season the way FPL's clubs do).
  Standard Sleeper leagues draft rather than buy players, so there's no
  salary-cap concept to populate `price` from, and `total_points`/`form`
  would need a separate per-week stats pull this adapter doesn't do yet —
  both are left at 0 with a comment explaining why, not faked.

Not yet implemented: ESPN, Yahoo adapters; FPL head-to-head matchup data
(needs a league ID + manager ID, not available from the public bootstrap
endpoint); Sleeper matchups (needs a league ID, same shape of gap).

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
