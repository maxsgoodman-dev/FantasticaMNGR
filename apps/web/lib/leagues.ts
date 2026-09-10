import { supabase } from "@/lib/supabase";

export interface League {
  id: number;
  sourceId: string;
  sportId: string;
  externalLeagueId: string;
  name: string;
  season: string;
  format: "head_to_head" | "classic";
}

export interface FantasyTeam {
  externalTeamId: string;
  teamName: string;
  ownerName: string;
  isMine: boolean;
}

export interface WeeklyScoreRow {
  externalTeamId: string;
  week: number;
  points: number;
  opponentExternalTeamId: string | null;
}

export interface RosterPlayerRow {
  externalTeamId: string;
  week: number;
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  points: number;
  playerValue: PlayerValueRow | null;
}

export interface PlayerValueRow {
  playerExternalId: string;
  weeksPlayed: number;
  avgPoints: number;
  pointsStddev: number;
  coefficientOfVariation: number | null;
  tradeValue: number;
}

export interface TeamStrengthRow {
  externalTeamId: string;
  weeksPlayed: number;
  avgWeeklyPoints: number;
  weeklyPointsStddev: number;
  bestWeekPoints: number;
  worstWeekPoints: number;
  starterPointsShare: number | null;
}

export interface StandingsRow {
  team: FantasyTeam;
  week: number;
  points: number;
  strength: TeamStrengthRow | null;
}

export interface LeagueTeamView {
  league: League;
  week: number;
  latestWeek: number;
  myTeam: FantasyTeam;
  myScore: WeeklyScoreRow | null;
  myRoster: RosterPlayerRow[];
  opponentTeam: FantasyTeam | null;
  opponentScore: WeeklyScoreRow | null;
  opponentRoster: RosterPlayerRow[];
  standings: StandingsRow[];
}

interface LeagueDbRow {
  id: number;
  source_id: string;
  sport_id: string;
  external_league_id: string;
  name: string;
  season: string;
  format: "head_to_head" | "classic";
}

interface FantasyTeamDbRow {
  external_team_id: string;
  team_name: string;
  owner_name: string;
  is_mine: boolean;
}

interface WeeklyScoreDbRow {
  external_team_id: string;
  week: number;
  points: number;
  opponent_external_team_id: string | null;
}

interface RosterPlayerDbRow {
  external_team_id: string;
  week: number;
  player_external_id: string;
  player_name: string;
  is_starter: boolean;
  points: number;
}

interface PlayerValueDbRow {
  player_external_id: string;
  weeks_played: number;
  avg_points: number;
  points_stddev: number;
  coefficient_of_variation: number | null;
  trade_value: number;
}

interface TeamStrengthDbRow {
  external_team_id: string;
  weeks_played: number;
  avg_weekly_points: number;
  weekly_points_stddev: number;
  best_week_points: number;
  worst_week_points: number;
  starter_points_share: number | null;
}

function fromLeagueRow(row: LeagueDbRow): League {
  return {
    id: row.id,
    sourceId: row.source_id,
    sportId: row.sport_id,
    externalLeagueId: row.external_league_id,
    name: row.name,
    season: row.season,
    format: row.format,
  };
}

function fromFantasyTeamRow(row: FantasyTeamDbRow): FantasyTeam {
  return {
    externalTeamId: row.external_team_id,
    teamName: row.team_name,
    ownerName: row.owner_name,
    isMine: row.is_mine,
  };
}

function fromWeeklyScoreRow(row: WeeklyScoreDbRow): WeeklyScoreRow {
  return {
    externalTeamId: row.external_team_id,
    week: row.week,
    points: row.points,
    opponentExternalTeamId: row.opponent_external_team_id,
  };
}

