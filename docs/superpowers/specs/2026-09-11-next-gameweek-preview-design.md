# Next-Gameweek H2H Preview (FPL) — Design

## Goal

The existing "Matchup Prep" feature (`2026-09-10-matchup-prep-design.md`) is
deliberately scoped to the *current* gameweek — neither platform exposes a
manager's locked lineup for a future week before its deadline, so "prep"
there means mid-week analysis of a match already in progress.

This is a different, narrower ask: for FPL specifically, show who you play
**next** gameweek and a side-by-side preview of both squads, before the
current gameweek has even finished. This is verified feasible against
FPL's real API (see "Feasibility checks" below) precisely because it
doesn't need the future lineup — only the future *opponent* (fixed at
the start of the season) and each side's *current* squad as a preview.

## Feasibility checks (done live against the real FPL API before this was written)

- `GET /leagues-h2h-matches/league/{id}/?entry={id}` returns **every**
  gameweek's pairing for the season in one response (confirmed: events 1
  through 38 for a real league), not just past ones.
  `fantasy_ingest/adapters/fpl.py::_normalize_h2h_matches` already calls
  this endpoint but explicitly discards everything past the current week
  (`if week > current_week: continue`) — the future pairings were always
  there, just thrown away.
- `GET /entry/{id}/event/{future_week}/picks/` — confirmed **404** for a
  gameweek that hasn't reached its deadline yet. A manager's future
  lineup genuinely doesn't exist server-side until the deadline passes.
  This is why "their team" here means their *current* (most recently
  locked) squad, clearly labeled as a preview, not their future lineup.
