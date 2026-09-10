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

## Fourth data source: the community FPL sheet

Mid-design, the user asked to ingest and live-track a specific
third-party Google Sheet as an FPL data source:
`https://docs.google.com/spreadsheets/d/1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM`
("FPL Data & Planner — 2026/2027", maintained by a community author,
auto-refreshed daily at 5 AM GMT from the official FPL site). Investigated
and folded into this same slice since it directly enriches the weak-spot
and opponent-scouting work above with real signal (fixture difficulty,
underlying xG rates, DefCon) neither the official FPL nor Sleeper APIs
expose.

**Access mechanism (verified live):** the sheet is publicly readable —
its `gviz` CSV export endpoint returns real data with no auth, e.g.:

```
https://docs.google.com/spreadsheets/d/1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM/gviz/tq?tqx=out:csv&sheet=Data
```

(`sheet=<tab name>` is more robust than a `gid=`, since gids aren't
easily discoverable without loading the full edit-mode page). This means
scheduled ingestion (GitHub Actions, same as every other sync) needs no
service-account credentials — just an HTTP GET, consistent with how
every other adapter in this repo works.

**Which tabs, and why only one:** the file has 9 tabs. Only **Data** (653
players × 52 columns) is a clean tabular structure. The other 8
(Insights, Transfer Picks, Top 100 Managers ×3, Team Form, Fixture
Difficulty, Price Changes) are prose-formatted "dashboard" layouts built
*from* Data by the sheet's own formulas — parsing them reliably would
mean reverse-engineering free-form layouts for numbers Data already
contains in raw form (e.g. Data's own `Difficulty Score` and `Price
change progress` columns already back the Fixture Difficulty and Price
Changes dashboards). Scoping v1 to the Data tab only.

**Schema gotcha:** Data's 52 columns include a duplicate block at
positions 43–47 (`Cost Today`, `Total Cost Change`, `Cost Change GW`,
`Position`, `Team` again) — a spreadsheet-internal helper block feeding
the later xG/DefCon columns, in a different format (e.g. column 43's
`Cost Today` is `60`, tenths-of-a-pound like our own `players.price`
storage elsewhere; column 4's is the display string `£6.00`). Taking the
first (display-string) occurrence for identity/display fields and
ignoring the redundant second block entirely — nothing in it isn't
already captured.

**`Player ID` = FPL's own element id** (same id space
`FPLAdapter.fetch_players` already uses for `players.external_id` where
`source_id='fpl'`) — confirmed by cross-referencing row 2 (`Player ID=1,
David, Raya`) against the live FPL API. This table joins cleanly against
the existing `players` table without any new identity-resolution work.

**New table: `fpl_sheet_player_data`** — one row per `(external_player_id,
data_fetched)`, source-tagged (not folded into `player_projections` or
`players`, since this is a fundamentally different — community-curated,
not official-API — data source with its own refresh cadence and its own
gotchas):

```sql
create table public.fpl_sheet_player_data (
  id bigint generated always as identity primary key,
  external_player_id text not null,   -- FPL element id, joins players.external_id where source_id='fpl'
  web_name text not null,
  position text not null,
  team_name text not null,
  cost_today numeric not null,
  form numeric,
  selection_percent numeric,
  total_points integer not null default 0,
  points_per_game numeric,
  chance_of_playing_next integer,
  total_cost_change numeric,
  cost_change_gw numeric,
  total_transfers_in integer,
  total_transfers_out integer,
  influence numeric,
  creativity numeric,
  threat numeric,
  ict_index numeric,
  next_fixtures jsonb not null default '[]',  -- [{gw, opponent, is_home}, ...] parsed from the GW4..GW9 columns
  difficulty_score numeric,       -- lower = easier upcoming run, per the sheet's own scale
  xgi_per_90 numeric,             -- expected goal involvement / 90 (attacking)
  xgc_per_90 numeric,             -- expected goals conceded / 90 (defensive)
  defcon numeric,                 -- defensive contribution metric (2026-27 scoring rule)
  price_change_progress numeric,  -- % progress toward next price rise/fall
  data_fetched date not null,     -- see note below: this is our own sync date, not literally parsed off the sheet
  source text not null default 'fpl-community-sheet',
  synced_at timestamptz not null default now(),
  unique (external_player_id, data_fetched)
);
-- RLS: public SELECT, no write policy — same as every other warehouse table.
```

**`data_fetched` revision (found mid-implementation):** the plan
originally called for parsing the sheet's own self-reported "Data
Fetched" date off its Intro tab. Checked live: that value sits in an
*unlabeled* cell (`Intro` tab, row 5 col B) — the "Data Fetched" text
itself isn't a parseable cell at all (likely a merged cell or separate
text object gviz's CSV export drops), so the only way to read it is by
fixed row/column position, fragile to the sheet author ever reordering
that tab. Using our own sync date (UTC, when the sync ran) instead —
simpler, doesn't depend on an unlabeled cell's position, and gives the
same practical outcome (one row per calendar day per player, via the
same `unique(external_player_id, data_fetched)` constraint).

**Ingestion:** a new lightweight module (not a full `FantasySourceAdapter`
— this isn't a platform adapter, it's a single CSV pull), e.g.
`fantasy_ingest/sources/fpl_community_sheet.py`, with the same
fetch/normalize split every adapter already follows: `_fetch_csv()` (the
gviz GET) and `_normalize_rows(csv_text)` (parses `£6.00` → `6.0`,
`"428,001"`-style large ints, and the `GW4`..`GW9` opponent-code columns
like `"SUN (A)"` into `next_fixtures`). Synced via a new
`warehouse.sync_fpl_sheet()`, upserting on `(external_player_id,
data_fetched)` — same PostgREST pattern as everything else. Added to
`sync.yml` on the existing schedule (the sheet itself only refreshes
once daily at 5 AM GMT, so syncing more often than that gains nothing).

**Attribution:** this is someone else's community-maintained,
publicly-shared derived dataset, not official FPL data — the sheet
itself is explicitly built for public reuse (it links its own feedback
form and "get in touch"). Recorded here, and worth a one-line credit
somewhere visible if this data surfaces in the UI (e.g. a footnote on
whatever component renders `difficulty_score`/`xgi_per_90`), not
presented as our own.

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
