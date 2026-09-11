# Unified Gameweek Matchup View — Design

## Goal

Replace the current fragmented FPL H2H league page — a stat-tile row, a
"Matchup Prep" card (current-week only), a "Next Gameweek Preview" card
(bolted on under the current week), and a separate "Head-to-Head
Comparison" roster-table section — with **one component** that renders
the entire head-to-head picture for whichever gameweek the user has
navigated to, with the fields it shows determined by whether that week
has been played yet.

This directly follows two rounds of user feedback: (1) the current
layout is "amateurish" and repeats similar roster data across three
separate blocks instead of showing one coherent view per week, and (2)
players need visible positions and position-based sorting instead of
arbitrary order. Reference: fplgameweek.com's own live-tracking pages
(shared by the user) for the data-density bar to hit — with the
explicit exception of true live in-play tracking and autosubs, which
stay out of scope (this app polls FPL every 6 hours, it doesn't track a
match minute-by-minute).

## The two states (not three)

Because there's no live in-play polling, a gameweek here only ever has
two meaningful states:

- **`future`** — `week > latestWeek`. No locked roster exists yet
  (FPL's API 404s a future gameweek's picks until its deadline passes —
  reconfirmed during the prior next-gameweek-preview work). Shows: both
  teams' *current* squads (labeled as a preview), `ep_next` projected
  points, next real-world fixture per player, position, sorting. No
  score, no transfers/chip/rank/bench-points/team-value section (none
  of that exists for an unplayed week).
- **`played`** — `week <= latestWeek`. Whether that week finished
  yesterday or a month ago, the shape is identical: real points,
  transfers made that week, chip used, bench points, team value,
  overall rank, consistency/trade-value per player, weak-spot flags,
  tough-fixture flags, Impact %. "Current" week (`week === latestWeek`)
  gets the same fields as any past week — it is not a third, richer
  state, since this app has no way to distinguish "still being played"
  from "just synced" beyond how recently the cron last ran.

Forward navigation extends from `[1, latestWeek]` to
`[1, latestWeek + 1]` — the future preview becomes a normal step in
`← Wk / Wk →`, not a bolt-on under the current week's card. Anything
beyond `latestWeek + 1` stays unreachable via the nav (still out of
scope, per the original next-gameweek-preview spec) — `h2h_fixtures`
already holds the whole season's opponent schedule, but next-week
projections (`ep_next`) and current-squad relevance both degrade fast
beyond one week out, and nothing in this pass changes that.

## New data — smaller lift than "full parity" first suggested

### Position: zero new ingestion

`public.fpl_sheet_player_data.position` (`'GKP' | 'DEF' | 'MID' |
'FWD'`, matching `fantasy_ingest.adapters.fpl._ELEMENT_TYPE_TO_POSITION`'s
own values exactly) is already synced daily and already joined into
roster views via `fetchFplSheetData` (used today only for
`difficultyScore`/`nextFixtures`). This pass just reads
`sheetRow.position` when building each roster row and sorts by it. No
migration, no adapter change, no backfill.

### Transfers, chip, bench points, team value, overall rank: already fetched, just discarded

`FPLAdapter.fetch_h2h_league_data` already calls
`GET /entry/{id}/event/{week}/picks/` for **every team, every week from
1 to `current_week`** (see `services/ingestion/fantasy_ingest/adapters/fpl.py`,
the `for week in range(1, current_week + 1): for team in teams:` loop).
Today it extracts only `picks["picks"]` (→ `RosterEntry` via
`_normalize_picks`). The same response also carries, unused:

```json
{
  "active_chip": "3xc",
  "entry_history": {
    "event": 3,
    "points": 64,
    "event_transfers": 2,
    "event_transfers_cost": 0,
    "points_on_bench": 15,
    "bank": 2,
    "value": 1004,
    "overall_rank": 2700348
  }
}
```

(`bank`/`value` are tenths of a £m, same convention as `now_cost`
elsewhere in this adapter — divide by 10.)

**New dataclass** (`services/ingestion/fantasy_ingest/league_models.py`,
alongside `H2HFixture`):

