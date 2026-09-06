import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.models import Player, Team

BOOTSTRAP_STATIC_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"

_ELEMENT_TYPE_TO_POSITION = {
    1: "GKP",
    2: "DEF",
    3: "MID",
    4: "FWD",
}


def _current_gameweek(bootstrap: dict) -> int:
    candidate_ids = [event["id"] for event in bootstrap["events"] if event.get("is_current") or event.get("finished")]
    if not candidate_ids:
        raise ValueError("no finished or current gameweek found in bootstrap-static events")
    return max(candidate_ids)


def _normalize_teams(raw_json: dict) -> list[Team]:
    return [
        Team(
            id=str(team["id"]),
            name=team["name"],
            short_name=team["short_name"],
        )
        for team in raw_json["teams"]
    ]


def _normalize_players(raw_json: dict) -> list[Player]:
    teams_by_id = {team["id"]: team["short_name"] for team in raw_json["teams"]}

    return [
        Player(
            id=str(element["id"]),
            name=f"{element['first_name']} {element['second_name']}",
            team=teams_by_id.get(element["team"], "UNK"),
            position=_ELEMENT_TYPE_TO_POSITION.get(element["element_type"], "UNK"),
            price=element["now_cost"] / 10,
            total_points=element["total_points"],
            form=float(element["form"]),
        )
        for element in raw_json["elements"]
    ]


class FPLAdapter(FantasySourceAdapter):
    source = "fpl"
    sport = "premier-league"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

    def _fetch_bootstrap_static(self) -> dict:
        response = self._client.get(BOOTSTRAP_STATIC_URL)
        response.raise_for_status()
        return response.json()

    def fetch_players(self) -> list[Player]:
        return _normalize_players(self._fetch_bootstrap_static())

    def fetch_teams(self) -> list[Team]:
        return _normalize_teams(self._fetch_bootstrap_static())

    def fetch_matchups(self) -> list[dict]:
        # FPL head-to-head standings require a league ID and manager ID,
        # neither of which is available from bootstrap-static. Not implemented yet.
        raise NotImplementedError("FPL matchups require a league ID and manager ID")
