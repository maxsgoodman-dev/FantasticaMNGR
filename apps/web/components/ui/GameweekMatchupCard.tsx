import Card from "./Card";
import SectionHeader from "./SectionHeader";
import Avatar from "./Avatar";
import Badge from "./Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "./Table";
import type { TeamStrengthRow } from "@/lib/leagues";

export interface WeakSpot {
  playerName: string;
  tradeValue: number;
}

export interface ToughFixture {
  playerName: string;
  difficultyScore: number;
}

export interface GameweekMatchupPlayerRow {
  playerExternalId: string;
  playerName: string;
  position: "GKP" | "DEF" | "MID" | "FWD" | null;
  isStarter: boolean;
  points: number | null;
  projectedPoints: number | null;
  nextFixture: string | null;
  consistency: number | null;
  tradeValue: number | null;
  impactPercent: number | null;
}

export interface GameweekMatchupTeamSummary {
  teamName: string;
  score: number | null;
  eventTransfers: number | null;
  eventTransfersCost: number | null;
  pointsOnBench: number | null;
  teamValue: number | null;
  overallRank: number | null;
  activeChip: string | null;
}

export interface GameweekMatchupInsights {
  weakSpots: WeakSpot[];
  toughFixtures: ToughFixture[];
  opponentScouting: TeamStrengthRow | null;
}

const POSITION_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

function positionRank(position: GameweekMatchupPlayerRow["position"]): number {
  return position != null ? POSITION_ORDER[position] ?? 4 : 4;
}

function sortRoster(roster: GameweekMatchupPlayerRow[]): GameweekMatchupPlayerRow[] {
  return [...roster].sort((a, b) => {
    if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
    const positionDiff = positionRank(a.position) - positionRank(b.position);
    if (positionDiff !== 0) return positionDiff;
    const aValue = a.points ?? a.projectedPoints ?? 0;
    const bValue = b.points ?? b.projectedPoints ?? 0;
    return bValue - aValue;
  });
}

const CHIP_LABELS: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

function formatChip(activeChip: string | null): string {
  if (!activeChip) return "—";
  return CHIP_LABELS[activeChip] ?? activeChip;
}

function formatNumber(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits);
}

function formatTransfers(summary: GameweekMatchupTeamSummary): string {
  if (summary.eventTransfers == null) return "—";
  const cost = summary.eventTransfersCost ?? 0;
  return cost > 0 ? `${summary.eventTransfers} (-${cost})` : `${summary.eventTransfers}`;
}

function formatRank(rank: number | null): string {
  return rank == null ? "—" : rank.toLocaleString();
}

function TeamHeader({
  summary,
  weekState,
}: {
  summary: GameweekMatchupTeamSummary;
  weekState: "future" | "played";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex items-center gap-2">
        <Avatar name={summary.teamName} />
        <h3 className="text-lg font-semibold text-ink-primary">{summary.teamName}</h3>
      </div>
      {weekState === "played" && (
        <span className="text-xl font-bold text-ink-primary">{formatNumber(summary.score)}</span>
      )}
    </div>
  );
}

function TeamStatsRow({ summary, weekState }: { summary: GameweekMatchupTeamSummary; weekState: "future" | "played" }) {
  if (weekState === "future") {
    return null;
  }
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm sm:grid-cols-4">
      <dt className="text-ink-muted">Transfers</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatTransfers(summary)}</dd>
      <dt className="text-ink-muted">Chip</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatChip(summary.activeChip)}</dd>
      <dt className="text-ink-muted">Bench pts</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatNumber(summary.pointsOnBench, 0)}</dd>
      <dt className="text-ink-muted">Team value</dt>
      <dd className="text-right text-ink-primary sm:text-left">
        {summary.teamValue == null ? "—" : `£${summary.teamValue.toFixed(1)}m`}
      </dd>
      <dt className="text-ink-muted">Overall rank</dt>
      <dd className="col-span-3 text-right text-ink-primary sm:text-left">{formatRank(summary.overallRank)}</dd>
    </dl>
  );
}

