import sys

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, Team

BOOTSTRAP_STATIC_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
CLASSIC_STANDINGS_URL = "https://fantasy.premierleague.com/api/leagues-classic/{league_id}/standings/"
ENTRY_PICKS_URL = "https://fantasy.premierleague.com/api/entry/{entry_id}/event/{week}/picks/"
EVENT_LIVE_URL = "https://fantasy.premierleague.com/api/event/{week}/live/"

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


def _normalize_picks(
    picks_json: dict,
    live_points_by_id: dict[int, int],
    names_by_id: dict[int, str],
    team_external_id: str,
    week: int,
) -> list[RosterEntry]:
    entries = []
    for pick in picks_json["picks"]:
        element_id = pick["element"]
        base_points = live_points_by_id.get(element_id, 0)
        entries.append(
            RosterEntry(
                team_external_id=team_external_id,
                week=week,
                player_external_id=str(element_id),
                player_name=names_by_id.get(element_id, "Unknown"),
                is_starter=pick["position"] <= 11,
                points=float(base_points * pick["multiplier"]),
            )
        )
    return entries


def _normalize_classic_standings(
    pages: list[dict], my_entry_id: str, week: int
) -> tuple[list[FantasyTeam], list[WeeklyScore]]:
    teams = []
    scores = []
    for page in pages:
        for result in page["standings"]["results"]:
            entry_id = str(result["entry"])
            is_mine = entry_id == my_entry_id
            teams.append(
                FantasyTeam(
                    external_id=entry_id,
                    name=result["entry_name"],
                    owner_name=result["player_name"],
                    is_mine=is_mine,
                )
            )
            if not is_mine:
                scores.append(
                    WeeklyScore(team_external_id=entry_id, week=week, points=float(result["total"]))
                )
    return teams, scores


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

    def _fetch_standings_pages(self, url: str) -> list[dict]:
        pages = []
        page = 1
        while True:
            response = self._client.get(url, params={"page_standings": page})
            response.raise_for_status()
            data = response.json()
            pages.append(data)
            if not data["standings"]["has_next"]:
                break
            page += 1
        return pages

    def fetch_classic_league_data(self, league_id: str, my_entry_id: str) -> LeagueSyncResult:
        bootstrap = self._fetch_bootstrap_static()
        current_week = _current_gameweek(bootstrap)
        names_by_id = {element["id"]: f"{element['first_name']} {element['second_name']}" for element in bootstrap["elements"]}

        pages = self._fetch_standings_pages(CLASSIC_STANDINGS_URL.format(league_id=league_id))
        teams, weekly_scores = _normalize_classic_standings(pages, my_entry_id, current_week)

        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            try:
                live_response = self._client.get(EVENT_LIVE_URL.format(week=week))
                live_response.raise_for_status()
                picks_response = self._client.get(ENTRY_PICKS_URL.format(entry_id=my_entry_id, week=week))
                picks_response.raise_for_status()
            except httpx.HTTPStatusError as error:
                # A single week's live-points or picks call failing must not lose
                # every other week's data already collected — same reasoning as
                # SleeperAdapter.fetch_league_data's per-week skip.
                print(
                    f"fpl: skipping league {league_id} week {week} for entry {my_entry_id}: {error}",
                    file=sys.stderr,
                )
                continue

            live = live_response.json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}
            picks = picks_response.json()
            roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, my_entry_id, week))
            weekly_scores.append(
                WeeklyScore(team_external_id=my_entry_id, week=week, points=float(picks["entry_history"]["points"]))
            )

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
