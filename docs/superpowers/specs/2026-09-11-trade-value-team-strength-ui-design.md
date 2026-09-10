# Trade Value & Team Strength UI Design

## Goal

`player_trade_value` and `fantasy_team_strength` (added in
`supabase/migrations/0003_player_trade_value_view.sql` and
`0004_fantasy_team_strength_view.sql`, see
`docs/superpowers/specs/2026-09-10-mart-layer-value-and-team-strength-design.md`
for their backend design) are fully built, RLS-verified Postgres views —
but nothing in `apps/web` reads either yet. This is the UI slice for both,
following the same precedent as `player_consistency_scores`'s own UI slice
(`docs/superpowers/specs/2026-09-10-consistency-score-ui-design.md`): no new
page, no new route, no client components.

## Where each is surfaced, and why

**Trade value** goes on the same per-league team-view roster table
(`apps/web/app/leagues/[leagueId]/page.tsx`, `TeamPanel`) as a new column
next to "Consistency" — same reasoning as the precedent: the view's grain is
`(source_id, external_league_id, player_external_id)`, and the team-view
page already has that exact `(source_id, external_league_id)` pair in scope
from building the roster. `/players` still has no single league in scope, so
it's left untouched for the same reason as before.

**Team strength** extends the existing Standings table on the same page.
That table already lists every team in the league keyed by `(source_id,
external_league_id, external_team_id)` — exactly `fantasy_team_strength`'s
own grain — so no new scoping logic is needed; the same team list already
being queried is reused directly.

## Judgment call: one query, not two views

`player_trade_value` selects every column `player_consistency_scores` has
(`weeks_played`, `avg_points`, `points_stddev`, `coefficient_of_variation`)
plus `trade_value`, built by literally `select`-ing from the consistency
view with one added computed column. Querying both views from `apps/web`
would run the same underlying aggregation twice per page load for no
benefit — the consistency figures obtained from `player_trade_value` are
identical to what `player_consistency_scores` would return.

So the existing `fetchConsistencyScores` / `ConsistencyScoreRow` /
`ConsistencyScoreDbRow` are replaced outright (not kept alongside a second
fetch) with a query against `player_trade_value`, and both the
"Consistency" and new "Trade Value" columns are rendered from the same
fetched row. This is a rename, not a behavior change, for the consistency
column: same batching, same `.eq(source_id).eq(external_league_id).in(player_external_id, ids)`
shape, same missing-data handling — it now just also carries `trade_value`.

Renamed for clarity now that the row carries more than a consistency score:

- `ConsistencyScoreRow` → `PlayerValueRow` (adds `tradeValue: number`)
- `ConsistencyScoreDbRow` → `PlayerValueDbRow` (adds `trade_value: number`)
- `fromConsistencyScoreRow` → `fromPlayerValueRow`
- `fetchConsistencyScores` → `fetchPlayerValues` (queries `player_trade_value`)
- `RosterPlayerRow.consistency` → `RosterPlayerRow.playerValue`

## Data-access function shapes

Added to / changed in `apps/web/lib/leagues.ts`, matching the file's
existing `fromXRow`-mapper convention:

```ts
export interface PlayerValueRow {
  playerExternalId: string;
  weeksPlayed: number;
  avgPoints: number;
  pointsStddev: number;
  coefficientOfVariation: number | null;
  tradeValue: number;
}

interface PlayerValueDbRow {
  player_external_id: string;
  weeks_played: number;
  avg_points: number;
  points_stddev: number;
  coefficient_of_variation: number | null;
  trade_value: number;
}

export async function fetchPlayerValues(
  sourceId: string,
  externalLeagueId: string,
  playerExternalIds: string[]
): Promise<Map<string, PlayerValueRow>>
```

`fetchPlayerValues` queries `player_trade_value` filtered by `source_id`,
`external_league_id`, and `.in("player_external_id", ids)` — unchanged
batching behavior from the precedent function, just a different `.from()`
table and one extra selected/mapped column. Still short-circuits to an
empty `Map` for an empty `playerExternalIds` array. `player_name` is still
omitted from the row for the same reason as before (the roster row already
carries its own `playerName`).

```ts
export interface TeamStrengthRow {
  externalTeamId: string;
  weeksPlayed: number;
  avgWeeklyPoints: number;
  weeklyPointsStddev: number;
  bestWeekPoints: number;
  worstWeekPoints: number;
  starterPointsShare: number | null;
}

interface TeamStrengthDbRow {
  external_team_id: string;
  weeks_played: number;
  avg_weekly_points: number;
  weekly_points_stddev: number;
  best_week_points: number;
  worst_week_points: number;
  starter_points_share: number | null;
}

async function fetchTeamStrength(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[]
): Promise<Map<string, TeamStrengthRow>>
```