function fromRosterPlayerRow(row: RosterPlayerDbRow): RosterPlayerRow {
  return {
    externalTeamId: row.external_team_id,
    week: row.week,
    playerExternalId: row.player_external_id,
    playerName: row.player_name,
    isStarter: row.is_starter,
    points: row.points,
    // Filled in separately by fetchPlayerValues — roster_players and
    // player_trade_value are different tables/queries.
    playerValue: null,
  };
}

function fromPlayerValueRow(row: PlayerValueDbRow): PlayerValueRow {
  return {
    playerExternalId: row.player_external_id,
    weeksPlayed: row.weeks_played,
    avgPoints: row.avg_points,
    pointsStddev: row.points_stddev,
    coefficientOfVariation: row.coefficient_of_variation,
    tradeValue: row.trade_value,
  };
}

function fromTeamStrengthRow(row: TeamStrengthDbRow): TeamStrengthRow {
  return {
    externalTeamId: row.external_team_id,
    weeksPlayed: row.weeks_played,
    avgWeeklyPoints: row.avg_weekly_points,
    weeklyPointsStddev: row.weekly_points_stddev,
    bestWeekPoints: row.best_week_points,
    worstWeekPoints: row.worst_week_points,
    starterPointsShare: row.starter_points_share,
  };
}

export async function fetchLeagues(): Promise<League[]> {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, source_id, sport_id, external_league_id, name, season, format")
    .order("sport_id", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromLeagueRow);
}

export async function fetchLeagueById(leagueId: number): Promise<League | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, source_id, sport_id, external_league_id, name, season, format")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return data ? fromLeagueRow(data) : null;
}

async function fetchTeams(sourceId: string, externalLeagueId: string): Promise<FantasyTeam[]> {
  const { data, error } = await supabase
    .from("fantasy_teams")
    .select("external_team_id, team_name, owner_name, is_mine")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromFantasyTeamRow);
}

async function fetchWeeklyScoresForTeam(
  sourceId: string,
  externalLeagueId: string,
  externalTeamId: string
): Promise<WeeklyScoreRow[]> {
  const { data, error } = await supabase
    .from("weekly_scores")
    .select("external_team_id, week, points, opponent_external_team_id")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("external_team_id", externalTeamId)
    .order("week", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromWeeklyScoreRow);
}

async function fetchRoster(
  sourceId: string,
  externalLeagueId: string,
  externalTeamId: string,
  week: number
): Promise<RosterPlayerRow[]> {
  const { data, error } = await supabase
    .from("roster_players")
    .select("external_team_id, week, player_external_id, player_name, is_starter, points")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("external_team_id", externalTeamId)
    .eq("week", week)
    .order("is_starter", { ascending: false });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return (data ?? []).map(fromRosterPlayerRow);
}