function RosterColumn({
  summary,
  weekState,
  week,
  roster,
}: {
  summary: GameweekMatchupTeamSummary;
  weekState: "future" | "played";
  week: number;
  roster: GameweekMatchupPlayerRow[];
}) {
  const sorted = sortRoster(roster);
  return (
    <div>
      <TeamHeader summary={summary} weekState={weekState} />
      <TeamStatsRow summary={summary} weekState={weekState} />
      {weekState === "future" && (
        <p className="mt-3 text-xs text-ink-faint">
          Current squad — subject to change before the Gameweek {week} deadline.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Player</Th>
              {weekState === "played" ? (
                <>
                  <Th>Points</Th>
                  <Th title="Coefficient of variation — lower means steadier week-to-week output">Consistency</Th>
                  <Th title="avg_points / (1 + coefficient of variation) — higher is better">Trade Value</Th>
                  <Th title="This player's points as a % of the opponent's starter average that week">Impact</Th>
                </>
              ) : (
                <>
                  <Th>Proj.</Th>
                  <Th>Next fixture</Th>
                </>
              )}
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((player) => (
              <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <Td>
                  <div className="flex items-center gap-2">
                    {player.position && (
                      <Badge variant="neutral">{player.position}</Badge>
                    )}
                    {player.playerName}
                    <Badge variant={player.isStarter ? "starter" : "bench"}>
                      {player.isStarter ? "Starter" : "Bench"}
                    </Badge>
                  </div>
                </Td>
                {weekState === "played" ? (
                  <>
                    <Td>{formatNumber(player.points)}</Td>
                    <Td className="text-ink-muted">{formatNumber(player.consistency, 2)}</Td>
                    <Td className="text-ink-muted">{formatNumber(player.tradeValue, 2)}</Td>
                    <Td className="text-ink-muted">
                      {player.impactPercent == null ? "—" : `${Math.round(player.impactPercent)}%`}
                    </Td>
                  </>
                ) : (
                  <>
                    <Td>{formatNumber(player.projectedPoints)}</Td>
                    <Td>{player.nextFixture ?? "—"}</Td>
                  </>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

function formatStrengthStat(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

function InsightsFooter({ myTeamName, opponentTeamName, insights }: {
  myTeamName: string;
  opponentTeamName: string;
  insights: GameweekMatchupInsights;
}) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {myTeamName}&apos;s weak spots
          </h4>
          {insights.weakSpots.length === 0 ? (
            <p className="text-sm text-ink-faint">No standout weak spots yet — not enough consistency data.</p>
          ) : (
            <ul className="space-y-1.5">
              {insights.weakSpots.map((spot) => (
                <li key={spot.playerName} className="flex items-center justify-between text-sm">
                  <span className="text-ink-primary">{spot.playerName}</span>
                  <Badge variant="loss">value {spot.tradeValue.toFixed(2)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Scouting {opponentTeamName}
          </h4>
          {insights.opponentScouting == null ? (
            <p className="text-sm text-ink-faint">Not enough weekly history yet.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">Avg/wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.avgWeeklyPoints)}</dd>
              <dt className="text-ink-muted">Stddev</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.weeklyPointsStddev)}</dd>
              <dt className="text-ink-muted">Best wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.bestWeekPoints)}</dd>
              <dt className="text-ink-muted">Worst wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.worstWeekPoints)}</dd>
            </dl>
          )}
        </div>
      </div>

      {insights.toughFixtures.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h4
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint"
            title="Difficulty score is the community FPL sheet's own next-6-gameweek scale — lower means an easier run. Not an official FPL metric."
          >
            Tough fixture run ahead
          </h4>
          <ul className="space-y-1.5">
            {insights.toughFixtures.map((fixture) => (
              <li key={fixture.playerName} className="flex items-center justify-between text-sm">
                <span className="text-ink-primary">{fixture.playerName}</span>
                <Badge variant="tie">difficulty {fixture.difficultyScore.toFixed(0)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function GameweekMatchupCard({
  weekState,
  week,
  result,
  winProbability,
  myTeam,
  opponentTeam,
  myRoster,
  opponentRoster,
  insights,
}: {
  weekState: "future" | "played";
  week: number;
  result: "W" | "L" | "T" | null;
  winProbability: number | null;
  myTeam: GameweekMatchupTeamSummary;
  opponentTeam: GameweekMatchupTeamSummary;
  myRoster: GameweekMatchupPlayerRow[];
  opponentRoster: GameweekMatchupPlayerRow[];
  insights: GameweekMatchupInsights | null;
}) {
  const RESULT_TONE = { W: "win", L: "loss", T: "tie" } as const;

  return (
    <Card className="mt-6">
      <SectionHeader
        title={weekState === "future" ? `Next Gameweek Preview — Week ${week}` : `Week ${week} Matchup`}
        description={
          weekState === "future"
            ? `Current squads shown below — subject to change before the Gameweek ${week} deadline.`
            : "Full breakdown of this week's head-to-head matchup."
        }
        controls={
          weekState === "played" && result ? (
            <div className="flex items-center gap-3">
              <Badge variant={RESULT_TONE[result]}>{result}</Badge>
              {winProbability != null && (
                <span className="text-xs text-ink-muted">{Math.round(winProbability * 100)}% win prob.</span>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <RosterColumn summary={myTeam} weekState={weekState} week={week} roster={myRoster} />
        <RosterColumn summary={opponentTeam} weekState={weekState} week={week} roster={opponentRoster} />
      </div>

      {insights && (
        <InsightsFooter myTeamName={myTeam.teamName} opponentTeamName={opponentTeam.teamName} insights={insights} />
      )}
    </Card>
  );
}