```python
@dataclass
class EntryGameweekStat:
    team_external_id: str
    week: int
    event_transfers: int
    event_transfers_cost: int
    points_on_bench: int
    bank: float
    team_value: float
    overall_rank: int | None
    active_chip: str | None = None
```

`LeagueSyncResult` gains a fifth field:
`entry_gameweek_stats: list[EntryGameweekStat] = field(default_factory=list)`.

**New table** `public.fpl_entry_gameweek_stats` — same shape/precedent
as `h2h_fixtures`:

```sql
create table public.fpl_entry_gameweek_stats (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  event_transfers integer not null,
  event_transfers_cost integer not null,
  points_on_bench integer not null,
  bank numeric not null,
  team_value numeric not null,
  overall_rank integer,
  active_chip text,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week),
  foreign key (source_id, external_league_id, external_team_id)
    references public.fantasy_teams (source_id, external_league_id, external_team_id) on delete cascade
);

alter table public.fpl_entry_gameweek_stats enable row level security;
create policy "public read fpl_entry_gameweek_stats" on public.fpl_entry_gameweek_stats for select using (true);
```

**Ingestion wiring**: inside `fetch_h2h_league_data`'s existing
per-team-per-week loop, build one `EntryGameweekStat` per successful
picks fetch (same place `_normalize_picks` is already called), append
to a new `entry_gameweek_stats` list, include it in the method's
returned `LeagueSyncResult`.

**Warehouse wiring**: `_entry_gameweek_stat_rows(league, result)` +
wire into `sync_league_data`, same conditional-post pattern as
`_h2h_fixture_rows`, `on_conflict=source_id,external_league_id,external_team_id,week`.

**No separate backfill script needed this time** — unlike
`h2h_fixtures` (which needed a one-off backfill because the matches
endpoint was never called for anything but the current week's
opponent), this loop *already* re-walks every historical week on every
sync. The next scheduled sync run populates weeks 1 through
`current_week` for every team automatically. A one-off local run is
still useful to make it visible immediately rather than waiting for the
next 6-hour cron tick, using the same `supabase db query -f` mechanism
as prior backfills.

## Impact % — this app's definition

Per player, for a **played** week only:

```
impact = playerPoints / opponentStarterAveragePoints
```

where `opponentStarterAveragePoints` is the mean points across the
opposing team's starters that week. Rendered as a percentage bar (bar
fill = `min(impact, 2.0) / 2.0`, clamped so one outlier double-digit
haul doesn't blow out the scale) with a color split at 100% (this
player over/under the opponent's average output). Not shown for a
future week — there's nothing to compare a projection against yet.

## Component architecture

**One new component**, `apps/web/components/ui/GameweekMatchupCard.tsx`,
replacing entirely:
- The `StatTile` row (My Score / Opponent Score / Result / My
  Projected / Opponent Projected / Win Probability)
- `MatchupPrepCard.tsx` (deleted)
- `NextGameweekPreviewCard.tsx` (deleted)
- The `TeamCompareChart`-based "Head-to-Head Comparison" section
- The plain `TeamPanel` roster tables

```tsx
interface GameweekMatchupPlayerRow {
  playerExternalId: string;
  playerName: string;
  position: "GKP" | "DEF" | "MID" | "FWD" | null; // null = not in fpl_sheet_player_data yet
  isStarter: boolean;
  points: number | null;           // played only
  projectedPoints: number | null;  // future only
  nextFixture: string | null;      // both states
  consistency: number | null;      // played only (coefficientOfVariation)
  tradeValue: number | null;       // played only
  impactPercent: number | null;    // played only
}

interface GameweekMatchupCardProps {
  weekState: "future" | "played";
  week: number;
  myTeamName: string;
  opponentTeamName: string;
  myPoints: number | null;         // played only
  opponentPoints: number | null;   // played only
  result: "W" | "L" | "T" | null;  // played only
  winProbability: number | null;   // played, when both projections exist
  myEntryStats: EntryGameweekStatView | null;      // played only
  opponentEntryStats: EntryGameweekStatView | null; // played only
  weakSpots: WeakSpot[];           // played only
  toughFixtures: ToughFixture[];   // both states can flag a hard run, but computed the same way
  opponentScouting: TeamStrengthRow | null; // played only
  myRoster: GameweekMatchupPlayerRow[];
  opponentRoster: GameweekMatchupPlayerRow[];
}
```