export async function fetchPlayerValues(
  sourceId: string,
  externalLeagueId: string,
  playerExternalIds: string[]
): Promise<Map<string, PlayerValueRow>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("player_trade_value")
    .select(
      "player_external_id, weeks_played, avg_points, points_stddev, coefficient_of_variation, trade_value"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .in("player_external_id", playerExternalIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const values = (data ?? []).map(fromPlayerValueRow);
  return new Map(values.map((value) => [value.playerExternalId, value]));
}

async function fetchTeamStrength(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[]
): Promise<Map<string, TeamStrengthRow>> {
  if (externalTeamIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("fantasy_team_strength")
    .select(
      "external_team_id, weeks_played, avg_weekly_points, weekly_points_stddev, best_week_points, worst_week_points, starter_points_share"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .in("external_team_id", externalTeamIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const strengths = (data ?? []).map(fromTeamStrengthRow);
  return new Map(strengths.map((strength) => [strength.externalTeamId, strength]));
}

// "Standings" = each team's most recently synced weekly_scores row, not a
// specific week. For head-to-head leagues every team has full weekly
// history, so "most recent" naturally means "the current week" — but for
// the FPL classic league, everyone except the caller's own team only ever
// has ONE row (a season-cumulative snapshot from the last sync), so there's
// no meaningful per-week standings to show for them regardless of which
// week the caller is browsing their own roster history for. One
// implementation serves both cases correctly this way; it's intentionally
// decoupled from the page's week selector (see LeagueTeamViewPage).
async function fetchStandings(
  sourceId: string,
  externalLeagueId: string,
  teams: FantasyTeam[]
): Promise<StandingsRow[]> {
  const { data, error } = await supabase
    .from("weekly_scores")
    .select("external_team_id, week, points, opponent_external_team_id")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .order("week", { ascending: true });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const teamsById = new Map(teams.map((team) => [team.externalTeamId, team]));
  const latestByTeam = new Map<string, WeeklyScoreDbRow>();
  for (const row of data ?? []) {
    latestByTeam.set(row.external_team_id, row);
  }

  const standings: StandingsRow[] = [];
  for (const row of latestByTeam.values()) {
    const team = teamsById.get(row.external_team_id);
    if (team) {
      standings.push({ team, week: row.week, points: row.points, strength: null });
    }
  }

  return standings.sort((a, b) => b.points - a.points);
}

export async function fetchLeagueTeamView(leagueId: number, requestedWeek?: number): Promise<LeagueTeamView> {
  const league = await fetchLeagueById(leagueId);
  if (!league) {
    throw new Error(`no league found for id ${leagueId}`);
  }

  const teams = await fetchTeams(league.sourceId, league.externalLeagueId);
  const myTeam = teams.find((team) => team.isMine);
  if (!myTeam) {
    throw new Error(`no team flagged as mine in league ${leagueId} — has this league been synced yet?`);
  }

  const myWeeklyScores = await fetchWeeklyScoresForTeam(
    league.sourceId,
    league.externalLeagueId,
    myTeam.externalTeamId
  );
  const latestWeek = myWeeklyScores.reduce((max, score) => Math.max(max, score.week), 0);
  const week = requestedWeek ?? latestWeek;

  const myScore = myWeeklyScores.find((score) => score.week === week) ?? null;
  let myRoster = await fetchRoster(league.sourceId, league.externalLeagueId, myTeam.externalTeamId, week);

  let opponentTeam: FantasyTeam | null = null;
  let opponentScore: WeeklyScoreRow | null = null;
  let opponentRoster: RosterPlayerRow[] = [];

  if (league.format === "head_to_head" && myScore?.opponentExternalTeamId) {
    opponentTeam = teams.find((team) => team.externalTeamId === myScore.opponentExternalTeamId) ?? null;
    if (opponentTeam) {
      const opponentWeeklyScores = await fetchWeeklyScoresForTeam(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId
      );
      opponentScore = opponentWeeklyScores.find((score) => score.week === week) ?? null;
      opponentRoster = await fetchRoster(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId,
        week
      );
    }
  }

  const rosterPlayerIds = [
    ...new Set([...myRoster, ...opponentRoster].map((player) => player.playerExternalId)),
  ];
  const playerValues = await fetchPlayerValues(
    league.sourceId,
    league.externalLeagueId,
    rosterPlayerIds
  );
  const withPlayerValue = (roster: RosterPlayerRow[]): RosterPlayerRow[] =>
    roster.map((player) => ({
      ...player,
      playerValue: playerValues.get(player.playerExternalId) ?? null,
    }));
  myRoster = withPlayerValue(myRoster);
  opponentRoster = withPlayerValue(opponentRoster);

  const standings = await fetchStandings(league.sourceId, league.externalLeagueId, teams);
  const teamStrengths = await fetchTeamStrength(
    league.sourceId,
    league.externalLeagueId,
    standings.map((row) => row.team.externalTeamId)
  );
  const standingsWithStrength: StandingsRow[] = standings.map((row) => ({
    ...row,
    strength: teamStrengths.get(row.team.externalTeamId) ?? null,
  }));

  return {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings: standingsWithStrength,
  };
}
