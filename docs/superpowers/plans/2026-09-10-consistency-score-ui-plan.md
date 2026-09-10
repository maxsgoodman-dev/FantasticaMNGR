# Consistency Score UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `player_consistency_scores` view (see
`supabase/migrations/0002_player_consistency_view.sql`) in `apps/web`, as a
new "Consistency" column on the per-league team-view roster table.

**Architecture:** One new data-access function
(`fetchConsistencyScores` in `apps/web/lib/leagues.ts`), one new field on
`RosterPlayerRow` (`consistency: ConsistencyScoreRow | null`), and one new
table column in `apps/web/app/leagues/[leagueId]/page.tsx`'s `TeamPanel`. No
new page, no new route, no client components. See
`docs/superpowers/specs/2026-09-10-consistency-score-ui-design.md` for full
rationale (why the team-view page over `/players`, how missing-data cases
collapse to a graceful dash).

**Tech Stack:** Next.js App Router server components, `@supabase/supabase-js`
anon-key client (`apps/web/lib/supabase.ts`), TypeScript, Tailwind.

---

### Task 1: Add `fetchConsistencyScores` to `lib/leagues.ts`

**Files:**
- Edit: `apps/web/lib/leagues.ts`

- [ ] **Step 1: Add the `ConsistencyScoreRow` public interface and `ConsistencyScoreDbRow` internal interface**

Add near the other row interfaces in `apps/web/lib/leagues.ts`:

```ts
export interface ConsistencyScoreRow {
  playerExternalId: string;
  weeksPlayed: number;
  avgPoints: number;
  pointsStddev: number;
  coefficientOfVariation: number | null;
}

interface ConsistencyScoreDbRow {
  player_external_id: string;
  weeks_played: number;
  avg_points: number;
  points_stddev: number;
  coefficient_of_variation: number | null;
}
```

- [ ] **Step 2: Add `fromConsistencyScoreRow` and add a `consistency` field to `RosterPlayerRow`**

```ts
export interface RosterPlayerRow {
  externalTeamId: string;
  week: number;
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
  consistency: ConsistencyScoreRow | null;
}
```

Update `fromRosterPlayerRow` to set `consistency: null` (it's filled in
later, in Task 2, from a separate query — `roster_players` and
`player_consistency_scores` are different tables/queries).

```ts
function fromConsistencyScoreRow(row: ConsistencyScoreDbRow): ConsistencyScoreRow {
  return {
    playerExternalId: row.player_external_id,
    weeksPlayed: row.weeks_played,
    avgPoints: row.avg_points,
    pointsStddev: row.points_stddev,
    coefficientOfVariation: row.coefficient_of_variation,
  };
}
```

- [ ] **Step 3: Add `fetchConsistencyScores`**

```ts
export async function fetchConsistencyScores(
  sourceId: string,
  externalLeagueId: string,
  playerExternalIds: string[]
): Promise<Map<string, ConsistencyScoreRow>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("player_consistency_scores")
    .select("player_external_id, weeks_played, avg_points, points_stddev, coefficient_of_variation")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .in("player_external_id", playerExternalIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const scores = (data ?? []).map(fromConsistencyScoreRow);
  return new Map(scores.map((score) => [score.playerExternalId, score]));
}
```

Expected: `tsc --noEmit` still clean after this step (function is unused
until Task 2, but fully typed).

---

### Task 2: Wire consistency scores into `fetchLeagueTeamView`

**Files:**
- Edit: `apps/web/lib/leagues.ts`

- [ ] **Step 1: After `myRoster` and `opponentRoster` are both fetched, batch-fetch consistency scores for the union of both rosters**

In `fetchLeagueTeamView`, after the `if (league.format === "head_to_head" ...)` block
(so both `myRoster` and `opponentRoster` are populated), add:

```ts
const rosterPlayerIds = [
  ...new Set([...myRoster, ...opponentRoster].map((player) => player.playerExternalId)),
];
const consistencyScores = await fetchConsistencyScores(
  league.sourceId,
  league.externalLeagueId,
  rosterPlayerIds
);

const withConsistency = (roster: RosterPlayerRow[]): RosterPlayerRow[] =>
  roster.map((player) => ({
    ...player,
    consistency: consistencyScores.get(player.playerExternalId) ?? null,
  }));
```

- [ ] **Step 2: Apply `withConsistency` to both rosters before they're returned**

Change `myRoster` from `const` to `let` (it's reassigned now), and reassign
both:

```ts
myRoster = withConsistency(myRoster);
opponentRoster = withConsistency(opponentRoster);
```

Make sure this happens before the `return { ... myRoster, ..., opponentRoster, ... }`
statement at the end of the function.

Expected: `tsc --noEmit` clean; one additional Supabase query per league-view
page load (not one per player).

---

### Task 3: Add the "Consistency" column to the team-view roster table

**Files:**
- Edit: `apps/web/app/leagues/[leagueId]/page.tsx`

- [ ] **Step 1: Import `ConsistencyScoreRow` and extend `RosterRowView`**

```ts
import { fetchLeagueTeamView, type ConsistencyScoreRow } from "@/lib/leagues";
```

```ts
interface RosterRowView {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
  consistency: ConsistencyScoreRow | null;
}
```

- [ ] **Step 2: Add a `formatConsistency` helper next to the existing `formatPoints`**

```ts
function formatConsistency(score: ConsistencyScoreRow | null): string {
  return score?.coefficientOfVariation == null ? "—" : score.coefficientOfVariation.toFixed(2);
}

function consistencyTitle(score: ConsistencyScoreRow | null): string | undefined {
  return score
    ? `avg ${score.avgPoints} ± ${score.pointsStddev} pts over ${score.weeksPlayed} weeks`
    : undefined;
}
```

- [ ] **Step 3: Add the column header and cell in `TeamPanel`'s table**

Header row (next to "Points"):

```tsx
<th className="py-1 font-medium">Consistency</th>
```

Body cell (next to the "Points" `<td>`, using the same row's `player`):

```tsx
<td className="py-1 text-slate-300" title={consistencyTitle(player.consistency)}>
  {formatConsistency(player.consistency)}
</td>
```

- [ ] **Step 4: Confirm `TeamPanel`'s callers pass the new field through**

`myRoster`/`opponentRoster` from `fetchLeagueTeamView` already carry
`consistency` after Task 2, and `RosterPlayerRow` is structurally
compatible with the extended `RosterRowView`, so no change needed at the
`<TeamPanel roster={myRoster} .../>` call sites — just confirm `tsc` agrees.

---

### Task 4: Verify

- [ ] **Step 1: Type-check**

```bash
cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 2: Run the dev server and visually confirm**

Use `.claude/launch.json`'s `web-dev` config (create it if it doesn't exist,
pointing `npm --prefix apps/web run dev` at port 3000) and the Browser tool
to open a real league's team-view page (`/leagues/<id>`). Confirm the new
"Consistency" column renders with real numbers (or a dash for players
without enough weeks) — not a placeholder, not a crash. Screenshot as
evidence.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/leagues.ts apps/web/app/leagues/[leagueId]/page.tsx
git commit -m "Surface player consistency scores on the team-view roster table"
```
