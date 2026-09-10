import Card from "./Card";
import Badge from "./Badge";
import SectionHeader from "./SectionHeader";
import type { TeamStrengthRow } from "@/lib/leagues";

export interface WeakSpot {
  playerName: string;
  tradeValue: number;
}

export interface ToughFixture {
  playerName: string;
  difficultyScore: number;
}

function formatStrengthStat(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

export default function MatchupPrepCard({
  opponentTeamName,
  weakSpots,
  opponentStrength,
  toughFixtures,
}: {
  opponentTeamName: string;
  weakSpots: WeakSpot[];
  opponentStrength: TeamStrengthRow | null;
  toughFixtures: ToughFixture[];
}) {
  return (
    <Card className="mt-6">
      <SectionHeader title="Matchup Prep" description="Current-week analysis while the games are still in progress." />

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Your weak spots
          </h4>
          {weakSpots.length === 0 ? (
            <p className="text-sm text-ink-faint">No standout weak spots yet — not enough consistency data.</p>
          ) : (
            <ul className="space-y-1.5">
              {weakSpots.map((spot) => (
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
          {opponentStrength == null ? (
            <p className="text-sm text-ink-faint">Not enough weekly history yet.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">Avg/wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(opponentStrength.avgWeeklyPoints)}</dd>
              <dt className="text-ink-muted">Stddev</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(opponentStrength.weeklyPointsStddev)}</dd>
              <dt className="text-ink-muted">Best wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(opponentStrength.bestWeekPoints)}</dd>
              <dt className="text-ink-muted">Worst wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(opponentStrength.worstWeekPoints)}</dd>
            </dl>
          )}
        </div>
      </div>

      {toughFixtures.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h4
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint"
            title="Difficulty score is the community FPL sheet's own next-6-gameweek scale — lower means an easier run. Not an official FPL metric."
          >
            Tough fixture run ahead
          </h4>
          <ul className="space-y-1.5">
            {toughFixtures.map((fixture) => (
              <li key={fixture.playerName} className="flex items-center justify-between text-sm">
                <span className="text-ink-primary">{fixture.playerName}</span>
                <Badge variant="tie">difficulty {fixture.difficultyScore.toFixed(0)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
