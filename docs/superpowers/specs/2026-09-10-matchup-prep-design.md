# Matchup Prep (In-Between-Games Analysis) — Design

## Context

This is the feature the dashboard was actually built for, per the user:
in-between-games analysis for an active head-to-head matchup — am I
favored, where is my roster weak, and what does my opponent's roster
look like. Everything shipped so far (design system, trade value, team
strength, consistency scores) is retrospective — it describes what
already happened. This is the first forward-looking piece.

Confirmed with the user:
- Core questions, in priority order: win probability for the current
  matchup, roster weak-spot detection, opponent roster scouting. Trade
  suggestions explicitly out of scope for this slice.
- Win probability must come from **real per-player projections** pulled
  from the platform APIs, not a heuristic derived from historical
  averages.

## Scope-defining finding: "next week" doesn't exist yet

Both `FPLAdapter.fetch_h2h_league_data`/`fetch_classic_league_data` and
`SleeperAdapter.fetch_league_data` only ever sync roster/lineup data for
`range(1, current_week + 1)` — through the current week, never beyond.
Neither platform reliably exposes next week's set lineup before it's
locked in. So "matchup prep" targets the **current, in-progress week**
(already-synced roster) rather than a future one — which is a better fit
for "in-between games" anyway: you're checking this mid-week, before that
week's games have all been played, not before the matchup starts.

This also scopes the feature to **Sleeper and FPL only**. ESPN's adapter
only pulls the platform-wide player catalog — no ESPN league was ever
league-scoped-synced (confirmed: the sidebar's league list has zero ESPN
entries), so there's no ESPN roster/matchup data for this feature to
attach to.

## Platform feasibility (verified live from this sandbox)

Direct network egress to all three platform APIs actually works from
this environment (`curl` confirmed 200s from `api.sleeper.app`,
`fantasy.premierleague.com`, and `site.api.espn.com`) — the network-egress
restriction documented in root `CLAUDE.md` is stale and gets corrected as
part of this slice (see "Also fixing" below).

- **FPL**: `bootstrap-static` (already fetched by every sync) includes
  `ep_next` (expected points, next gameweek) per element. Zero new HTTP
  calls — just map an existing field we've been discarding.
- **Sleeper**: new endpoint,
  `GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular`
  — one call returns projections for **all ~9,400 NFL players** (no
  position filter needed, no pagination). Verified shape: `player_id`,
  `week`, `season`, `stats.pts_ppr` (also `pts_std`/`pts_half_ppr` —
  using `pts_ppr` for v1, since Sleeper's own default scoring is PPR;
  documenting this as a known simplification, not per-league-scoring-aware).

## Architecture

### New table: `player_projections`

Platform-wide and week-scoped, like `players` plus a week dimension —
not league-scoped, since a player's projection doesn't depend on which
fantasy team owns them. Mirrors `fpl_player_season_stats`'s shape as
ingested-external-data (a real table, not a view over existing rows).

```sql
create table public.player_projections (
  id bigint generated always as identity primary key,
  source_id text not null references public.sources(id),
  sport_id text not null references public.sports(id),
  week integer not null,
  external_player_id text not null,
  projected_points numeric not null,
  updated_at timestamptz not null default now(),
  unique (source_id, sport_id, week, external_player_id)
);
-- RLS: public SELECT, no write policy — matches every other warehouse table.
```

### Ingestion

- `FantasySourceAdapter` gets a new **non-abstract** method
  `fetch_projections(week: int) -> list[PlayerProjection]`, default
  `raise NotImplementedError` (ESPN never overrides it — same pattern as
  `fetch_matchups` today).
- New `PlayerProjection` dataclass in `models.py`:
  `player_external_id: str`, `projected_points: float`.
- `FPLAdapter.fetch_projections`: reuses the already-fetched
  `bootstrap-static` elements, maps `ep_next` → `projected_points`.
- `SleeperAdapter.fetch_projections`: new call to the projections
  endpoint above, maps `player_id`/`stats.pts_ppr`.
- `warehouse.py` gets `sync_projections(adapter, week, client)` —
  same upsert-via-PostgREST pattern as `sync_adapter`, targeting the new
  table. The "current week" for each platform is discovered the same way
  the existing league sync already does (`_current_gameweek` for FPL,
  `/state/nfl` for Sleeper) — platform-wide, not tied to a specific
  league, so this doesn't need a league id.
