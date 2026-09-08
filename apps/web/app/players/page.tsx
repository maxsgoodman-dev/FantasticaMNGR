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
