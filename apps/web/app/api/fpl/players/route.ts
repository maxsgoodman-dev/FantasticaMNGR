import { NextResponse } from "next/server";
import { fetchTopPlayers } from "@/lib/fpl";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10);

  try {
    const players = await fetchTopPlayers(Number.isFinite(limit) ? limit : 10);
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error fetching FPL data" },
      { status: 502 }
    );
  }
}