- Wired into the existing scheduled sync (`.github/workflows/sync.yml`)
  alongside the current `warehouse` + `sync_leagues` steps.

### Mart layer: `matchup_preview` view

Joins each head-to-head team's current-week starters
(`roster_players` where `is_starter`) against `player_projections` on
`player_external_id`, summed to a projected team total. Exposed the same
way `fantasy_team_strength` is — one row per `(source_id,
external_league_id, external_team_id, week)`.

```sql
create view public.matchup_preview as
select
  rp.source_id,
  rp.external_league_id,
  rp.external_team_id,
  rp.week,
  sum(pp.projected_points) as projected_points,
  count(*) filter (where pp.projected_points is null) as starters_missing_projection
from public.roster_players rp
left join public.player_projections pp
  on pp.source_id = rp.source_id
 and pp.external_player_id = rp.player_external_id
 and pp.week = rp.week
where rp.is_starter
group by rp.source_id, rp.external_league_id, rp.external_team_id, rp.week;
```

`starters_missing_projection` surfaces gaps honestly (bye weeks,
newly-added players, a player Sleeper's projections don't cover) instead
of silently treating a missing projection as zero.

### UI — league page, current week only

When the browsed week **is** `latestWeek` (the toggle already exists —
this is the same condition driving today's live-pulse dot) and the
league is head-to-head with an opponent:

- Replace/extend the existing stat-tile row with a **Projected** variant
  alongside **Actual**: projected team total for both sides, and a
  simple win-probability figure derived from the projected margin (v1:
  a fixed logistic curve over the projected point differential — not a
  full statistical model; documented as a known simplification).
- **Weak spots**: flag starters whose `player_trade_value` (already
  computed) is in the bottom quartile of that team's starters, or whose
  `coefficient_of_variation` is above a threshold (high variance) —
  reusing data already on the page, no new query beyond what
  `fetchPlayerValues` already returns.
- **Opponent scouting**: surface the opponent's `fantasy_team_strength`
  row (avg/wk, stddev, best/worst week) prominently — already fetched
  for the standings table, just needs surfacing at the matchup level
  too.
- When viewing a **past** week (not `latestWeek`), none of this
  renders — the page stays exactly as it is today (actual scores,
  no projection noise on settled history).

## Also fixing: stale network-egress note

`CLAUDE.md`'s "Network egress is restricted in this sandbox" section is
now demonstrably wrong for `*.supabase.co` (established two rounds ago —
the dev server reads live data fine) and, per this round's `curl` checks,
also wrong for `fantasy.premierleague.com`, `api.sleeper.app`, and
`site.api.espn.com`. Updating that section as part of this slice so the
next agent doesn't waste time avoiding live checks that actually work.

## Explicitly out of scope for this slice

- Trade suggestions (buy-low/sell-high) — user confirmed not wanted yet.
- Per-league scoring-format-aware projections (PPR vs standard vs
  half-PPR) — using Sleeper's `pts_ppr` and FPL's native scoring as-is.
- ESPN — no league-scoped ESPN data exists to attach this to.
- A dedicated "upcoming week" preview before the current week locks —
  neither platform's API supports it reliably today.
- Any change to the classic FPL league's ~99-team standings (still a
  snapshot, not full roster detail, per the existing league-team-view
  design).

## Verification plan

- `services/ingestion` test suite (new fixture-based unit tests for both
  adapters' `fetch_projections`, following the existing
  fetch/normalize-split convention — no live network call in tests).
- Migration applied + verified via Supabase MCP (`list_tables`,
  RLS-as-anon check — same checklist every prior migration in this repo
  has used).
- `services/ingestion.warehouse.sync_projections` covered by
  `httpx.MockTransport`, matching `sync_adapter`'s existing test pattern.
- UI verified live in the browser (dev server, real data) for: a
  head-to-head league's current week (projected tiles, weak-spot flags,
  opponent scouting all render), a past week (none of it renders,
  page unchanged), and the classic FPL league (no opponent, so none of
  this section renders — matches today's `opponentTeam &&` guards).
