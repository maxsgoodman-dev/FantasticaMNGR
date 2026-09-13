import Link from "next/link";
import {
  fetchLeagueTeamView,
  type EntryGameweekStatRow,
  type FplSheetPlayerRow,
  type PlayerValueRow,
  type RosterPlayerRow,
  type StandingsRow,
} from "@/lib/leagues";
import SectionHeader from "@/components/ui/SectionHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import GameweekMatchupCard, {
  type GameweekMatchupInsights,
  type GameweekMatchupPlayerRow,
  type GameweekMatchupTeamSummary,
  type ToughFixture,
  type WeakSpot,
} from "@/components/ui/GameweekMatchupCard";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import StartingXIBoard from "@/components/ui/StartingXIBoard";
import TransferTargetSearch, { type StartingXIPlayer } from "@/components/ui/TransferTargetSearch";
import GoogleSheetWidget from "@/components/ui/GoogleSheetWidget";
import FplGameweekWidget from "@/components/ui/FplGameweekWidget";
import LiveFplTablesWidget from "@/components/ui/LiveFplTablesWidget";

function formatPoints(points: number | null): string {
  return points === null ? "—" : points.toFixed(1);
}

type Result = "W" | "L" | "T" | null;

function computeResult(myPoints: number | null, opponentPoints: number | null): Result {
  if (myPoints === null || opponentPoints === null) return null;
  if (myPoints > opponentPoints) return "W";
  if (myPoints < opponentPoints) return "L";
  return "T";
}

function formatShare(share: number | null | undefined): string {
  return share == null ? "—" : `${Math.round(share * 100)}%`;
}

// Win probability from projected point differential, normalized by the
// larger of the two projections so it behaves sensibly across very
// different scales (a 100+ point Sleeper week vs. a 40-60 point FPL
// week) rather than needing a sport-specific constant. This is a fixed
// logistic curve, not a fitted statistical model — a known v1
// simplification, documented in
// docs/superpowers/specs/2026-09-10-matchup-prep-design.md.
function computeWinProbability(myProjected: number, opponentProjected: number): number {
  const scale = Math.max(myProjected, opponentProjected, 1);
  const relativeDiff = (myProjected - opponentProjected) / scale;
  const steepness = 4;
  return 1 / (1 + Math.exp(-steepness * relativeDiff));
}

// Bottom quartile of starters by trade value (min 1) — players with both
// low scoring and low reliability, using data already fetched for the
// roster table. Starters with no trade-value row yet (too few recorded
// weeks) are excluded rather than treated as the weakest.
function computeWeakSpots(roster: RosterPlayerRow[]): WeakSpot[] {
  const rated = roster.filter(
    (player): player is RosterPlayerRow & { playerValue: PlayerValueRow } =>
      player.isStarter && player.playerValue != null
  );
  if (rated.length === 0) return [];
  const sorted = [...rated].sort((a, b) => a.playerValue.tradeValue - b.playerValue.tradeValue);
  const count = Math.max(1, Math.ceil(sorted.length / 4));
  return sorted.slice(0, count).map((player) => ({
    playerName: player.playerName,
    tradeValue: player.playerValue.tradeValue,
  }));
}

// The community sheet's difficulty_score is a next-6-gameweek scale
// where lower means easier — 15 is a fixed heuristic cutoff based on the
// handful of real scores seen while building this (Arsenal 14, Aston
// Villa 16, Bournemouth 17), not a computed league-wide median (this
// page doesn't have every team's score loaded). Documented as a v1
// simplification alongside the win-probability curve above.
const TOUGH_FIXTURE_THRESHOLD = 15;

function computeToughFixtures(
  roster: RosterPlayerRow[],
  fplSheetData: Map<string, FplSheetPlayerRow> | null
): ToughFixture[] {
  if (!fplSheetData) return [];
  const fixtures: ToughFixture[] = [];
  for (const player of roster) {
    if (!player.isStarter) continue;
    const sheetRow = fplSheetData.get(player.playerExternalId);
    if (sheetRow?.difficultyScore != null && sheetRow.difficultyScore > TOUGH_FIXTURE_THRESHOLD) {
      fixtures.push({ playerName: player.playerName, difficultyScore: sheetRow.difficultyScore });
    }
  }
  return fixtures;
}

