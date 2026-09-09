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
