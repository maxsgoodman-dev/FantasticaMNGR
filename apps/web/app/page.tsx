import { fetchTopPlayers, type Player } from "@/lib/fpl";

const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"];

async function loadTopPlayers(): Promise<{ players: Player[]; error: string | null }> {
  try {
    return { players: await fetchTopPlayers(10), error: null };
  } catch (error) {
    return {
      players: [],
      error: error instanceof Error ? error.message : "Unknown error fetching FPL data",
    };
  }
}

export default async function Home() {
  const { players, error } = await loadTopPlayers();

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-800 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Leagues
        </h2>
        <div className="rounded-md border border-slate-800 p-4 text-sm">
          <div className="font-medium text-slate-200">Fantasy Premier League</div>
          <div className="mt-1 text-xs text-slate-500">
            Live player data — no specific league connected yet.
          </div>
        </div>
        <div className="mt-3 rounded-md border border-dashed border-slate-800 p-4 text-sm text-slate-500">
          ESPN, Sleeper, Yahoo — not connected yet.
        </div>
      </aside>

      <main className="flex-1 p-10">
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 max-w-xl text-slate-400">
          Connect an ESPN, Sleeper, Yahoo, or Fantasy Premier League account to
          see projections, matchup breakdowns, and trade opportunities across
          all of your leagues in one place. Full connection flow is coming
          soon — below is live FPL player data as a first look.
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-200">
            FPL — Top 10 by total points
          </h2>

          {error ? (
            <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
              Couldn&apos;t load live FPL data: {error}
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-md border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Player</th>
                    <th className="px-4 py-2 font-medium">Team</th>
                    <th className="px-4 py-2 font-medium">Pos</th>
                    <th className="px-4 py-2 font-medium">Price</th>
                    <th className="px-4 py-2 font-medium">Points</th>
                    <th className="px-4 py-2 font-medium">Form</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.id} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-200">{player.name}</td>
                      <td className="px-4 py-2 text-slate-400">{player.team}</td>
                      <td className="px-4 py-2 text-slate-400">
                        {POSITION_ORDER.includes(player.position) ? player.position : "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-400">£{player.price.toFixed(1)}m</td>
                      <td className="px-4 py-2 text-slate-200">{player.totalPoints}</td>
                      <td className="px-4 py-2 text-slate-400">{player.form.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