function buildMatchupRoster(
  roster: RosterPlayerRow[],
  fplSheetData: Map<string, FplSheetPlayerRow> | null,
  projections: Map<string, number> | null,
  opposingRoster: RosterPlayerRow[],
  week: number,
  weekState: "future" | "played"
): GameweekMatchupPlayerRow[] {
  const opposingStarters = opposingRoster.filter((player) => player.isStarter);
  const opposingStarterAverage =
    opposingStarters.length === 0
      ? null
      : opposingStarters.reduce((sum, player) => sum + player.points, 0) / opposingStarters.length;

  return roster.map((player) => {
    const sheetRow = fplSheetData?.get(player.playerExternalId) ?? null;
    const fixture = sheetRow?.nextFixtures.find((f) => f.gw === week) ?? null;
    return {
      playerExternalId: player.playerExternalId,
      playerName: player.playerName,
      position: (sheetRow?.position as GameweekMatchupPlayerRow["position"]) ?? null,
      isStarter: player.isStarter,
      points: weekState === "played" ? player.points : null,
      projectedPoints: weekState === "future" ? projections?.get(player.playerExternalId) ?? null : null,
      nextFixture: fixture ? `${fixture.opponent} (${fixture.isHome ? "H" : "A"})` : null,
      consistency: weekState === "played" ? player.playerValue?.coefficientOfVariation ?? null : null,
      tradeValue: weekState === "played" ? player.playerValue?.tradeValue ?? null : null,
      impactPercent:
        weekState === "played" && opposingStarterAverage != null && opposingStarterAverage > 0
          ? (player.points / opposingStarterAverage) * 100
          : null,
    };
  });
}

function buildTeamSummary(
  teamName: string,
  score: number | null,
  entryStats: EntryGameweekStatRow | null
): GameweekMatchupTeamSummary {
  return {
    teamName,
    score,
    eventTransfers: entryStats?.eventTransfers ?? null,
    eventTransfersCost: entryStats?.eventTransfersCost ?? null,
    pointsOnBench: entryStats?.pointsOnBench ?? null,
    teamValue: entryStats?.teamValue ?? null,
    overallRank: entryStats?.overallRank ?? null,
    activeChip: entryStats?.activeChip ?? null,
  };
}

