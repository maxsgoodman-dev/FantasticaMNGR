import { NextResponse } from "next/server";
import { fetchTopPlayers } from "@/lib/players";

const VALID_SPORTS = new Set(["nfl", "premier-league"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") ?? "premier-league";
  const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10);

  if (!VALID_SPORTS.has(sport)) {
    return NextResponse.json({ error: `unknown sport: ${sport}` }, { status: 400 });
  }

  try {
    const players = await fetchTopPlayers(sport, Number.isFinite(limit) ? limit : 10);
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error querying the warehouse" },
      { status: 502 }
    );
  }
}