Internal `RosterColumn` sorts each roster by
`[GKP, DEF, MID, FWD].indexOf(position)`, then `isStarter` (starters
first), then `points ?? projectedPoints` descending — one shared sort
function, one shared row renderer, columns conditionally rendered
(Points+Consistency+TradeValue+Impact for `played`; Proj.+NextFixture
for `future`), same as the existing `NextGameweekPreviewCard` pattern
but with position added and both states unified into one component.

`apps/web/lib/leagues.ts` changes:
- `fetchLeagueTeamView`'s week-nav bound becomes `latestWeek + 1`.
- `RosterPlayerRow` (or a new derived view type built in `page.tsx`,
  matching the existing `computeNextGameweekRoster`-style helper
  pattern) gains `position` sourced from `fplSheetData`.
- New `fetchEntryGameweekStats(sourceId, externalLeagueId,
  externalTeamIds, week)` mirroring `fetchTeamStrength`'s shape,
  querying the new table.
- `fetchNextGameweekPreview` gets renamed/folded so that when
  `week === latestWeek + 1`, `fetchLeagueTeamView` returns the same
  `LeagueTeamView` shape used for `played` weeks, just with the
  `future`-only fields populated and the `played`-only fields `null` —
  a single code path branching on `weekState`, not two parallel fetch
  functions living side by side as they do today.

Standings table at the bottom of the page is **untouched** — it's a
whole-league view, not part of the head-to-head comparison, out of
scope for this pass.

## Verification plan

1. Migration applies cleanly, `get_advisors` shows zero new lints.
2. Run the sync once (locally, via the same one-off script pattern used
   for `h2h_fixtures`) and confirm `fpl_entry_gameweek_stats` gets one
   row per team per already-elapsed week (currently weeks 1–3 for the
   real league), with `event_transfers`/`active_chip`/`overall_rank`
   values that plausibly match what's visible on fantasy.premierleague.com
   for a couple of spot-checked teams.
3. `services/ingestion` test suite passes, plus new unit tests for the
   `EntryGameweekStat` extraction (fixture-based, extending the
   existing `test_fetch_h2h_league_data_*` tests in
   `test_fpl_adapter.py`) and `_entry_gameweek_stat_rows`/wiring
   (extending `test_warehouse.py`, same pattern as the `h2h_fixtures`
   tests).
4. Live-verify in the browser:
   - A played week (e.g. week 3) shows real points, transfers, chip
     (or "—" if none used), bench points, team value, overall rank,
     positions, correct position-grouped sort order, Impact % per
     player, weak spots, tough fixtures, opponent scouting stats — all
     in one card, nothing duplicated elsewhere on the page.
   - Navigating to `latestWeek + 1` (week 4) shows the future-state
     card: projections, next fixture, position/sort, no
     score/transfer/rank fields, no Impact %.
   - Navigating to `latestWeek + 2` is unreachable via `Wk →` (nav caps
     at `latestWeek + 1`, matching the original next-gameweek-preview
     scope decision).
   - Classic league and Sleeper league pages are unaffected (this is
     FPL H2H only, same gate as before:
     `league.sourceId === "fpl" && league.format === "head_to_head"`).
5. Production deploy shows the same result once Vercel's build
   finishes.

## Out of scope

- True live in-play tracking, autosubs, bonus-point-in-progress
  display — this app polls every 6 hours; nothing in this pass changes
  that cadence or adds a live layer.
- Browsing more than one week ahead (`latestWeek + 2` and beyond) —
  `h2h_fixtures` has the data, but projections and "current squad"
  relevance don't hold up that far out; unchanged from the prior
  next-gameweek-preview spec's own scope line.
- Extending any of this (transfers/chip/rank/Impact) to Sleeper or the
  FPL classic league — chips/transfers-per-gameweek/overall-rank are
  FPL-H2H-specific concepts pulled from an endpoint this app only calls
  for H2H leagues today; Sleeper would need its own feasibility check.
- A literal reproduction of fplgameweek.com's own "Impact" formula —
  its exact definition isn't published; this pass ships this app's own
  well-defined version (per-player points vs. opponent's starter
  average) instead of guessing at a third party's internals.
