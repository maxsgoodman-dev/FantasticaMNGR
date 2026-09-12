import { NextResponse } from "next/server";
import { searchPlayers } from "@/lib/playerSearch";

// New endpoint (rather than adding ?search=/?source= to the existing
// GET /api/players) so this feature ships as new files only — see
// components/ui/TransferTargetSearch.tsx, which is this route's only
// consumer. The two routes' query-param handling is intentionally
// near-identical; app/api/players/route.ts is the natural place to
// merge this into later if the two ever want to become one endpoint.
const VALID_SPORTS = new Set(["nfl", "premier-league"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") ?? "premier-league";
  const source = searchParams.get("source") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);

  if (!VALID_SPORTS.has(sport)) {
    return NextResponse.json({ error: `unknown sport: ${sport}` }, { status: 400 });
  }

  try {
    const players = await searchPlayers({
      sportId: sport,
      sourceId: source,
      search,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error querying the warehouse" },
      { status: 502 }
    );
  }
}
