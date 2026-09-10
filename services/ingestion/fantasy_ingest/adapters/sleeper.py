import sys

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, PlayerProjection, Team

PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
STATE_URL = "https://api.sleeper.app/v1/state/nfl"
LEAGUE_USERS_URL = "https://api.sleeper.app/v1/league/{league_id}/users"
LEAGUE_ROSTERS_URL = "https://api.sleeper.app/v1/league/{league_id}/rosters"
LEAGUE_MATCHUPS_URL = "https://api.sleeper.app/v1/league/{league_id}/matchups/{week}"
PROJECTIONS_URL = "https://api.sleeper.app/projections/nfl/{season}/{week}"

# Sleeper has no "list all NFL teams" endpoint — the 32 teams are fixed,
# unlike FPL's mid-season-renumbered club IDs, so this is safe to hardcode.
NFL_TEAMS = {
    "ARI": "Arizona Cardinals",
    "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",
    "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",
    "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos",
    "DET": "Detroit Lions",
    "GB": "Green Bay Packers",
    "HOU": "Houston Texans",
    "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs",
    "LAC": "Los Angeles Chargers",
    "LAR": "Los Angeles Rams",
    "LV": "Las Vegas Raiders",
    "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",
    "NE": "New England Patriots",
    "NO": "New Orleans Saints",
    "NYG": "New York Giants",
    "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers",
    "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}


def _normalize_teams() -> list[Team]:
    return [Team(id=code, name=name, short_name=code) for code, name in NFL_TEAMS.items()]


def _normalize_players(raw_json: dict) -> list[Player]:
    players = []
    for player_id, data in raw_json.items():
        team = data.get("team")
        position = data.get("position")
        if not team or not position:
            # Retired/practice-squad-only/non-fantasy entries carry no team
            # or position — Sleeper's players endpoint is a full historical
            # roster dump, not just active fantasy-relevant players.
            continue

        players.append(
            Player(
                id=str(player_id),
                name=data.get("full_name") or f"{data.get('first_name', '')} {data.get('last_name', '')}".strip(),
                team=team,
                position=position,
                # Sleeper has no built-in salary cap (standard leagues draft,
                # they don't buy players) and total_points/form require a
                # separate per-week stats pull this adapter doesn't do yet.
                price=0.0,
                total_points=0,
                form=0.0,
            )
        )
    return players


def _normalize_projections(raw_json: list[dict]) -> list[PlayerProjection]:
    # One call returns every NFL player, not just fantasy-relevant ones —
    # same "full historical dump" shape as /v1/players/nfl. A record with
    # no pts_ppr (bye week, inactive, not a scoring position Sleeper
    # projects) is skipped rather than coerced to 0.0, so "no projection"
    # stays distinguishable from "projected to score zero".
    projections = []
    for record in raw_json:
        player_id = record.get("player_id")
        pts_ppr = (record.get("stats") or {}).get("pts_ppr")
        if player_id is None or pts_ppr is None:
            continue
        projections.append(PlayerProjection(player_external_id=str(player_id), projected_points=float(pts_ppr)))
    return projections


def _normalize_league_teams(rosters_json: list[dict], users_json: list[dict], my_user_id: str) -> list[FantasyTeam]:
    users_by_id = {user["user_id"]: user for user in users_json}
    teams = []
    for roster in rosters_json:
        owner_id = roster.get("owner_id")
        user = users_by_id.get(owner_id, {})
        display_name = user.get("display_name", "Unknown")
        team_name = (roster.get("metadata") or {}).get("team_name") or display_name
        teams.append(
            FantasyTeam(
                external_id=str(roster["roster_id"]),
                name=team_name,
                owner_name=display_name,
                is_mine=(owner_id == my_user_id),
            )
        )
    return teams


def _normalize_week(
    matchups_json: list[dict], week: int, names_by_id: dict[str, str]
) -> tuple[list[WeeklyScore], list[RosterEntry]]:
    # Sleeper groups two opposing rosters under a shared matchup_id; a
    # team on bye that week has matchup_id: null and no opponent.
    grouped: dict[int, list[dict]] = {}
    solo: list[dict] = []
    for entry in matchups_json:
        matchup_id = entry.get("matchup_id")
        if matchup_id is None:
            solo.append(entry)
        else:
            grouped.setdefault(matchup_id, []).append(entry)

    scores: list[WeeklyScore] = []
    roster_entries: list[RosterEntry] = []
    for group in list(grouped.values()) + [[entry] for entry in solo]:
        for entry in group:
            opponent = next((other for other in group if other is not entry), None)
            roster_id = str(entry["roster_id"])
            scores.append(
                WeeklyScore(
                    team_external_id=roster_id,
                    week=week,
                    points=float(entry.get("points") or 0.0),
                    opponent_external_id=str(opponent["roster_id"]) if opponent else None,
                )
            )
            starters = set(entry.get("starters") or [])
            players_points = entry.get("players_points") or {}
            for player_id in entry.get("players") or []:
                roster_entries.append(
                    RosterEntry(
                        team_external_id=roster_id,
                        week=week,
                        player_external_id=str(player_id),
                        player_name=names_by_id.get(str(player_id), "Unknown"),
                        is_starter=player_id in starters,
                        points=float(players_points.get(player_id, 0.0)),
                    )
                )
    return scores, roster_entries


class SleeperAdapter(FantasySourceAdapter):
    source = "sleeper"
    sport = "nfl"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

    def current_week(self) -> int:
        """The week `fetch_projections` needs — public so callers (e.g.
        warehouse.sync_projections) can discover it without a second,
        duplicate /state/nfl call of their own."""
        response = self._client.get(STATE_URL)
        response.raise_for_status()
        return response.json()["week"]

    def fetch_players(self) -> list[Player]:
        response = self._client.get(PLAYERS_URL)
        response.raise_for_status()
        return _normalize_players(response.json())

    def fetch_teams(self) -> list[Team]:
        return _normalize_teams()

    def fetch_matchups(self) -> list[dict]:
        # Sleeper matchups are league-scoped (GET /league/{league_id}/matchups/{week}),
        # and no league ID is available yet. Not implemented.
        raise NotImplementedError("Sleeper matchups require a league ID")

    def fetch_projections(self, week: int) -> list[PlayerProjection]:
        """Projected points for every NFL player in the given week.

        `week` must match Sleeper's own current week (same guard as
        FPLAdapter.fetch_projections) — the projections endpoint will
        happily return a past or future week's numbers on request, but
        this adapter only ever wants "now", so a mismatch is a caller
        bug worth surfacing rather than silently syncing the wrong week.
        """
        state_response = self._client.get(STATE_URL)
        state_response.raise_for_status()
        state = state_response.json()
        if week != state["week"]:
            raise ValueError(f"Sleeper's current week is {state['week']}, not {week}")

        response = self._client.get(
            PROJECTIONS_URL.format(season=state["season"], week=week),
            params={"season_type": "regular"},
        )
        response.raise_for_status()
        return _normalize_projections(response.json())

    def fetch_league_data(self, league_id: str, my_user_id: str) -> LeagueSyncResult:
        names_by_id = {player.id: player.name for player in self.fetch_players()}

        users_response = self._client.get(LEAGUE_USERS_URL.format(league_id=league_id))
        users_response.raise_for_status()
        rosters_response = self._client.get(LEAGUE_ROSTERS_URL.format(league_id=league_id))
        rosters_response.raise_for_status()
        teams = _normalize_league_teams(rosters_response.json(), users_response.json(), my_user_id)

        state_response = self._client.get(STATE_URL)
        state_response.raise_for_status()
        current_week = state_response.json()["week"]

        weekly_scores: list[WeeklyScore] = []
        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            response = self._client.get(LEAGUE_MATCHUPS_URL.format(league_id=league_id, week=week))
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                # A single week's matchups call failing (network blip, transient
                # 5xx) must not lose every other week's data already collected —
                # same reasoning as ESPN's per-team roster skip.
                print(f"sleeper: skipping league {league_id} week {week}: {error}", file=sys.stderr)
                continue
            scores, entries = _normalize_week(response.json(), week, names_by_id)
            weekly_scores.extend(scores)
            roster_players.extend(entries)

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
