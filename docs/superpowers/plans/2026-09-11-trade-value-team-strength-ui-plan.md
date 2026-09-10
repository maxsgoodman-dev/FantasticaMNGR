# Trade Value & Team Strength UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Surface `player_trade_value` (`supabase/migrations/0003_player_trade_value_view.sql`)
as a new "Trade Value" column on the per-league team-view roster table, and
`fantasy_team_strength` (`supabase/migrations/0004_fantasy_team_strength_view.sql`)
as new columns on the same page's Standings table.

**Architecture:** See
`docs/superpowers/specs/2026-09-11-trade-value-team-strength-ui-design.md`
for full rationale, including the judgment call to replace
`fetchConsistencyScores`/`ConsistencyScoreRow` with `fetchPlayerValues`/
`PlayerValueRow` (querying `player_trade_value` once instead of that view
and `player_consistency_scores` separately, since the former is a strict
superset of the latter's columns). No new page, no new route, no client
components.

**Tech Stack:** Next.js App Router server components, `@supabase/supabase-js`
anon-key client (`apps/web/lib/supabase.ts`), TypeScript, Tailwind.

---

### Task 1: Replace `ConsistencyScoreRow`/`fetchConsistencyScores` with `PlayerValueRow`/`fetchPlayerValues` in `lib/leagues.ts`

**Files:**
- Edit: `apps/web/lib/leagues.ts`

- [x] **Step 1: Rename `ConsistencyScoreRow` → `PlayerValueRow`, add `tradeValue`**

```ts
export interface PlayerValueRow {
  playerExternalId: string;
  weeksPlayed: number;
  avgPoints: number;
  pointsStddev: number;
  coefficientOfVariation: number | null;
  tradeValue: number;
}
```

- [x] **Step 2: Rename `ConsistencyScoreDbRow` → `PlayerValueDbRow`, add `trade_value`**

```ts
interface PlayerValueDbRow {
  player_external_id: string;
  weeks_played: number;
  avg_points: number;
  points_stddev: number;
  coefficient_of_variation: number | null;
  trade_value: number;
}
```

- [x] **Step 3: Rename `fromConsistencyScoreRow` → `fromPlayerValueRow`, map `tradeValue`**

```ts
function fromPlayerValueRow(row: PlayerValueDbRow): PlayerValueRow {
  return {
    playerExternalId: row.player_external_id,
    weeksPlayed: row.weeks_played,
    avgPoints: row.avg_points,
    pointsStddev: row.points_stddev,
    coefficientOfVariation: row.coefficient_of_variation,
    tradeValue: row.trade_value,
  };
}
```

- [x] **Step 4: Rename field on `RosterPlayerRow`: `consistency` → `playerValue`, typed `PlayerValueRow | null`**

Update `fromRosterPlayerRow` to set `playerValue: null` (still filled in
separately, later, from a different query).

- [x] **Step 5: Rename `fetchConsistencyScores` → `fetchPlayerValues`, query `player_trade_value`**

```ts
export async function fetchPlayerValues(
  sourceId: string,
  externalLeagueId: string,
  playerExternalIds: string[]
): Promise<Map<string, PlayerValueRow>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("player_trade_value")
    .select(
      "player_external_id, weeks_played, avg_points, points_stddev, coefficient_of_variation, trade_value"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .in("player_external_id", playerExternalIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const values = (data ?? []).map(fromPlayerValueRow);
  return new Map(values.map((value) => [value.playerExternalId, value]));
}
```

Expected: `tsc --noEmit` still clean after this step (other call sites
updated in Task 2).

---

### Task 2: Add `fetchTeamStrength` and wire both new lookups into `fetchLeagueTeamView`

**Files:**
- Edit: `apps/web/lib/leagues.ts`

- [x] **Step 1: Add `TeamStrengthRow`/`TeamStrengthDbRow`/`fromTeamStrengthRow`**

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

function fromTeamStrengthRow(row: TeamStrengthDbRow): TeamStrengthRow {
  return {
    externalTeamId: row.external_team_id,
    weeksPlayed: row.weeks_played,
    avgWeeklyPoints: row.avg_weekly_points,
    weeklyPointsStddev: row.weekly_points_stddev,
    bestWeekPoints: row.best_week_points,
    worstWeekPoints: row.worst_week_points,
    starterPointsShare: row.starter_points_share,
  };
}
```

- [x] **Step 2: Add `fetchTeamStrength` (internal, not exported — mirrors `fetchTeams`/`fetchWeeklyScoresForTeam` visibility)**

```ts
async function fetchTeamStrength(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[]
): Promise<Map<string, TeamStrengthRow>> {
  if (externalTeamIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("fantasy_team_strength")
    .select(
      "external_team_id, weeks_played, avg_weekly_points, weekly_points_stddev, best_week_points, worst_week_points, starter_points_share"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .in("external_team_id", externalTeamIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const strengths = (data ?? []).map(fromTeamStrengthRow);
  return new Map(strengths.map((strength) => [strength.externalTeamId, strength]));
}
```

- [x] **Step 3: Add `strength: TeamStrengthRow | null` to `StandingsRow`**

```ts
export interface StandingsRow {
  team: FantasyTeam;
  week: number;
  points: number;
  strength: TeamStrengthRow | null;
}
```

`fetchStandings` itself is unchanged (still returns rows without
`strength` populated) — attaching `strength` happens in
`fetchLeagueTeamView`, same pattern as roster/consistency. To satisfy the
type before that attachment step, either give `fetchStandings`'s internal
push a placeholder `strength: null` at construction, or attach it in one
pass right after calling `fetchStandings` in `fetchLeagueTeamView` (below)
— use the latter: it keeps `fetchStandings` focused on ranking, matching
how roster fetching and consistency/value attachment are already two
separate steps in this file.

- [x] **Step 4: In `fetchLeagueTeamView`, rename the consistency-attachment block to use `fetchPlayerValues`/`playerValue`**

Replace:

```ts
const consistencyScores = await fetchConsistencyScores(...)
const withConsistency = (roster) => roster.map((player) => ({
  ...player,
  consistency: consistencyScores.get(player.playerExternalId) ?? null,
}));
myRoster = withConsistency(myRoster);
opponentRoster = withConsistency(opponentRoster);
```

with:

```ts
const playerValues = await fetchPlayerValues(
  league.sourceId,
  league.externalLeagueId,
  rosterPlayerIds
);
const withPlayerValue = (roster: RosterPlayerRow[]): RosterPlayerRow[] =>
  roster.map((player) => ({
    ...player,
    playerValue: playerValues.get(player.playerExternalId) ?? null,
  }));
myRoster = withPlayerValue(myRoster);
opponentRoster = withPlayerValue(opponentRoster);
```

- [x] **Step 5: After `const standings = await fetchStandings(...)`, batch-fetch and attach team strength**

```ts
const teamStrengths = await fetchTeamStrength(
  league.sourceId,
  league.externalLeagueId,
  standings.map((row) => row.team.externalTeamId)
);
const standingsWithStrength: StandingsRow[] = standings.map((row) => ({
  ...row,
  strength: teamStrengths.get(row.team.externalTeamId) ?? null,
}));
```

Return `standings: standingsWithStrength` (not the original `standings`)
in the function's final return statement.

Expected: `tsc --noEmit` clean; two extra Supabase queries total per page
load (one for player values, one for team strength) — not one per
player/team, and not a regression from the precedent's single extra query
(the precedent's one query is replaced, not added to; the new team-strength
query is the only net-new round trip).

---

### Task 3: Add "Trade Value" column to the roster table, and team-strength columns to Standings

**Files:**
- Edit: `apps/web/app/leagues/[leagueId]/page.tsx`

- [x] **Step 1: Update imports and `RosterRowView`**

```ts
import {
  fetchLeagueTeamView,
  type PlayerValueRow,
  type TeamStrengthRow,
} from "@/lib/leagues";
```

```ts
interface RosterRowView {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
  playerValue: PlayerValueRow | null;
}
```

- [x] **Step 2: Rename `formatConsistency`/`consistencyTitle` params to `PlayerValueRow`, add `formatTradeValue`**

```ts
function formatConsistency(value: PlayerValueRow | null): string {
  return value?.coefficientOfVariation == null ? "—" : value.coefficientOfVariation.toFixed(2);
}

function formatTradeValue(value: PlayerValueRow | null): string {
  return value == null ? "—" : value.tradeValue.toFixed(2);
}

function playerValueTitle(value: PlayerValueRow | null): string | undefined {
  return value
    ? `avg ${value.avgPoints} ± ${value.pointsStddev} pts over ${value.weeksPlayed} weeks`
    : undefined;
}
```

Note `formatTradeValue` checks `value == null`, not
`value?.tradeValue == null` — unlike consistency, `trade_value` is never
null when the row exists (see design doc's missing-data case 2: an
`avg_points = 0` row still yields a real `trade_value = 0`).

- [x] **Step 3: Update `TeamPanel`'s table — rename the "Consistency" cell's data source to `player.playerValue`, add a "Trade Value" header + cell right after it**

```tsx
<Th title="Coefficient of variation — lower means steadier week-to-week output">
  Consistency
</Th>
<Th title="avg_points / (1 + coefficient of variation) — a single scoring+reliability figure, higher is better">
  Trade Value
</Th>
```

```tsx
<Td className="text-ink-muted" title={playerValueTitle(player.playerValue)}>
  {formatConsistency(player.playerValue)}
</Td>
<Td className="text-ink-muted" title={playerValueTitle(player.playerValue)}>
  {formatTradeValue(player.playerValue)}
</Td>
```

- [x] **Step 4: Add a `formatShare` helper and team-strength columns to the Standings table**

```ts
function formatShare(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}
```

Header row — append after "Points":

```tsx
<Th>Avg/Wk</Th>
<Th title="Weekly points standard deviation — higher means less predictable week to week">
  Stddev
</Th>
<Th>Best Wk</Th>
<Th>Worst Wk</Th>
<Th title="Share of this team's synced roster points that came from starters, not bench — not guaranteed to equal the team's official weekly score (see fantasy_team_strength's own caveat re: captain-armband doubling)">
  Starter Share
</Th>
```

Body cell — append after the existing Points `<Td>`, using `row.strength`:

```tsx
<Td className="text-ink-muted">{formatPoints(row.strength?.avgWeeklyPoints ?? null)}</Td>
<Td className="text-ink-muted">{formatPoints(row.strength?.weeklyPointsStddev ?? null)}</Td>
<Td className="text-ink-muted">{formatPoints(row.strength?.bestWeekPoints ?? null)}</Td>
<Td className="text-ink-muted">{formatPoints(row.strength?.worstWeekPoints ?? null)}</Td>
<Td className="text-ink-muted">{formatShare(row.strength?.starterPointsShare ?? null)}</Td>
```

- [x] **Step 5: Confirm `TeamPanel`'s callers pass the new field through**

`myRoster`/`opponentRoster` from `fetchLeagueTeamView` already carry
`playerValue` after Task 2; `RosterPlayerRow` is structurally compatible
with the renamed `RosterRowView`. Just confirm `tsc` agrees — no call-site
changes needed at `<TeamPanel roster={myRoster} .../>`.

---

### Task 4: Verify

- [x] **Step 1: Type-check**

```bash
cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [x] **Step 2: Run the dev server and visually confirm**

Reuse `.claude/launch.json`'s `web-dev` config if present at the repo root;
otherwise run `npm run dev -p <alternate-port>` directly and `navigate` the
Browser tool there. Open a real league's team-view page (`/leagues/<id>`).
Confirm:
- The roster table shows both "Consistency" and "Trade Value" columns with
  real numbers (or dashes for players without enough weeks).
- The Standings table shows the five new team-strength columns with real
  numbers for at least one team (or dashes for teams without a
  `fantasy_team_strength` row — expected for most teams currently, per the
  view design doc's live-data note that only FPL h2h league `401057`
  currently has broad multi-week coverage).

Screenshot as evidence.

- [x] **Step 3: Commit**

```bash
git add apps/web/lib/leagues.ts apps/web/app/leagues/[leagueId]/page.tsx
git commit -m "Surface player trade value and fantasy team strength on the team-view page"
```

- [x] **Step 4: Mark this plan's checkboxes complete in a follow-up commit**
