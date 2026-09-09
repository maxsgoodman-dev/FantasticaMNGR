# League Team-View UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard's new primary screen — a per-league "my team" view (roster, weekly points, opponent for head-to-head leagues, standings for everyone) reading the `leagues`/`fantasy_teams`/`weekly_scores`/`roster_players` tables from the [league ingestion backend plan](2026-09-06-league-ingestion-backend-plan.md), plus a real league-based sidebar nav replacing today's static one. The existing top-10-by-points player table is relocated (unchanged) to `/players`, demoted from homepage to a secondary route.

**Architecture:** All-server-component Next.js App Router, matching the existing codebase exactly — no client components, no new client-side state. The week selector is `<Link href="?week=N">` navigation (server re-render), not client-side interactivity. One new data-access module (`lib/leagues.ts`, mirroring `lib/players.ts`'s style: snake_case DB row interfaces, camelCase public interfaces, `fromXRow` mappers, throwing `Error` on a Supabase error) issues several small, separate queries and joins them in JS — not a single complex query, and not PostgREST's relational embedding (composite natural-key FKs make that riskier to rely on, and the existing codebase has no precedent using it). Sidebar becomes a shared `app/layout.tsx` component (previously inline, duplicated conceptually, in `page.tsx`) so it's consistent across every route.

**Tech Stack:** Next.js 15 (App Router, server components), `@supabase/supabase-js` (existing `lib/supabase.ts`, unchanged), Tailwind (existing utility classes, matching current style). No test framework exists in `apps/web` (confirmed: no test script in `package.json`, no Jest/Vitest) — this plan's verification step is `tsc --noEmit` (type-checking without touching the network, since `noEmit: true` is already set in `tsconfig.json`) after each task, plus a `npm run build` + browser check in the final task. This mirrors the project's own stated verification method (`CLAUDE.md`: "`npm run build` ... also type-checks and lints") rather than inventing a test framework this codebase doesn't have.

**Known sandbox limitation carried over from the backend plan:** this environment's egress proxy blocks `*.supabase.co` directly (confirmed in `CLAUDE.md`). `tsc --noEmit` never touches the network, so it's unaffected. `npm run build` and the dev server MIGHT hit this if Next.js attempts to prerender a page that queries Supabase — if so, that's a pre-existing sandbox limitation identical to what the current `page.tsx`/`api/players/route.ts` already have (same `fetchTopPlayers` pattern, unchanged by this plan), not a bug introduced here. The final task's browser check will most likely show the graceful empty/error state (since no real league data has been synced into this Supabase project yet — Task 1 of the backend plan only applied the schema migration, no real sync has run) — that IS a valid thing to verify (the graceful-degradation path rendering correctly), just not the true happy-path with real rosters, which needs verifying from a machine that can actually reach Supabase, same caveat as the backend plan's live sync.

---

### Task 1: `lib/leagues.ts` — data access layer

**Files:**
- Create: `apps/web/lib/leagues.ts`

- [x] **Step 1: Write the file**

Create `apps/web/lib/leagues.ts`:

```typescript
import { supabase } from "@/lib/supabase";

export interface League {
  id: number;
  sourceId: string;
  sportId: string;
  externalLeagueId: string;
  name: string;
  season: string;
  format: "head_to_head" | "classic";
}

export interface FantasyTeam {
  externalTeamId: string;
  teamName: string;
  ownerName: string;
  isMine: boolean;
}

export interface WeeklyScoreRow {
  externalTeamId: string;
  week: number;
  points: number;
  opponentExternalTeamId: string | null;
}

export interface RosterPlayerRow {
  externalTeamId: string;
  week: number;
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
}

export interface StandingsRow {
  team: FantasyTeam;
  week: number;
  points: number;
}

export interface LeagueTeamView {
  league: League;
  week: number;
  latestWeek: number;
  myTeam: FantasyTeam;
  myScore: WeeklyScoreRow | null;
  myRoster: RosterPlayerRow[];
  opponentTeam: FantasyTeam | null;
  opponentScore: WeeklyScoreRow | null;
  opponentRoster: RosterPlayerRow[];
  standings: StandingsRow[];
}

interface LeagueDbRow {
  id: number;
  source_id: string;
  sport_id: string;
  external_league_id: string;
  name: string;
  season: string;
  format: "head_to_head" | "classic";
}

interface FantasyTeamDbRow {
  external_team_id: string;
  team_name: string;
  owner_name: string;
  is_mine: boolean;
}

interface WeeklyScoreDbRow {
  external_team_id: string;
  week: number;
  points: number;
  opponent_external_team_id: string | null;
}

interface RosterPlayerDbRow {
  external_team_id: string;
  week: number;
  player_external_id: string;
  player_name: string;
  is_starter: boolean;
  points: number;
}

function fromLeagueRow(row: LeagueDbRow): League {
  return {
    id: row.id,
    sourceId: row.source_id,
    sportId: row.sport_id,
    externalLeagueId: row.external_league_id,
    name: row.name,
    season: row.season,
    format: row.format,
  };
}

function fromFantasyTeamRow(row: FantasyTeamDbRow): FantasyTeam {
  return {
    externalTeamId: row.external_team_id,
    teamName: row.team_name,
    ownerName: row.owner_name,
    isMine: row.is_mine,
  };
}

function fromWeeklyScoreRow(row: WeeklyScoreDbRow): WeeklyScoreRow {
  return {
    externalTeamId: row.external_team_id,
    week: row.week,
    points: row.points,
    opponentExternalTeamId: row.opponent_external_team_id,
  };
}

function fromRosterPlayerRow(row: RosterPlayerDbRow): RosterPlayerRow {
  return {
    externalTeamId: row.external_team_id,
    week: row.week,
    playerExternalId: row.player_external_id,
    playerName: row.player_name,
    isStarter: row.is_starter,
    points: row.points,
  };
}

export async function fetchLeagues(): Promise<League[]> {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, source_id, sport_id, external_league_id, name, season, format")
    .order("sport_id", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromLeagueRow);
}

export async function fetchLeagueById(leagueId: number): Promise<League | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, source_id, sport_id, external_league_id, name, season, format")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return data ? fromLeagueRow(data) : null;
}

async function fetchTeams(sourceId: string, externalLeagueId: string): Promise<FantasyTeam[]> {
  const { data, error } = await supabase
    .from("fantasy_teams")
    .select("external_team_id, team_name, owner_name, is_mine")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromFantasyTeamRow);
}

async function fetchWeeklyScoresForTeam(
  sourceId: string,
  externalLeagueId: string,
  externalTeamId: string
): Promise<WeeklyScoreRow[]> {
  const { data, error } = await supabase
    .from("weekly_scores")
    .select("external_team_id, week, points, opponent_external_team_id")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("external_team_id", externalTeamId)
    .order("week", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromWeeklyScoreRow);
}

async function fetchRoster(
  sourceId: string,
  externalLeagueId: string,
  externalTeamId: string,
  week: number
): Promise<RosterPlayerRow[]> {
  const { data, error } = await supabase
    .from("roster_players")
    .select("external_team_id, week, player_external_id, player_name, is_starter, points")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("external_team_id", externalTeamId)
    .eq("week", week)
    .order("is_starter", { ascending: false });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromRosterPlayerRow);
}

// "Standings" = each team's most recently synced weekly_scores row, not a
// specific week. For head-to-head leagues every team has full weekly
// history, so "most recent" naturally means "the current week" — but for
// the FPL classic league, everyone except the caller's own team only ever
// has ONE row (a season-cumulative snapshot from the last sync), so there's
// no meaningful per-week standings to show for them regardless of which
// week the caller is browsing their own roster history for. One
// implementation serves both cases correctly this way; it's intentionally
// decoupled from the page's week selector (see LeagueTeamViewPage).
async function fetchStandings(
  sourceId: string,
  externalLeagueId: string,
  teams: FantasyTeam[]
): Promise<StandingsRow[]> {
  const { data, error } = await supabase
    .from("weekly_scores")
    .select("external_team_id, week, points, opponent_external_team_id")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .order("week", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const teamsById = new Map(teams.map((team) => [team.externalTeamId, team]));
  const latestByTeam = new Map<string, WeeklyScoreDbRow>();
  for (const row of data ?? []) {
    latestByTeam.set(row.external_team_id, row);
  }

  const standings: StandingsRow[] = [];
  for (const row of latestByTeam.values()) {
    const team = teamsById.get(row.external_team_id);
    if (team) {
      standings.push({ team, week: row.week, points: row.points });
    }
  }

  return standings.sort((a, b) => b.points - a.points);
}

export async function fetchLeagueTeamView(leagueId: number, requestedWeek?: number): Promise<LeagueTeamView> {
  const league = await fetchLeagueById(leagueId);
  if (!league) {
    throw new Error(`no league found for id ${leagueId}`);
  }

  const teams = await fetchTeams(league.sourceId, league.externalLeagueId);
  const myTeam = teams.find((team) => team.isMine);
  if (!myTeam) {
    throw new Error(`no team flagged as mine in league ${leagueId} — has this league been synced yet?`);
  }

  const myWeeklyScores = await fetchWeeklyScoresForTeam(
    league.sourceId,
    league.externalLeagueId,
    myTeam.externalTeamId
  );
  const latestWeek = myWeeklyScores.reduce((max, score) => Math.max(max, score.week), 0);
  const week = requestedWeek ?? latestWeek;

  const myScore = myWeeklyScores.find((score) => score.week === week) ?? null;
  const myRoster = await fetchRoster(league.sourceId, league.externalLeagueId, myTeam.externalTeamId, week);

  let opponentTeam: FantasyTeam | null = null;
  let opponentScore: WeeklyScoreRow | null = null;
  let opponentRoster: RosterPlayerRow[] = [];

  if (league.format === "head_to_head" && myScore?.opponentExternalTeamId) {
    opponentTeam = teams.find((team) => team.externalTeamId === myScore.opponentExternalTeamId) ?? null;
    if (opponentTeam) {
      const opponentWeeklyScores = await fetchWeeklyScoresForTeam(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId
      );
      opponentScore = opponentWeeklyScores.find((score) => score.week === week) ?? null;
      opponentRoster = await fetchRoster(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId,
        week
      );
    }
  }

  const standings = await fetchStandings(league.sourceId, league.externalLeagueId, teams);

  return {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings,
  };
}
```

- [x] **Step 2: Type-check**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0

- [x] **Step 3: Commit**

```bash
git add apps/web/lib/leagues.ts
git commit -m "Add lib/leagues.ts data access layer for the team-view UI"
```

---

### Task 2: Real league nav + relocate the player table to `/players`

**Files:**
- Create: `apps/web/components/Sidebar.tsx`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/app/players/page.tsx`
- Modify: `apps/web/app/page.tsx` (full rewrite)

These four files change together in one task because they're interdependent — splitting them would leave an intermediate commit with a broken/duplicated layout (the sidebar would exist in two places at once).

- [x] **Step 1: Create the sidebar**

Create `apps/web/components/Sidebar.tsx`:

```typescript
import Link from "next/link";
import { fetchLeagues, type League } from "@/lib/leagues";

const SPORT_LABELS: Record<string, string> = {
  nfl: "NFL",
  "premier-league": "Premier League",
};

function groupBySport(leagues: League[]): Map<string, League[]> {
  const grouped = new Map<string, League[]>();
  for (const league of leagues) {
    const group = grouped.get(league.sportId) ?? [];
    group.push(league);
    grouped.set(league.sportId, group);
  }
  return grouped;
}

export default async function Sidebar() {
  let leagues: League[] = [];
  let error: string | null = null;

  try {
    leagues = await fetchLeagues();
  } catch (fetchError) {
    error = fetchError instanceof Error ? fetchError.message : "Unknown error querying the warehouse";
  }

  const grouped = groupBySport(leagues);

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Leagues</h2>

      {error ? (
        <p className="mb-4 text-xs text-red-400">Couldn&apos;t load leagues: {error}</p>
      ) : leagues.length === 0 ? (
        <p className="mb-4 text-xs text-slate-500">
          No leagues synced yet. Configure league IDs in services/ingestion/.env and run
          python -m fantasy_ingest.sync_leagues.
        </p>
      ) : (
        Array.from(grouped.entries()).map(([sportId, sportLeagues]) => (
          <div key={sportId} className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-500">
              {SPORT_LABELS[sportId] ?? sportId}
            </h3>
            <div className="space-y-2">
              {sportLeagues.map((league) => (
                <Link
                  key={league.id}
                  href={`/leagues/${league.id}`}
                  className="block rounded-md border border-slate-800 p-3 text-sm text-slate-200 hover:border-slate-600"
                >
                  {league.name}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}

      <div className="mt-8 border-t border-slate-800 pt-4">
        <Link href="/players" className="text-xs text-slate-400 hover:text-slate-200">
          Browse all players →
        </Link>
      </div>
    </aside>
  );
}
```

- [x] **Step 2: Wire the sidebar into the shared layout**

Replace the contents of `apps/web/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Analytics Dashboard",
  description: "Multi-league fantasy sports analytics dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 p-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [x] **Step 3: Relocate the existing player table to `/players`**

Create `apps/web/app/players/page.tsx` (this is today's `app/page.tsx` content, minus the `<aside>` sidebar and the outer flex/`<main>` wrapper — both now live in `layout.tsx`):

```typescript
import { fetchTopPlayers, type WarehousePlayer } from "@/lib/players";

interface SportSection {
  sportId: string;
  label: string;
  players: WarehousePlayer[];
  error: string | null;
}

async function loadSport(sportId: string, label: string): Promise<SportSection> {
  try {
    return { sportId, label, players: await fetchTopPlayers(sportId, 10), error: null };
  } catch (error) {
    return {
      sportId,
      label,
      players: [],
      error: error instanceof Error ? error.message : "Unknown error querying the warehouse",
    };
  }
}

function formatPrice(price: number | null): string {
  return price ? `£${price.toFixed(1)}m` : "—";
}

function formatPoints(points: number | null): string {
  return points ? String(points) : "—";
}

function formatForm(form: number | null): string {
  return form ? form.toFixed(1) : "—";
}

export default async function PlayersPage() {
  const sections = await Promise.all([
    loadSport("premier-league", "Premier League"),
    loadSport("nfl", "NFL"),
  ]);

  return (
    <div>
      <h1 className="text-3xl font-bold">Browse Players</h1>
      <p className="mt-3 max-w-xl text-slate-400">
        Top players synced into the warehouse, by platform — a global catalog, not tied to any
        specific league or roster. For your actual teams, use the league nav on the left.
      </p>

      {sections.map((section) => (
        <section key={section.sportId} className="mt-8">
          <h2 className="text-lg font-semibold text-slate-200">
            {section.label} — top players by points
          </h2>

          {section.error ? (
            <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
              Couldn&apos;t load {section.label} data: {section.error}
            </p>
          ) : section.players.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No {section.label} data synced yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-md border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Player</th>
                    <th className="px-4 py-2 font-medium">Team</th>
                    <th className="px-4 py-2 font-medium">Pos</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Price</th>
                    <th className="px-4 py-2 font-medium">Points</th>
                    <th className="px-4 py-2 font-medium">Form</th>
                  </tr>
                </thead>
                <tbody>
                  {section.players.map((player) => (
                    <tr key={`${player.sourceId}-${player.externalId}`} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-200">{player.name}</td>
                      <td className="px-4 py-2 text-slate-400">{player.team ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-400">{player.position ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{player.sourceId}</td>
                      <td className="px-4 py-2 text-slate-400">{formatPrice(player.price)}</td>
                      <td className="px-4 py-2 text-slate-200">{formatPoints(player.totalPoints)}</td>
                      <td className="px-4 py-2 text-slate-400">{formatForm(player.form)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [x] **Step 4: Rewrite the homepage as a redirect to the first league**

Replace the contents of `apps/web/app/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import { fetchLeagues } from "@/lib/leagues";

export default async function Home() {
  let leagues;
  try {
    leagues = await fetchLeagues();
  } catch (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
          Couldn&apos;t load leagues:{" "}
          {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
        </p>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 max-w-xl text-slate-400">
          No leagues synced yet. Configure your league IDs in{" "}
          <code className="rounded bg-slate-900 px-1 py-0.5">services/ingestion/.env</code> and run{" "}
          <code className="rounded bg-slate-900 px-1 py-0.5">python -m fantasy_ingest.sync_leagues</code>, or{" "}
          <a href="/players" className="text-sky-400 hover:underline">
            browse all players
          </a>{" "}
          in the meantime.
        </p>
      </div>
    );
  }

  redirect(`/leagues/${leagues[0].id}`);
}
```

- [x] **Step 5: Type-check**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0

- [x] **Step 6: Commit**

```bash
git add apps/web/components/Sidebar.tsx apps/web/app/layout.tsx apps/web/app/players/page.tsx apps/web/app/page.tsx
git commit -m "Make the sidebar a real league nav; relocate player table to /players"
```

---

### Task 3: `/leagues/[leagueId]` team-view page

**Files:**
- Create: `apps/web/app/leagues/[leagueId]/page.tsx`

- [x] **Step 1: Write the page**

Create `apps/web/app/leagues/[leagueId]/page.tsx`:

```typescript
import Link from "next/link";
import { fetchLeagueTeamView } from "@/lib/leagues";

function formatPoints(points: number | null): string {
  return points === null ? "—" : points.toFixed(1);
}

interface RosterRowView {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
}

function TeamPanel({
  teamName,
  points,
  roster,
}: {
  teamName: string;
  points: number | null;
  roster: RosterRowView[];
}) {
  return (
    <div className="rounded-md border border-slate-800 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{teamName}</h3>
        <span className="text-xl font-bold text-slate-100">{formatPoints(points)}</span>
      </div>

      {roster.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No roster data for this week.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Player</th>
              <th className="py-1 font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((player) => (
              <tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <td className="py-1 text-slate-200">{player.playerName}</td>
                <td className="py-1 text-slate-300">{formatPoints(player.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function LeagueTeamViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { leagueId: leagueIdParam } = await params;
  const { week: weekParam } = await searchParams;

  const leagueId = Number.parseInt(leagueIdParam, 10);
  if (!Number.isFinite(leagueId)) {
    return (
      <p className="rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
        Invalid league id: {leagueIdParam}
      </p>
    );
  }

  const parsedWeek = weekParam ? Number.parseInt(weekParam, 10) : NaN;
  const requestedWeek = Number.isFinite(parsedWeek) ? parsedWeek : undefined;

  let view;
  try {
    view = await fetchLeagueTeamView(leagueId, requestedWeek);
  } catch (error) {
    return (
      <p className="rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
        Couldn&apos;t load this league:{" "}
        {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
      </p>
    );
  }

  const {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings,
  } = view;

  return (
    <div>
      <h1 className="text-3xl font-bold">{league.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {league.format === "head_to_head" ? "Head-to-head" : "Classic"} · {league.season}
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        {week > 1 ? (
          <Link href={`/leagues/${league.id}?week=${week - 1}`} className="text-sky-400 hover:underline">
            ← Week {week - 1}
          </Link>
        ) : (
          <span className="text-slate-600">← Week {week - 1}</span>
        )}
        <span className="font-semibold text-slate-200">Week {week}</span>
        {week < latestWeek ? (
          <Link href={`/leagues/${league.id}?week=${week + 1}`} className="text-sky-400 hover:underline">
            Week {week + 1} →
          </Link>
        ) : (
          <span className="text-slate-600">Week {week + 1} →</span>
        )}
      </div>

      <div className={`mt-6 grid gap-6 ${opponentTeam ? "md:grid-cols-2" : ""}`}>
        <TeamPanel teamName={myTeam.teamName} points={myScore?.points ?? null} roster={myRoster} />
        {opponentTeam && (
          <TeamPanel
            teamName={opponentTeam.teamName}
            points={opponentScore?.points ?? null}
            roster={opponentRoster}
          />
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-200">Standings</h2>
        <p className="mt-1 text-xs text-slate-500">Each team&apos;s most recently synced score.</p>
        <div className="mt-3 overflow-hidden rounded-md border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Team</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Week</th>
                <th className="px-4 py-2 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr key={row.team.externalTeamId} className="border-t border-slate-800">
                  <td className="px-4 py-2 text-slate-200">
                    {row.team.teamName}
                    {row.team.isMine && <span className="ml-2 text-xs text-sky-400">(mine)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-400">{row.team.ownerName}</td>
                  <td className="px-4 py-2 text-slate-400">{row.week}</td>
                  <td className="px-4 py-2 text-slate-200">{formatPoints(row.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [x] **Step 2: Type-check**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0

- [x] **Step 3: Commit**

```bash
git add apps/web/app/leagues/[leagueId]/page.tsx
git commit -m "Add /leagues/[leagueId] team-view page"
```

---

### Task 4: Build + browser verification

**Files:** none (verification only)

- [x] **Step 1: Install dependencies if needed**

Run: `cd apps/web && npm install`

- [x] **Step 2: Type-check the whole app**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0

- [x] **Step 3: Attempt a production build**

Run: `cd apps/web && npm run build`
Expected: succeeds. If it fails specifically because Next.js tries to prerender a Supabase-backed page and hits this sandbox's blocked egress to `*.supabase.co` (not a type error, not a syntax error — a network/timeout error during the "Collecting page data" or static-generation phase), that is the same pre-existing sandbox limitation `CLAUDE.md` documents for this app's existing Supabase-backed pages, not a bug in this task's code. Note it and move on to the dev-server check, which uses the same live-reload path the repo owner would actually use.

- [x] **Step 4: Start the dev server and check it in the browser**

Use the Browser tool (`preview_start` with a `.claude/launch.json` entry running `npm run dev` in `apps/web`, port 3000 — create that config file if it doesn't already exist) and visit:
- `/` — expect either a redirect to `/leagues/<id>` (if any leagues are configured — unlikely in this sandbox, since no real sync has run yet) or the "No leagues synced yet" empty state with a working "browse all players" link.
- `/players` — expect the same top-10-by-sport tables that used to be on the homepage, now at this URL, showing real synced FPL/Sleeper data (this data already exists in the warehouse from the backend's own earlier live sync, per `CLAUDE.md`).
- If any league IDs happen to be configured and synced, visit `/leagues/<id>` directly and confirm the week selector, team panel(s), and standings table render without crashing — even with sparse/no data, confirm the graceful "No roster data for this week" states show correctly rather than a hard error.

Report what was actually observed (which state — redirect, empty-state, or live data — since this sandbox likely can't reach Supabase to confirm the full happy path, same caveat as the backend plan's own live-sync verification).

- [x] **Step 5: Report findings**

No commit for this task (verification only) — if Step 4 surfaces a real bug (not the known network limitation), fix it in the relevant task's file and re-run this task's checks before considering the plan complete.
