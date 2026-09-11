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
  previousPoints: number | null;
  strength: TeamStrengthRow | null;
}

export interface MatchupPreviewRow {
  externalTeamId: string;
  projectedPoints: number;
  startersMissingProjection: number;
}

export interface FplNextFixture {
  gw: number;
  opponent: string;
  isHome: boolean;
}

export interface FplSheetPlayerRow {
  playerExternalId: string;
  position: string;
  difficultyScore: number | null;
  xgiPer90: number | null;
  xgcPer90: number | null;
  nextFixtures: FplNextFixture[];
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
  weekState: "future" | "played";
  // Null unless week === latestWeek (the current, in-progress week) —
  // see fetchLeagueTeamView's isCurrentPlayedWeek guard. Distinct from
  // "fetched but empty" (a Map) so the UI can tell "not applicable here"
  // apart from "applicable, but no data yet".
  matchupPreview: Map<string, MatchupPreviewRow> | null;
  // Null unless league.sourceId === "fpl" — available for ANY FPL week
  // (future or played), not just the current one, unlike matchupPreview
  // above.
  fplSheetData: Map<string, FplSheetPlayerRow> | null;
  // Null unless weekState === "future".
  projections: Map<string, number> | null;
  // Null unless weekState === "played" and this is an FPL head-to-head
  // league.
  entryGameweekStats: Map<string, EntryGameweekStatRow> | null;
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

interface MatchupPreviewDbRow {
  external_team_id: string;
  projected_points: number;
  starters_missing_projection: number;
}

interface FplSheetPlayerDbRow {
  external_player_id: string;
  position: string;
  difficulty_score: number | null;
  xgi_per_90: number | null;
  xgc_per_90: number | null;
  data_fetched: string;
  next_fixtures: Array<{ gw: number; opponent: string; is_home: boolean }>;
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

function fromMatchupPreviewRow(row: MatchupPreviewDbRow): MatchupPreviewRow {
  return {
    externalTeamId: row.external_team_id,
    projectedPoints: row.projected_points,
    startersMissingProjection: row.starters_missing_projection,
  };
}

function fromFplSheetPlayerRow(row: FplSheetPlayerDbRow): FplSheetPlayerRow {
  return {
    playerExternalId: row.external_player_id,
    position: row.position,
    difficultyScore: row.difficulty_score,
    xgiPer90: row.xgi_per_90,
    xgcPer90: row.xgc_per_90,
    nextFixtures: (row.next_fixtures ?? []).map((fixture) => ({
      gw: fixture.gw,
      opponent: fixture.opponent,
      isHome: fixture.is_home,
    })),
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

async function fetchMatchupPreview(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[],
  week: number
): Promise<Map<string, MatchupPreviewRow>> {
  if (externalTeamIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("matchup_preview")
    .select("external_team_id, projected_points, starters_missing_projection")
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("week", week)
    .in("external_team_id", externalTeamIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const rows = (data ?? []).map(fromMatchupPreviewRow);
  return new Map(rows.map((row) => [row.externalTeamId, row]));
}

// FPL-only (see the design doc's "Fourth data source" section — the
// sheet only covers Premier League players). Caller is expected to only
// invoke this for source_id === 'fpl'; a Sleeper external_player_id
// simply won't match anything here, so this degrades harmlessly rather
// than needing its own guard.
async function fetchFplSheetData(playerExternalIds: string[]): Promise<Map<string, FplSheetPlayerRow>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("fpl_sheet_player_data")
    .select("external_player_id, position, difficulty_score, xgi_per_90, xgc_per_90, data_fetched, next_fixtures")
    .in("external_player_id", playerExternalIds)
    .order("data_fetched", { ascending: false });

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  // Ordered newest-first, so the first row seen per player is already
  // its latest data_fetched snapshot — later (older) duplicates for the
  // same player are simply never inserted into the map.
  const map = new Map<string, FplSheetPlayerRow>();
  for (const row of (data ?? []).map(fromFplSheetPlayerRow)) {
    if (!map.has(row.playerExternalId)) {
      map.set(row.playerExternalId, row);
    }
  }
  return map;
}

interface PlayerProjectionDbRow {
  external_player_id: string;
  projected_points: number;
}

async function fetchPlayerProjections(
  sourceId: string,
  sportId: string,
  week: number,
  playerExternalIds: string[]
): Promise<Map<string, number>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("player_projections")
    .select("external_player_id, projected_points")
    .eq("source_id", sourceId)
    .eq("sport_id", sportId)
    .eq("week", week)
    .in("external_player_id", playerExternalIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row: PlayerProjectionDbRow) => [row.external_player_id, row.projected_points])
  );
}

interface H2HFixtureDbRow {
  opponent_external_team_id: string | null;
}

interface EntryGameweekStatDbRow {
  external_team_id: string;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
  bank: number;
  team_value: number;
  overall_rank: number | null;
  active_chip: string | null;
}

export interface EntryGameweekStatRow {
  externalTeamId: string;
  eventTransfers: number;
  eventTransfersCost: number;
  pointsOnBench: number;
  bank: number;
  teamValue: number;
  overallRank: number | null;
  activeChip: string | null;
}

function fromEntryGameweekStatRow(row: EntryGameweekStatDbRow): EntryGameweekStatRow {
  return {
    externalTeamId: row.external_team_id,
    eventTransfers: row.event_transfers,
    eventTransfersCost: row.event_transfers_cost,
    pointsOnBench: row.points_on_bench,
    bank: row.bank,
    teamValue: row.team_value,
    overallRank: row.overall_rank,
    activeChip: row.active_chip,
  };
}

// FPL H2H-only — this table is populated from the same picks response
// fetch_h2h_league_data already calls per team per week; Sleeper/ESPN
// and the FPL classic league have no equivalent row for this table. See
// docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.
async function fetchEntryGameweekStats(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[],
  week: number
): Promise<Map<string, EntryGameweekStatRow>> {
  if (externalTeamIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("fpl_entry_gameweek_stats")
    .select(
      "external_team_id, event_transfers, event_transfers_cost, points_on_bench, bank, team_value, overall_rank, active_chip"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("week", week)
    .in("external_team_id", externalTeamIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const rows = (data ?? []).map(fromEntryGameweekStatRow);
  return new Map(rows.map((row) => [row.externalTeamId, row]));
}

// FPL H2H-only. "Their team" here is the opponent's *current* squad — a
// preview, not their locked lineup for next week, since FPL's API
// genuinely doesn't expose a future gameweek's picks before its
// deadline. See
// docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
async function fetchFutureOpponent(
  league: League,
  myTeam: FantasyTeam,
  teams: FantasyTeam[],
  week: number
): Promise<FantasyTeam | null> {
  const { data, error } = await supabase
    .from("h2h_fixtures")
    .select("opponent_external_team_id")
    .eq("source_id", league.sourceId)
    .eq("external_league_id", league.externalLeagueId)
    .eq("external_team_id", myTeam.externalTeamId)
    .eq("week", week)
    .maybeSingle();

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const opponentExternalTeamId = (data as H2HFixtureDbRow | null)?.opponent_external_team_id ?? null;
  if (!opponentExternalTeamId) {
    return null;
  }

  return teams.find((team) => team.externalTeamId === opponentExternalTeamId) ?? null;
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
  // `data` is ordered by week ascending, so the last two rows seen per team
  // (as we walk it in order) are that team's latest and previous weeks.
  const latestByTeam = new Map<string, WeeklyScoreDbRow>();
  const previousByTeam = new Map<string, WeeklyScoreDbRow>();
  for (const row of data ?? []) {
    const existingLatest = latestByTeam.get(row.external_team_id);
    if (existingLatest) {
      previousByTeam.set(row.external_team_id, existingLatest);
    }
    latestByTeam.set(row.external_team_id, row);
  }

  const standings: StandingsRow[] = [];
  for (const row of latestByTeam.values()) {
    const team = teamsById.get(row.external_team_id);
    if (team) {
      const previous = previousByTeam.get(row.external_team_id);
      standings.push({
        team,
        week: row.week,
        points: row.points,
        previousPoints: previous?.points ?? null,
        strength: null,
      });
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

  // Next-gameweek preview is FPL H2H-only (see fetchFutureOpponent's own
  // comment) — every other league format/source stays capped at
  // latestWeek, same as before this feature existed.
  const maxReachableWeek =
    league.sourceId === "fpl" && league.format === "head_to_head" ? latestWeek + 1 : latestWeek;
  const week = Math.min(Math.max(requestedWeek ?? latestWeek, 1), Math.max(maxReachableWeek, 1));
  const weekState: "future" | "played" = week > latestWeek ? "future" : "played";

  const myScore = myWeeklyScores.find((score) => score.week === week) ?? null;

  let opponentTeam: FantasyTeam | null = null;
  let opponentScore: WeeklyScoreRow | null = null;

  if (weekState === "played" && league.format === "head_to_head" && myScore?.opponentExternalTeamId) {
    opponentTeam = teams.find((team) => team.externalTeamId === myScore.opponentExternalTeamId) ?? null;
    if (opponentTeam) {
      const opponentWeeklyScores = await fetchWeeklyScoresForTeam(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId
      );
      opponentScore = opponentWeeklyScores.find((score) => score.week === week) ?? null;
    }
  } else if (weekState === "future" && league.format === "head_to_head") {
    opponentTeam = await fetchFutureOpponent(league, myTeam, teams, week);
  }

  // A future week has no locked lineup yet (FPL 404s it until the
  // deadline passes) — both rosters preview the most recent *played*
  // week's squad instead.
  const rosterWeek = weekState === "future" ? latestWeek : week;
  let myRoster = await fetchRoster(league.sourceId, league.externalLeagueId, myTeam.externalTeamId, rosterWeek);
  let opponentRoster: RosterPlayerRow[] = opponentTeam
    ? await fetchRoster(league.sourceId, league.externalLeagueId, opponentTeam.externalTeamId, rosterWeek)
    : [];

  const rosterPlayerIds = [
    ...new Set([...myRoster, ...opponentRoster].map((player) => player.playerExternalId)),
  ];
  const playerValues = await fetchPlayerValues(league.sourceId, league.externalLeagueId, rosterPlayerIds);
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

  // Matchup prep (rest-of-week projected score, win probability, weak
  // spots, tough fixtures, opponent scouting) only makes sense for the
  // actual current, in-progress week's head-to-head matchup — a genuinely
  // past week is settled history, and a future week has no in-progress
  // score to project the "rest of" yet. See
  // docs/superpowers/specs/2026-09-10-matchup-prep-design.md.
  const isCurrentPlayedWeek = weekState === "played" && week === latestWeek && opponentTeam !== null;

  const matchupPreview = isCurrentPlayedWeek
    ? await fetchMatchupPreview(
        league.sourceId,
        league.externalLeagueId,
        [myTeam.externalTeamId, opponentTeam!.externalTeamId],
        week
      )
    : null;

  // Position (for sorting) and next-fixture data apply to ANY FPL week,
  // played or future — not just the current one, unlike matchupPreview
  // above. See
  // docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.
  const fplSheetData =
    league.sourceId === "fpl" && rosterPlayerIds.length > 0 ? await fetchFplSheetData(rosterPlayerIds) : null;

  const projections =
    weekState === "future"
      ? await fetchPlayerProjections(league.sourceId, league.sportId, week, rosterPlayerIds)
      : null;

  const entryGameweekStats =
    weekState === "played" && league.sourceId === "fpl" && league.format === "head_to_head"
      ? await fetchEntryGameweekStats(
          league.sourceId,
          league.externalLeagueId,
          opponentTeam ? [myTeam.externalTeamId, opponentTeam.externalTeamId] : [myTeam.externalTeamId],
          week
        )
      : null;

  return {
    league,
    week,
    latestWeek,
    weekState,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings: standingsWithStrength,
    matchupPreview,
    fplSheetData,
    projections,
    entryGameweekStats,
  };
}
