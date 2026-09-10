import Link from "next/link";
import {
  fetchLeagueTeamView,
  type FplSheetPlayerRow,
  type PlayerValueRow,
  type RosterPlayerRow,
  type StandingsRow,
} from "@/lib/leagues";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import SectionHeader from "@/components/ui/SectionHeader";
import TeamCompareChart from "@/components/ui/TeamCompareChart";
import MatchupPrepCard, { type ToughFixture, type WeakSpot } from "@/components/ui/MatchupPrepCard";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";

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

const RESULT_TONE = { W: "win", L: "loss", T: "tie" } as const;

// Lower coefficient of variation = steadier week-to-week output. Dashes for
// both "no view row" (fewer than 2 weeks recorded, e.g. a player who just
// joined the roster) and "row exists but avg_points is 0" (ratio undefined)
// — see docs/superpowers/specs/2026-09-10-consistency-score-ui-design.md.
function formatConsistency(value: PlayerValueRow | null): string {
  return value?.coefficientOfVariation == null ? "—" : value.coefficientOfVariation.toFixed(2);
}

// Unlike coefficientOfVariation, trade_value is never null once a row
// exists — avg_points = 0 still yields a real (if minimal) trade_value —
// so this only needs to check for a missing row entirely. See
// docs/superpowers/specs/2026-09-11-trade-value-team-strength-ui-design.md.
function formatTradeValue(value: PlayerValueRow | null): string {
  return value == null ? "—" : value.tradeValue.toFixed(2);
}

function playerValueTitle(value: PlayerValueRow | null): string | undefined {
  return value
    ? `avg ${value.avgPoints} ± ${value.pointsStddev} pts over ${value.weeksPlayed} weeks`
    : undefined;
}

function formatShare(share: number | null | undefined): string {
  return share == null ? "—" : `${Math.round(share * 100)}%`;
}

function sumPoints(roster: RosterPlayerRow[], starter: boolean): number {
  return roster.filter((player) => player.isStarter === starter).reduce((sum, player) => sum + player.points, 0);
}

// 0-100, higher = steadier. Omits players with no consistency data yet
// (fewer than 2 weeks recorded) rather than treating them as zero-variance.
function steadiness(roster: RosterPlayerRow[]): number {
  const cvs = roster
    .map((player) => player.playerValue?.coefficientOfVariation)
    .filter((cv): cv is number => cv != null);
  if (cvs.length === 0) return 0;
  const avgCv = cvs.reduce((sum, cv) => sum + cv, 0) / cvs.length;
  return Math.max(0, 100 - Math.min(avgCv, 1) * 100);
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
function computeWeakSpots(roster: RosterRowView[]): WeakSpot[] {
  const rated = roster.filter(
    (player): player is RosterRowView & { playerValue: PlayerValueRow } =>
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
  roster: RosterRowView[],
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

interface RosterRowView {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
  playerValue: PlayerValueRow | null;
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
    <Card className="p-0">
      <div className="flex items-baseline justify-between px-5 pt-5">
        <div className="flex items-center gap-2">
          <Avatar name={teamName} />
          <h3 className="text-lg font-semibold text-ink-primary">{teamName}</h3>
        </div>
        <span className="text-xl font-bold text-ink-primary">{formatPoints(points)}</span>
      </div>

      {roster.length === 0 ? (
        <p className="px-5 pb-5 pt-3 text-sm text-ink-faint">No roster data for this week.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Player</Th>
                <Th>Points</Th>
                <Th title="Coefficient of variation — lower means steadier week-to-week output">
                  Consistency
                </Th>
                <Th title="avg_points / (1 + coefficient of variation) — a single scoring+reliability figure, higher is better">
                  Trade Value
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {roster.map((player) => (
                <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                  <Td className="flex items-center gap-2">
                    {player.playerName}
                    <Badge variant={player.isStarter ? "starter" : "bench"}>
                      {player.isStarter ? "Starter" : "Bench"}
                    </Badge>
                  </Td>
                  <Td>{formatPoints(player.points)}</Td>
                  <Td className="text-ink-muted" title={playerValueTitle(player.playerValue)}>
                    {formatConsistency(player.playerValue)}
                  </Td>
                  <Td className="text-ink-muted" title={playerValueTitle(player.playerValue)}>
                    {formatTradeValue(player.playerValue)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </Card>
  );
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
    matchupPreview,
    fplSheetData,
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
                className="rounded px-2 py-1 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
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
            {week < latestWeek ? (
              <Link
                href={`/leagues/${league.id}?week=${week + 1}`}
                className="rounded px-2 py-1 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
              >
                Wk {week + 1} →
              </Link>
            ) : (
              <span className="rounded px-2 py-1 text-ink-faint">Wk {week + 1} →</span>
            )}
          </div>
        }
      />

      {opponentTeam && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="My Score" value={formatPoints(myPoints)} />
          <StatTile label="Opponent Score" value={formatPoints(opponentPoints)} />
          <StatTile label="Result" value={result ?? "—"} tone={result ? RESULT_TONE[result] : "default"} />
        </div>
      )}

      {opponentTeam && myProjected != null && opponentProjected != null && winProbability != null && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="My Projected" value={myProjected.toFixed(1)} sublabel="rest of this week" />
          <StatTile label="Opponent Projected" value={opponentProjected.toFixed(1)} sublabel="rest of this week" />
          <StatTile
            label="Win Probability"
            value={`${Math.round(winProbability * 100)}%`}
            tone={winProbability >= 0.5 ? "win" : "loss"}
          />
        </div>
      )}

      {opponentTeam && matchupPreview && (
        <MatchupPrepCard
          opponentTeamName={opponentTeam.teamName}
          weakSpots={weakSpots}
          opponentStrength={opponentStrength}
          toughFixtures={toughFixtures}
        />
      )}

      {opponentTeam && (
        <Card className="mt-6">
          <SectionHeader title="Head-to-Head Comparison" />
          <div className="mt-4">
            <TeamCompareChart
              myTeamName={myTeam.teamName}
              opponentTeamName={opponentTeam.teamName}
              metrics={[
                { label: "Starter Points", mine: sumPoints(myRoster, true), opponent: sumPoints(opponentRoster, true) },
                { label: "Bench Points", mine: sumPoints(myRoster, false), opponent: sumPoints(opponentRoster, false) },
                { label: "Steadiness", mine: steadiness(myRoster), opponent: steadiness(opponentRoster) },
              ]}
            />
          </div>
        </Card>
      )}

      <div className={`mt-6 grid gap-6 ${opponentTeam ? "lg:grid-cols-2" : ""}`}>
        <TeamPanel teamName={myTeam.teamName} points={myPoints} roster={myRoster} />
        {opponentTeam && (
          <TeamPanel teamName={opponentTeam.teamName} points={opponentPoints} roster={opponentRoster} />
        )}
      </div>

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