function StandingsDelta({ row }: { row: StandingsRow }) {
  if (row.previousPoints == null) {
    return <span className="text-ink-faint">—</span>;
  }
  const diff = row.points - row.previousPoints;
  if (diff === 0) {
    return <span className="text-ink-faint">— 0.0</span>;
  }
  const up = diff > 0;
  return (
    <span className={up ? "text-status-win" : "text-status-loss"}>
      {up ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}
    </span>
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
      <Card className="border-red-900/50 bg-red-950/30">
        <p className="text-sm text-red-400">Invalid league id: {leagueIdParam}</p>
      </Card>
    );
  }

  const parsedWeek = weekParam ? Number.parseInt(weekParam, 10) : NaN;
  const requestedWeek = Number.isFinite(parsedWeek) ? parsedWeek : undefined;

  let view;
  try {
    view = await fetchLeagueTeamView(leagueId, requestedWeek);
  } catch (error) {
    return (
      <Card className="border-red-900/50 bg-red-950/30">
        <p className="text-sm text-red-400">
          Couldn&apos;t load this league:{" "}
          {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
        </p>
      </Card>
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
    weekState,
    matchupPreview,
    fplSheetData,
    projections,
    entryGameweekStats,
  } = view;

  const myPoints = myScore?.points ?? null;
  const opponentPoints = opponentScore?.points ?? null;
  const result = computeResult(myPoints, opponentPoints);
  const isCurrentWeek = week === latestWeek;

  const myProjected = matchupPreview?.get(myTeam.externalTeamId)?.projectedPoints ?? null;
  const opponentProjected = opponentTeam
    ? matchupPreview?.get(opponentTeam.externalTeamId)?.projectedPoints ?? null
    : null;
  const winProbability =
    myProjected != null && opponentProjected != null ? computeWinProbability(myProjected, opponentProjected) : null;

  const weakSpots = matchupPreview ? computeWeakSpots(myRoster) : [];
  const toughFixtures = computeToughFixtures(myRoster, fplSheetData);
  const opponentStrength = opponentTeam
    ? standings.find((row) => row.team.externalTeamId === opponentTeam.externalTeamId)?.strength ?? null
    : null;

  return (
    <div>
      <SectionHeader
        title={league.name}
        size="lg"
        description={`${league.format === "head_to_head" ? "Head-to-head" : "Classic"} · ${league.season}`}
        controls={
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 text-sm">
            {week > 1 ? (
              <Link
                href={`/leagues/${league.id}?week=${week - 1}`}
                className="rounded px-2 py-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                ← Wk {week - 1}
              </Link>
            ) : (
              <span className="rounded px-2 py-1 text-ink-faint">← Wk {week - 1}</span>
            )}
            <span className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 font-semibold text-black">
              {isCurrentWeek && <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-black" />}
              Week {week}
            </span>
            {week < latestWeek + (league.sourceId === "fpl" && league.format === "head_to_head" ? 1 : 0) ? (
              <Link
                href={`/leagues/${league.id}?week=${week + 1}`}
                className="rounded px-2 py-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Wk {week + 1} →
              </Link>
            ) : (
              <span className="rounded px-2 py-1 text-ink-faint">Wk {week + 1} →</span>
            )}
          </div>
        }
      />

      {opponentTeam ? (
        <GameweekMatchupCard
          weekState={weekState}
          week={week}
          result={weekState === "played" ? result : null}
          winProbability={weekState === "played" && week === latestWeek ? winProbability : null}
          myTeam={buildTeamSummary(myTeam.teamName, myPoints, entryGameweekStats?.get(myTeam.externalTeamId) ?? null)}
          opponentTeam={buildTeamSummary(
            opponentTeam.teamName,
            opponentPoints,
            entryGameweekStats?.get(opponentTeam.externalTeamId) ?? null
          )}
          myRoster={buildMatchupRoster(myRoster, fplSheetData, projections, opponentRoster, week, weekState)}
          opponentRoster={buildMatchupRoster(opponentRoster, fplSheetData, projections, myRoster, week, weekState)}
          insights={
            weekState === "played" && week === latestWeek && matchupPreview
              ? { weakSpots, toughFixtures, opponentScouting: opponentStrength }
              : null
          }
        />
      ) : (
        <Card className="mt-6 p-0">
          <div className="flex items-baseline justify-between px-5 pt-5">
            <div className="flex items-center gap-2">
              <Avatar name={myTeam.teamName} />
              <h3 className="text-lg font-semibold text-ink-primary">{myTeam.teamName}</h3>
            </div>
            <span className="text-xl font-bold text-ink-primary">{formatPoints(myPoints)}</span>
          </div>
          {myRoster.length === 0 ? (
            <p className="px-5 pb-5 pt-3 text-sm text-ink-faint">No roster data for this week.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Player</Th>
                    <Th>Points</Th>
                    <Th title="Coefficient of variation — lower means steadier week-to-week output">Consistency</Th>
                    <Th title="avg_points / (1 + coefficient of variation) — higher is better">Trade Value</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {myRoster.map((player) => (
                    <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                      <Td className="flex items-center gap-2">
                        {player.playerName}
                        <Badge variant={player.isStarter ? "starter" : "bench"}>
                          {player.isStarter ? "Starter" : "Bench"}
                        </Badge>
                      </Td>
                      <Td>{formatPoints(player.points)}</Td>
                      <Td className="text-ink-muted">
                        {player.playerValue?.coefficientOfVariation == null
                          ? "—"
                          : player.playerValue.coefficientOfVariation.toFixed(2)}
                      </Td>
                      <Td className="text-ink-muted">
                        {player.playerValue == null ? "—" : player.playerValue.tradeValue.toFixed(2)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </Card>
      )}

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <StartingXIBoard
          teamName={myTeam.teamName}
          roster={buildMatchupRoster(myRoster, fplSheetData, projections, opponentRoster, week, weekState)}
          sportId={league.sportId}
        />
        {opponentTeam && (
          <StartingXIBoard
            teamName={opponentTeam.teamName}
            roster={buildMatchupRoster(opponentRoster, fplSheetData, projections, myRoster, week, weekState)}
            sportId={league.sportId}
          />
        )}
      </section>

      <section className="mt-10">
        <SectionHeader
          title="Transfer Targets"
          description={`Search the ${league.sourceId.toUpperCase()} player pool and compare against your current ${
            league.sportId === "premier-league" ? "starting XI" : "starting lineup"
          }.`}
        />
        <div className="mt-3">
          <TransferTargetSearch
            startingXI={myRoster
              .filter((player) => player.isStarter)
              .map(
                (player): StartingXIPlayer => ({
                  playerExternalId: player.playerExternalId,
                  playerName: player.playerName,
                  position: fplSheetData?.get(player.playerExternalId)?.position ?? "—",
                  points: player.points,
                  tradeValue: player.playerValue?.tradeValue ?? null,
                })
              )}
            sourceId={league.sourceId}
            sportId={league.sportId}
          />
        </div>
      </section>

      {league.sourceId === "fpl" && (
        <section className="mt-10 space-y-6">
          <SectionHeader title="External Trackers" description="Your other FPL tools, in one place." />
          <GoogleSheetWidget />
          <div className="grid gap-6 lg:grid-cols-2">
            <FplGameweekWidget />
            <LiveFplTablesWidget />
          </div>
        </section>
      )}

      <section className="mt-10">
        <SectionHeader title="Standings" description="Each team's most recently synced score." />
        <Card className="mt-3 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>#</Th>
                  <Th>Team</Th>
                  <Th>Owner</Th>
                  <Th>Week</Th>
                  <Th>Points</Th>
                  <Th>Change</Th>
                  <Th>Avg/Wk</Th>
                  <Th title="Weekly points standard deviation — higher means less predictable week to week">
                    Stddev
                  </Th>
                  <Th>Best Wk</Th>
                  <Th>Worst Wk</Th>
                  <Th title="Share of this team's synced roster points that came from starters, not bench — not guaranteed to equal the team's official weekly score (see fantasy_team_strength's own caveat re: captain-armband doubling)">
                    Starter Share
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {standings.map((row, index) => (
                  <Tr key={row.team.externalTeamId}>
                    <Td className="text-ink-muted">{index + 1}</Td>
                    <Td className="font-medium">
                      <div className="flex items-center gap-2">
                        <Avatar name={row.team.teamName} size="sm" />
                        {row.team.teamName}
                        {row.team.isMine && <Badge variant="accent">mine</Badge>}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">{row.team.ownerName}</Td>
                    <Td className="text-ink-muted">{row.week}</Td>
                    <Td>{formatPoints(row.points)}</Td>
                    <Td className="tabular-nums">
                      <StandingsDelta row={row} />
                    </Td>
                    <Td className="text-ink-muted">{formatPoints(row.strength?.avgWeeklyPoints ?? null)}</Td>
                    <Td className="text-ink-muted">{formatPoints(row.strength?.weeklyPointsStddev ?? null)}</Td>
                    <Td className="text-ink-muted">{formatPoints(row.strength?.bestWeekPoints ?? null)}</Td>
                    <Td className="text-ink-muted">{formatPoints(row.strength?.worstWeekPoints ?? null)}</Td>
                    <Td className="text-ink-muted">{formatShare(row.strength?.starterPointsShare)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </Card>
      </section>
    </div>
  );
}
