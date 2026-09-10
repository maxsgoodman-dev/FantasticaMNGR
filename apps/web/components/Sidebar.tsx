import SidebarNav from "@/components/SidebarNav";
import SidebarShell from "@/components/SidebarShell";
import PlayersNavLink from "@/components/PlayersNavLink";
import { fetchLeagues, type League } from "@/lib/leagues";

export default async function Sidebar() {
  let leagues: League[] = [];
  let error: string | null = null;

  try {
    leagues = await fetchLeagues();
  } catch (fetchError) {
    error = fetchError instanceof Error ? fetchError.message : "Unknown error querying the warehouse";
  }

  return (
    <SidebarShell>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Leagues</h2>

      {error ? (
        <p className="mb-4 text-xs text-red-400">Couldn&apos;t load leagues: {error}</p>
      ) : leagues.length === 0 ? (
        <p className="mb-4 text-xs text-ink-faint">
          No leagues synced yet. Configure league IDs in services/ingestion/.env and run
          python -m fantasy_ingest.sync_leagues.
        </p>
      ) : (
        <SidebarNav leagues={leagues} />
      )}

      <div className="mt-8 border-t border-border pt-4">
        <PlayersNavLink />
      </div>
    </SidebarShell>
  );
}
