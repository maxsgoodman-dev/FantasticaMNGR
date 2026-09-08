import Link from "next/link";
import { fetchLeagueTeamView } from "@/lib/leagues";

function formatPoints(points: number | null): string {
  return points === null ? "—" : points.toFixed(1);
}

interface RosterRowView {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
}

function TeamPanel({
  teamName,
  points,
  roster,
}: {
  teamName: string;
  points: number | null;
  roster: RosterRowView[];
}) {
  return (
    <div className="rounded-md border border-slate-800 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{teamName}</h3>
        <span className="text-xl font-bold text-slate-100">{formatPoints(points)}</span>
      </div>

      {roster.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No roster data for this week.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Player</th>
              <th className="py-1 font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((player) => (
              <tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <td className="py-1 text-slate-200">{player.playerName}</td>
                <td className="py-1 text-slate-300">{formatPoints(player.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function LeagueTeamViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { leagueId: leagueIdParam } = await params;
  const { week: weekParam } = await searchParams;

  const leagueId = Number.parseInt(leagueIdParam, 10);
  if (!Number.isFinite(leagueId)) {
    return (
      <p className="rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
        Invalid league id: {leagueIdParam}
      </p>
    );
  }

  const parsedWeek = weekParam ? Number.parseInt(weekParam, 10) : NaN;
  const requestedWeek = Number.isFinite(parsedWeek) ? parsedWeek : undefined;

  let view;
  try {
    view = await fetchLeagueTeamView(leagueId, requestedWeek);
  } catch (error) {
    return (
      <p className="rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
        Couldn&apos;t load this league:{" "}
        {error instanceof Error ? error.message : "Unknown error querying the warehouse"}
      </p>
    );
  }

  const {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings,
  } = view;

  return (
    <div>
      <h1 className="text-3xl font-bold">{league.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {league.format === "head_to_head" ? "Head-to-head" : "Classic"} · {league.season}
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        {week > 1 ? (
          <Link href={`/leagues/${league.id}?week=${week - 1}`} className="text-sky-400 hover:underline">
            ← Week {week - 1}
          </Link>
        ) : (
          <span className="text-slate-600">← Week {week - 1}</span>
        )}
        <span className="font-semibold text-slate-200">Week {week}</span>
        {week < latestWeek ? (
          <Link href={`/leagues/${league.id}?week=${week + 1}`} className="text-sky-400 hover:underline">
            Week {week + 1} →
          </Link>
        ) : (
          <span className="text-slate-600">Week {week + 1} →</span>
        )}
      </div>

      <div className={`mt-6 grid gap-6 ${opponentTeam ? "md:grid-cols-2" : ""}`}>
        <TeamPanel teamName={myTeam.teamName} points={myScore?.points ?? null} roster={myRoster} />
        {opponentTeam && (
          <TeamPanel
            teamName={opponentTeam.teamName}
            points={opponentScore?.points ?? null}
            roster={opponentRoster}
          />
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-200">Standings</h2>
        <p className="mt-1 text-xs text-slate-500">Each team&apos;s most recently synced score.</p>
        <div className="mt-3 overflow-hidden rounded-md border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Team</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Week</th>
                <th className="px-4 py-2 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr key={row.team.externalTeamId} className="border-t border-slate-800">
                  <td className="px-4 py-2 text-slate-200">
                    {row.team.teamName}
                    {row.team.isMine && <span className="ml-2 text-xs text-sky-400">(mine)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-400">{row.team.ownerName}</td>
                  <td className="px-4 py-2 text-slate-400">{row.week}</td>
                  <td className="px-4 py-2 text-slate-200">{formatPoints(row.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
