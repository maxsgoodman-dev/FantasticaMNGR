import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.models import Player, Team

PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"

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


class SleeperAdapter(FantasySourceAdapter):
    source = "sleeper"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

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
