import SidebarNav from "@/components/SidebarNav";
import NavItem from "@/components/ui/NavItem";
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
    <aside className="w-64 shrink-0 border-r border-border bg-canvas p-6">
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
        <NavItem
          href="/players"
          icon={
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <path d="M1.5 6h13M6 6v8.5" />
            </svg>
          }
        >
          Browse all players
        </NavItem>
      </div>
    </aside>
  );
}
