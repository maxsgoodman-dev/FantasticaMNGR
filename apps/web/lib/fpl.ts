const BOOTSTRAP_STATIC_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

const ELEMENT_TYPE_TO_POSITION: Record<number, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  price: number;
  totalPoints: number;
  form: number;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
}

interface RawTeam {
  id: number;
  name: string;
  short_name: string;
}

interface RawElement {
  id: number;
  first_name: string;
  second_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  total_points: number;
  form: string;
}

interface BootstrapStatic {
  teams: RawTeam[];
  elements: RawElement[];
}

// Mirrors the normalization in services/ingestion/fantasy_ingest/adapters/fpl.py —
// kept in sync by hand since the dashboard (TypeScript) and the ingestion
// service (Python) don't share a runtime yet.
export function normalizeTeams(raw: BootstrapStatic): Team[] {
  return raw.teams.map((team) => ({
    id: String(team.id),
    name: team.name,
    shortName: team.short_name,
  }));
}

export function normalizePlayers(raw: BootstrapStatic): Player[] {
  const teamsById = new Map(raw.teams.map((team) => [team.id, team.short_name]));

  return raw.elements.map((element) => ({
    id: String(element.id),
    name: `${element.first_name} ${element.second_name}`,
    team: teamsById.get(element.team) ?? "UNK",
    position: ELEMENT_TYPE_TO_POSITION[element.element_type] ?? "UNK",
    price: element.now_cost / 10,
    totalPoints: element.total_points,
    form: Number.parseFloat(element.form),
  }));
}

export async function fetchBootstrapStatic(): Promise<BootstrapStatic> {
  const response = await fetch(BOOTSTRAP_STATIC_URL, {
    // Live data during games, but no need to hit FPL on every request.
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new Error(`FPL bootstrap-static request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchTopPlayers(limit: number): Promise<Player[]> {
  const raw = await fetchBootstrapStatic();
  return normalizePlayers(raw)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit);
}
