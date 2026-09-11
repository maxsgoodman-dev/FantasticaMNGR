import Card from "./Card";
import SectionHeader from "./SectionHeader";
import Avatar from "./Avatar";
import Badge from "./Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "./Table";

export interface NextGameweekPreviewPlayerRow {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  projectedPoints: number | null;
  nextFixture: string | null;
}

function formatProjected(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function RosterColumn({
  teamName,
  roster,
}: {
  teamName: string;
  roster: NextGameweekPreviewPlayerRow[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Avatar name={teamName} size="sm" />
        <h4 className="text-sm font-semibold text-ink-primary">{teamName}</h4>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Player</Th>
              <Th>Proj.</Th>
              <Th>Next fixture</Th>
            </Tr>
          </Thead>
          <Tbody>
            {roster.map((player) => (
              <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <Td>
                  <div className="flex items-center gap-2">
                    {player.playerName}
                    <Badge variant={player.isStarter ? "starter" : "bench"}>
                      {player.isStarter ? "Starter" : "Bench"}
                    </Badge>
                  </div>
                </Td>
                <Td>{formatProjected(player.projectedPoints)}</Td>
                <Td>{player.nextFixture ?? "—"}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

export default function NextGameweekPreviewCard({
  week,
  myTeamName,
  opponentTeamName,
  myRoster,
  opponentRoster,
}: {
  week: number;
  myTeamName: string;
  opponentTeamName: string;
  myRoster: NextGameweekPreviewPlayerRow[];
  opponentRoster: NextGameweekPreviewPlayerRow[];
}) {
  return (
    <Card className="mt-6">
      <SectionHeader
        title={`Next Gameweek Preview — Week ${week}`}
        description={`Current squads shown below — subject to change before the Gameweek ${week} deadline.`}
      />
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <RosterColumn teamName={myTeamName} roster={myRoster} />
        <RosterColumn teamName={opponentTeamName} roster={opponentRoster} />
      </div>
    </Card>
  );
}
