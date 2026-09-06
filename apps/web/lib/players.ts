import { supabase } from "@/lib/supabase";

export interface WarehousePlayer {
  id: number;
  sourceId: string;
  sportId: string;
  externalId: string;
  name: string;
  team: string | null;
  position: string | null;
  price: number | null;
  totalPoints: number | null;
  form: number | null;
}

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

export async function fetchTopPlayers(sportId: string, limit: number): Promise<WarehousePlayer[]> {
  const { data, error } = await supabase
    .from("players")
    .select("id, source_id, sport_id, external_id, name, team, position, price, total_points, form")
    .eq("sport_id", sportId)
    .order("total_points", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromRow);
}
