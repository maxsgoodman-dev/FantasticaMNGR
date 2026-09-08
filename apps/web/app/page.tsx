import { redirect } from "next/navigation";
import { fetchLeagues } from "@/lib/leagues";

export default async function Home() {
  let leagues;
  try {
    leagues = await fetchLeagues();
  } catch (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
          Couldn&apos;t load leagues:{" "}
          {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
        </p>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 max-w-xl text-slate-400">
          No leagues synced yet. Configure your league IDs in{" "}
          <code className="rounded bg-slate-900 px-1 py-0.5">services/ingestion/.env</code> and run{" "}
          <code className="rounded bg-slate-900 px-1 py-0.5">python -m fantasy_ingest.sync_leagues</code>, or{" "}
          <a href="/players" className="text-sky-400 hover:underline">
            browse all players
          </a>{" "}
          in the meantime.
        </p>
      </div>
    );
  }

  redirect(`/leagues/${leagues[0].id}`);
}
