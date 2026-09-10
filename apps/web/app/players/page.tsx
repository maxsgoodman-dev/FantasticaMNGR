import { fetchTopPlayers, type WarehousePlayer } from "@/lib/players";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Badge from "@/components/ui/Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";

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
      <SectionHeader title="Browse Players" size="lg" />
      <Card className="mt-4 max-w-2xl">
        <p className="text-sm text-ink-muted">
          Top players synced into the warehouse, by platform — a global catalog, not tied to any
          specific league or roster. For your actual teams, use the league nav on the left.
        </p>
      </Card>

      {sections.map((section) => (
        <section key={section.sportId} className="mt-8">
          <SectionHeader title={`${section.label} — top players by points`} />

          {section.error ? (
            <Card className="mt-3 border-red-900/50 bg-red-950/30">
              <p className="text-sm text-red-400">
                Couldn&apos;t load {section.label} data: {section.error}
              </p>
            </Card>
          ) : section.players.length === 0 ? (
            <Card className="mt-3">
              <p className="text-sm text-ink-faint">No {section.label} data synced yet.</p>
            </Card>
          ) : (
            <Card className="mt-3 overflow-hidden p-0">
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Player</Th>
                      <Th>Team</Th>
                      <Th>Pos</Th>
                      <Th>Source</Th>
                      <Th>Price</Th>
                      <Th>Points</Th>
                      <Th>Form</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {section.players.map((player) => (
                      <Tr key={`${player.sourceId}-${player.externalId}`}>
                        <Td className="font-medium">{player.name}</Td>
                        <Td className="text-ink-muted">{player.team ?? "—"}</Td>
                        <Td>{player.position ? <Badge>{player.position}</Badge> : "—"}</Td>
                        <Td className="text-ink-faint">{player.sourceId}</Td>
                        <Td className="text-ink-muted">{formatPrice(player.price)}</Td>
                        <Td>{formatPoints(player.totalPoints)}</Td>
                        <Td className="text-ink-muted">{formatForm(player.form)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}
