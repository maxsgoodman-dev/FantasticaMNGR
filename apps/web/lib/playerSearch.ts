import { supabase } from "@/lib/supabase";
import type { WarehousePlayer } from "@/lib/players";

// Deliberately decoupled from lib/players.ts's own PlayerRow/fromRow (a
// small amount of duplication) rather than importing its internals, so
// this file can be added without touching lib/players.ts or
// app/api/players/route.ts — see components/ui/TransferTargetSearch.tsx
// for why that mattered for this change.
interface PlayerRow {
  id: number;
  source_id: string;
  sport_id: string;
  external_id: string;
  name: string;
  team: string | null;
  position: string | null;
  price: number | null;
  total_points: number | null;
  form: number | null;
}

function fromRow(row: PlayerRow): WarehousePlayer {
  return {
    id: row.id,
    sourceId: row.source_id,
    sportId: row.sport_id,
    externalId: row.external_id,
    name: row.name,
    team: row.team,
    position: row.position,
    price: row.price,
    totalPoints: row.total_points,
    form: row.form,
  };
}

export interface SearchPlayersOptions {
  sportId: string;
  /** Scope to one platform's players (e.g. "fpl", "sleeper", "espn"). Omit to search across all sources for the sport. */
  sourceId?: string;
  /** Case-insensitive substring match on player name. Omit/empty to skip the name filter. */
  search?: string;
  limit?: number;
}

/**
 * Server-side search over the `players` warehouse table, filtered by
 * sport/source and an optional name substring. Used by
 * app/api/players/search/route.ts so the Transfer Targets search box
 * never has to pull the entire player table client-side.
 */
export async function searchPlayers(options: SearchPlayersOptions): Promise<WarehousePlayer[]> {
  const { sportId, sourceId, search, limit = 20 } = options;

  let query = supabase
    .from("players")
    .select("id, source_id, sport_id, external_id, name, team, position, price, total_points, form")
    .eq("sport_id", sportId);

  if (sourceId) {
    query = query.eq("source_id", sourceId);
  }

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    query = query.ilike("name", `%${trimmedSearch}%`);
  }

  const { data, error } = await query.order("total_points", { ascending: false }).limit(limit);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromRow);
}
