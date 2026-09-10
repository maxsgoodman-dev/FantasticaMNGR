import { redirect } from "next/navigation";
import { fetchLeagues } from "@/lib/leagues";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

export default async function Home() {
  let leagues;
  try {
    leagues = await fetchLeagues();
  } catch (error) {
    return (
      <div>
        <SectionHeader title="Fantasy Analytics Dashboard" size="lg" />
        <Card className="mt-4 border-red-900/50 bg-red-950/30">
          <p className="text-sm text-red-400">
            Couldn&apos;t load leagues:{" "}
            {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
          </p>
        </Card>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div>
        <SectionHeader title="Fantasy Analytics Dashboard" size="lg" />
        <Card className="mt-4 max-w-xl">
          <p className="text-sm text-ink-muted">
            No leagues synced yet. Configure your league IDs in{" "}
            <code className="rounded bg-surface-hover px-1 py-0.5 text-ink-primary">
              services/ingestion/.env
            </code>{" "}
            and run{" "}
            <code className="rounded bg-surface-hover px-1 py-0.5 text-ink-primary">
              python -m fantasy_ingest.sync_leagues
            </code>
            , or{" "}
            <a href="/players" className="text-accent hover:underline">
              browse all players
            </a>{" "}
            in the meantime.
          </p>
        </Card>
      </div>
    );
  }

  redirect(`/leagues/${leagues[0].id}`);
}
