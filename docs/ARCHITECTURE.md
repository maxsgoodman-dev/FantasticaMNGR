# Architecture

Fantasy Analytics Dashboard pulls data from multiple, unaffiliated fantasy
sports platforms and turns it into cross-league analytics behind a single
dashboard. The pipeline is designed in five stages; only the first and last
are built today.

## 1. Source adapters — **built** (FPL only)

One adapter per platform (FPL, ESPN, Sleeper, Yahoo, ...), each implementing
a common `FantasySourceAdapter` interface (`fetch_players`, `fetch_teams`,
`fetch_matchups`) and normalizing that platform's response shape into shared
`Player` and `Team` models. This keeps every downstream stage platform-agnostic.

Lives in `services/ingestion/fantasy_ingest/`. Currently implemented:

- **FPL (`adapters/fpl.py`)** — fetches the public
  `bootstrap-static` endpoint and normalizes `elements` → `Player` and
  `teams` → `Team`. HTTP fetching is split from normalization so the mapping
  logic is unit-testable without a network call.

Not yet implemented: ESPN, Sleeper, Yahoo adapters, and FPL head-to-head
matchup data (`fetch_matchups`), which requires a league ID and manager ID
not available from the public bootstrap endpoint.

## 2. Scheduled sync / polling — **planned**

A scheduler that polls each connected source on an interval, tightening the
interval during live games (e.g. Sunday NFL windows, active PL matchdays) and
backing off between them. Not built yet — `services/ingestion` currently only
exposes adapters that fetch and normalize in-process, invoked on demand.

## 3. Shared warehouse — **planned**

A Postgres database holding normalized players, teams, matchups, and
historical snapshots across all connected leagues and platforms, so
analytics can run across sources instead of per-adapter. Not stood up yet.

## 4. Analytics / mart layer — **planned**

Derived metrics computed from the warehouse, e.g.:

- Consistency score (variance of weekly output)
- Opportunity / target share, red zone efficiency
- Matchup-adjusted projections (offense/defense)
- Trade value and player-vs-player comparisons
- Team strength/weakness breakdowns, automated trade-opportunity detection

## 5. Dashboard UI — **placeholder built**

`apps/web` is a Next.js (App Router) app. Today it renders a static shell —
an empty "Leagues" nav and a "coming soon" main panel — with no data wired
up. It will eventually read from the mart layer via an API layer (not yet
designed).

## Future: FPL Manager port-over

Max has a prior "FPL Manager" Claude Project (not a git repo) with an
existing structure/analysis approach for FPL specifically. Porting its
approach into `adapters/fpl.py` and the eventual FPL mart logic is a planned
future step — nothing has been pulled from it yet.

## Reference projects

See the README's "Reference projects" section for prior art this design
draws on.
