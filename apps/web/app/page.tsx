export default function Home() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-800 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Leagues
        </h2>
        <div className="rounded-md border border-dashed border-slate-800 p-4 text-sm text-slate-500">
          No leagues connected yet.
        </div>
      </aside>

      <main className="flex-1 p-10">
        <h1 className="text-3xl font-bold">Fantasy Analytics Dashboard</h1>
        <p className="mt-3 max-w-xl text-slate-400">
          Connect an ESPN, Sleeper, Yahoo, or Fantasy Premier League account to
          see projections, matchup breakdowns, and trade opportunities across
          all of your leagues in one place. Coming soon.
        </p>
      </main>
    </div>
  );
}