- `bootstrap-static`'s player elements carry both `ep_this` (current-week
  expected points) and `ep_next` (next-week expected points) —
  confirmed via a live call showing both fields populated and
  independent. The existing `_normalize_projections` deliberately uses
  only `ep_this` (see its own comment, "to match this adapter's
  'current week' scope everywhere else"). `ep_next` is exactly what
  this feature needs and is currently unused.

## Table: `public.h2h_fixtures`

One row per `(source_id, external_league_id, external_team_id, week)` —
the fixed schedule of who plays whom, independent of whether that week
has been played yet.

```sql
create table public.h2h_fixtures (
  id bigint generated always as identity primary key,
  source_id text not null references public.sources(id),
  sport_id text not null references public.sports(id),
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  opponent_external_team_id text,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week)
);

alter table public.h2h_fixtures enable row level security;
create policy "public read h2h_fixtures" on public.h2h_fixtures for select using (true);
```

`opponent_external_team_id` is nullable to allow for a bye week (odd
number of teams in a knockout/bye round), matching how `weekly_scores`
already models `opponent_external_team_id` as nullable for the same
reason.

**Why a new table instead of extending `weekly_scores`:** `weekly_scores`
is a record of a match that has *already happened* — `points: float not
null`. A future fixture has no points yet and never will until the
warehouse's normal weekly sync catches up to it. Forcing a "future
result" into a table whose whole contract is "this happened" would mean
either a fake `0.0` points value (indistinguishable from a real 0-point
week) or making `points` nullable everywhere downstream, weakening a
column every other feature already depends on being real. A second,
purpose-built table with a clearly different contract ("this is who you
play," not "this is what happened") is the same reasoning
`0001_league_tables.sql` already used for splitting league-scoped data
from the platform-wide catalog.

**Why store the whole season, not just next week:** the source API call
returns the whole thing regardless — `_normalize_h2h_matches`'s existing
filter already proves this. Storing all of it costs a few dozen extra
rows per league and means "next week" is a plain `week = current + 1`
lookup rather than a special case, and any future "look ahead N weeks"
ask is already answered by data already sitting in the warehouse.

## Ingestion changes (`services/ingestion/fantasy_ingest/adapters/fpl.py`)

- New `_normalize_h2h_fixtures(pages, my_entry_id)` (or generalized to
  all teams, matching `_normalize_h2h_teams`'s existing per-team scope) —
  a pure function alongside `_normalize_h2h_matches`, built from the same
  already-fetched `pages`, with no new HTTP calls. Returns one row per
  `(team, week)` for every event in the pages, unfiltered by week.
- New `fetch_next_week_projections()` method on `FPLAdapter`: fetches
  `bootstrap-static` (already the mechanism `fetch_projections` and
  `current_gameweek()` use), computes `current_week + 1`, and maps
  `ep_next` (not `ep_this`) into `PlayerProjection` rows for that week.
  Kept as a separate method from `fetch_projections` rather than a
  parameter toggle — `fetch_projections`'s whole contract is "the
  current week, `ep_this`," documented and relied on by existing tests;
  bolting an `ep_next` branch onto it would blur that contract for a
  feature that's conceptually distinct (a genuine projection for a
  known week, vs. an early-look estimate for a week that hasn't started
  scoring yet).

## Warehouse changes (`services/ingestion/fantasy_ingest/warehouse.py`)

- `sync_h2h_fixtures(league, fixtures)` — same upsert pattern as every
  other sync function, `on_conflict=source_id,external_league_id,external_team_id,week`.
- `sync_next_week_projections(adapter)` — thin wrapper around the
  existing `sync_projections(adapter, week, client)`, just supplying
  `adapter.current_gameweek() + 1` as the week and reading from
  `fetch_next_week_projections()` instead of `fetch_projections(week)`.
  Reuses `sync_projections`'s existing upsert logic and table
  (`player_projections` already has `week` in its key — this is simply
  one more row per player, for `week = current + 1`, no schema change).
- Both wired into `main()` for FPL only (ESPN/Sleeper don't have this
  ask; Sleeper's own H2H schedule structure would need its own
  feasibility check before extending there, out of scope here).

## Data layer (`apps/web/lib/leagues.ts`)

Only rendered when the page is showing the *actual* current gameweek —
same `isCurrentHeadToHeadWeek` gate the existing Matchup Prep card
already uses. "Next gameweek" means "the week after whatever is live
right now," not "the week after whichever historical week you happen to
be browsing" — so this card doesn't appear when paging back through old
weeks via the `← Wk / Wk →` nav, exactly like Matchup Prep today.

New `fetchNextGameweekPreview(sourceId, externalLeagueId, currentWeek)`:
1. Look up `h2h_fixtures` for `week = currentWeek + 1` to get the
   opponent's `external_team_id`. Returns `null` if no row (bye week, or
   fixtures haven't been synced for this league).
2. Fetch both teams' current-week rosters (`week = currentWeek`, their
   most recently locked squads) — reuses the existing roster fetch
   already used by `fetchLeagueTeamView` (no new query shape).
3. Fetch `player_projections` at `week = currentWeek + 1` for both
   rosters' player IDs.
4. Fetch `fpl_sheet_player_data` for both rosters (already fetched today
   for the current week's Matchup Prep card) and pull each player's
   `next_fixtures` entry matching `gw = currentWeek + 1` for the
   opponent-club + home/away display.

## UI

A new card, "Next Gameweek Preview," FPL-only (rendered only when
`league.sourceId === "fpl"`), placed after the existing Matchup Prep
card. Two side-by-side panels (reusing the existing `TeamPanel`-style
layout already built for the Head-to-Head Comparison section), each
showing:

- Team name/avatar, "current squad — subject to change before the
  Gameweek {N} deadline" caption (the honesty caveat from the
  feasibility checks above, stated once per panel, not per player).
- Per player: name, Starter/Bench badge (from the *current* week's
  lineup, same badge component already used elsewhere), projected
  points for next week, and next week's real-world fixture (e.g. "vs
  ARS (H)") pulled from the community sheet data already wired up for
  the Tough Fixture note.

No new chart — this is a two-column roster table, the same visual
pattern already established, not a new dataviz form.

## Verification plan

1. Migration applies cleanly; `get_advisors` shows zero new lints.
2. Sync one real FPL league end-to-end; confirm `h2h_fixtures` row count
   matches the number of events returned by the matches endpoint for
   that entry (38 for a full Premier League season).
3. Spot-check the next-gameweek opponent shown in the UI against the
   same fixture visible directly from `fantasy.premierleague.com`'s own
   pages for that manager.
4. Confirm `player_projections` gains exactly one new row per rostered
   player at `week = current + 1`, `ep_next`-sourced, without disturbing
   the existing `week = current` rows from `fetch_projections`.
5. `services/ingestion` test suite passes, plus new unit tests for
   `_normalize_h2h_fixtures` and `fetch_next_week_projections` (fixture-
   based, no live calls, matching every other adapter test in this
   package).
6. Live-verify in the browser: the FPL league page shows a real next
   opponent and a real, non-empty side-by-side roster with projections
   and fixtures populated.

## Out of scope

- Sleeper's own H2H fixture structure — this spec is FPL-only per the
  explicit ask; Sleeper would need its own feasibility check (does its
  API expose a full-season schedule the same way?) before extending
  this pattern there.
- Any live/in-progress gameweek tracking (points updating in real time,
  autosubs, an "Importance"/"Impact" ownership-differential metric) —
  raised as a reference during brainstorming (fplgameweek.com) but
  explicitly confirmed out of scope for this piece; a candidate for a
  separate future spec if wanted.
- Showing more than one week ahead in the UI, even though the fixture
  table stores the whole season — the ask was "next gameweek," and nothing
  in the UI needs to expose the rest yet.
- Any change to the existing current-week Matchup Prep card or its
  `fetch_projections`/`ep_this` path — this is additive, not a
  replacement.