`fetchTeamStrength` mirrors `fetchPlayerValues`'s shape exactly — one
batched `.in("external_team_id", ids)` query, a `Map` keyed by
`externalTeamId`, an empty-array short-circuit — scoped by `source_id` /
`external_league_id` just like every other per-league query in this file.
`team_name`, `owner_name`, and `is_mine` are all omitted from
`TeamStrengthRow` even though the view returns them: `StandingsRow` already
carries a full `FantasyTeam` (`teamName`/`ownerName`/`isMine`) from
`fetch_teams`/`fantasy_teams` directly, so carrying duplicate copies here
would just invite drift, exactly the same reasoning the precedent design
doc gives for omitting `player_name` from `ConsistencyScoreRow`/
`PlayerValueRow`. Not exported (kept internal, like `fetchTeams`,
`fetchWeeklyScoresForTeam`, etc.) since only `fetchLeagueTeamView` calls it.

`StandingsRow` gains one new field:

```ts
export interface StandingsRow {
  team: FantasyTeam;
  week: number;
  points: number;
  strength: TeamStrengthRow | null;
}
```

## Wiring into `fetchLeagueTeamView`

Both new lookups are batched exactly like the precedent lookup:

- `fetchPlayerValues` is called once with the deduplicated union of
  `myRoster` and `opponentRoster`'s `playerExternalId`s (this is the same
  call site the precedent's `fetchConsistencyScores` used — only the
  function/table name and the resulting field name change).
- `fetchTeamStrength` is called once, after `fetchStandings` returns, with
  the `externalTeamId`s of every row already in `standings` (not all teams
  in the league — `standings` already excludes teams `weekly_scores` has no
  row for via `teamsById.get(...)`, so re-querying strength for team ids
  that can never appear in the table would be a wasted lookup). The result
  is attached to each `StandingsRow` as `strength`.

Both remain one extra round trip per page load, not one per player/team.

## Handling missing data

**Trade value column**: identical three cases as the precedent's
consistency column, since it's now the same fetched row:
1. No `player_trade_value` row at all (fewer than 2 weeks played) →
   `playerValue: null` → both cells render `"—"`.
2. Row exists but `avg_points = 0` → `coefficient_of_variation` is `null`,
   but `trade_value` is *not* null — `avg_points / (1 + coalesce(cov, 0))`
   evaluates to `0 / 1 = 0` — a genuine, meaningful `0.00`, not "no data."
   So the "Consistency" cell still shows `"—"` for this case (per the
   precedent's existing rule: no CoV means no consistency figure), but the
   new "Trade Value" cell shows `0.00`, since the view guarantees
   `trade_value` is always a real number whenever the row exists at all.
3. Empty roster (already handled as "No roster data for this week") — no
   query issued, same as before.

**Team strength columns**: a team with a `standings` row but no
`fantasy_team_strength` row (fewer than 2 recorded weeks — per the view's
own `having count(*) >= 2`, or a team not yet synced with weekly detail)
gets `strength: null`; every added Standings column renders `"—"` for that
row, same dash convention as everywhere else on this page. Within an
existing `strength` row, `starterPointsShare` is independently nullable
(roster-level detail isn't synced for every team, per the view's own
`LEFT JOIN`) — that one column renders `"—"` even when the rest of the
row's numbers are present.

## Rendering

**Trade Value column** — placed immediately after "Consistency" in
`TeamPanel`'s table (Player, Points, Consistency, Trade Value), since it's
the more derived, "so what" figure of the two and reads naturally after the
raw consistency ratio. Shows `tradeValue.toFixed(2)`, or `"—"` when
`playerValue` is `null`. Reuses the same tooltip content as the Consistency
column (`avg <avgPoints> ± <pointsStddev> pts over <weeksPlayed> weeks`) via
a shared `playerValueTitle` helper (renamed from `consistencyTitle`, same
behavior) — both columns describe facets of the same underlying row, so one
shared tooltip covers both meaningfully rather than duplicating text or
inventing a second, thinner one just for Trade Value. Column and cell
styling matches the existing "Consistency"/"Points" cells exactly
(`text-ink-muted` value cell).

**Standings columns** — five new columns appended after "Points": "Avg/Wk",
"Stddev", "Best Wk", "Worst Wk", "Starter Share". Numeric point figures
(`avgWeeklyPoints`, `weeklyPointsStddev`, `bestWeekPoints`,
`worstWeekPoints`) are formatted with the page's existing `formatPoints`
helper (one decimal, `"—"` for `null`/missing). `starterPointsShare` is
rendered as a whole-number percentage (`(share * 100).toFixed(0) + "%"`,
`"—"` when `null`) since a raw `0.634` reads less immediately than `"63%"`
and the view's own comment already frames it as a share/fraction. Column
headers get a `title` attribute where the header text alone doesn't fully
explain the metric (`"Stddev"` → "Weekly points standard deviation — higher
means less predictable week to week", `"Starter Share"` → "Share of this
team's synced roster points that came from starters, not bench — see
fantasy_team_strength's own caveat: this need not equal the team's official
weekly score"), mirroring the existing "Consistency" header's own `title`
usage.
