# Consistency Score UI Design

## Goal

`player_consistency_scores` (added in `supabase/migrations/0002_player_consistency_view.sql`,
see `docs/superpowers/specs/2026-09-10-player-consistency-mart-design.md` for its
backend design) is a fully built, RLS-verified Postgres view — but nothing in
`apps/web` reads it yet. This is the first UI slice: surface it somewhere a
viewer can actually see it, with no new page or route.

## Where it's surfaced, and why

The per-league team-view roster table
(`apps/web/app/leagues/[leagueId]/page.tsx`, `TeamPanel`'s `myRoster`/
`opponentRoster` table) gets a new "Consistency" column next to "Points".

This is the better fit over `/players` (`apps/web/app/players/page.tsx`)
because the view's own grouping key is `(source_id, external_league_id,
player_external_id)` — a consistency score is only meaningful *for a given
league's scoring rules* (see the mart design doc's "grouping is per-league,
not merged across leagues" section). The team-view page already queries
`roster_players` scoped to one `(source_id, external_league_id)` pair to
build a roster, so joining against the view there requires no new scoping
logic — the same source/league values already in hand are reused directly.
`/players` has no league in scope at all (it's a global top-10-by-sport
catalog across sources), so there's no single `external_league_id` to join
against without inventing one, which would make the query's meaning
ambiguous ("consistency in which league?"). That page is left untouched.

## Data-access function shape

Added to `apps/web/lib/leagues.ts`, matching the file's existing
`fromXRow`-mapper convention (snake_case DB row interface → camelCase public
interface, functions throwing `Error` on a Supabase error):

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

function fromConsistencyScoreRow(row: ConsistencyScoreDbRow): ConsistencyScoreRow { ... }

export async function fetchConsistencyScores(
  sourceId: string,
  externalLeagueId: string,
  playerExternalIds: string[]
): Promise<Map<string, ConsistencyScoreRow>>
```

`fetchConsistencyScores` queries `player_consistency_scores` filtered by
`source_id`, `external_league_id`, and `.in("player_external_id", ids)` —
one batched query for an entire roster (or both rosters at once) rather than
one query per player. It returns a `Map<playerExternalId, ConsistencyScoreRow>`
rather than an array, since every call site wants point lookups per roster
row, not an ordered list. `player_name` isn't part of `ConsistencyScoreRow`
even though the view returns it — the roster row already has its own
`playerName` from `roster_players`, and the two should already agree, so
carrying a second copy would just invite drift.

`fetchLeagueTeamView` calls this once with the union of `myRoster` and
`opponentRoster`'s `playerExternalId`s (deduplicated), after both rosters are
fetched, then attaches the looked-up score (or `null`) onto each
`RosterPlayerRow` via a new `consistency: ConsistencyScoreRow | null` field.
One extra round trip per page load, not one per player.

## Handling missing consistency data

Three cases collapse to the same outcome — no crash, a graceful "no data"
cell:

1. **The view has no row for this player at all** — `having count(*) >= 2`
   filters out anyone with fewer than 2 recorded weeks (a player who just
   joined a roster, or one who's only appeared once). `fetchConsistencyScores`'s
   `Map.get()` simply misses, so `?? null` gives `RosterPlayerRow.consistency
   = null`.
2. **The view has a row, but `coefficient_of_variation` is `null`** — happens
   when `avg_points` is exactly `0` (a bench player who has never scored).
   `avgPoints`/`pointsStddev`/`weeksPlayed` are still real numbers in this
   case; only the ratio is undefined.
3. **`playerExternalIds` is empty** (a roster with zero rows, already handled
   elsewhere as "No roster data for this week") — `fetchConsistencyScores`
   short-circuits to an empty `Map` without issuing a query.

The rendered cell in `TeamPanel` treats cases 1 and 2 identically: render
`"—"` (matching this file's existing `formatPoints` convention for a null
value) rather than `0` or `NaN`, since both genuinely mean "no consistency
figure to show," not "perfectly consistent" or "zero variance." The two
cases are still distinguished in the `title` tooltip: case 2 has a real
`avgPoints`/`pointsStddev`/`weeksPlayed` to report even though the ratio
itself is undefined, so the tooltip still shows those figures when they
exist — only case 1 (no row at all) has genuinely nothing to show, and
the tooltip is omitted entirely.

## Rendering the indicator

The new "Consistency" column shows `coefficientOfVariation` rounded to two
decimals (lower = steadier, matching the view's own documented semantics),
with a `title` attribute on the cell spelling out
`avg <avgPoints> ± <pointsStddev> pts over <weeksPlayed> weeks` for anyone
who hovers for detail — no client JS needed, since `title` is a plain HTML
attribute and this page stays a server component with no `"use client"`.
Styling matches the existing "Points" column (`text-slate-300` for the
value cell, same `py-1` padding), and the header cell matches the existing
"Player"/"Points" header styling (`text-slate-500`, `font-medium`).
