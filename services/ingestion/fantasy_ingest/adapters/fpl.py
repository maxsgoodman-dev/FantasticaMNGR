import sys

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, PlayerProjection, Team

BOOTSTRAP_STATIC_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
CLASSIC_STANDINGS_URL = "https://fantasy.premierleague.com/api/leagues-classic/{league_id}/standings/"
ENTRY_PICKS_URL = "https://fantasy.premierleague.com/api/entry/{entry_id}/event/{week}/picks/"
ENTRY_HISTORY_URL = "https://fantasy.premierleague.com/api/entry/{entry_id}/history/"
EVENT_LIVE_URL = "https://fantasy.premierleague.com/api/event/{week}/live/"
H2H_STANDINGS_URL = "https://fantasy.premierleague.com/api/leagues-h2h/{league_id}/standings/"
H2H_MATCHES_URL = "https://fantasy.premierleague.com/api/leagues-h2h-matches/league/{league_id}/"

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


def _normalize_projections(raw_json: dict) -> list[PlayerProjection]:
    # `ep_this` (expected points, current gameweek) — not `ep_next` — to
    # match this adapter's "current week" scope everywhere else (see
    # fetch_league_data's use of _current_gameweek). The two often
    # coincide right around a gameweek transition (bootstrap-static keeps
    # marking a just-finished event "current" until the next one starts),
    # which is expected, not a bug.
    return [
        PlayerProjection(player_external_id=str(element["id"]), projected_points=float(element["ep_this"]))
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


def _normalize_h2h_teams(pages: list[dict], my_entry_id: str) -> list[FantasyTeam]:
    teams = []
    for page in pages:
        for result in page["standings"]["results"]:
            entry_id = str(result["entry"])
            teams.append(
                FantasyTeam(
                    external_id=entry_id,
                    name=result["entry_name"],
                    owner_name=result["player_name"],
                    is_mine=(entry_id == my_entry_id),
                )
            )
    return teams


def _normalize_h2h_matches(pages: list[dict], current_week: int) -> list[WeeklyScore]:
    scores = []
    for page in pages:
        for match in page["results"]:
            week = match["event"]
            if week > current_week:
                continue
            entry_1 = str(match["entry_1_entry"])
            scores.append(
                WeeklyScore(
                    team_external_id=entry_1,
                    week=week,
                    points=float(match["entry_1_points"]),
                    opponent_external_id=str(match["entry_2_entry"]) if match.get("entry_2_entry") is not None else None,
                )
            )
            if match.get("entry_2_entry") is not None:
                scores.append(
                    WeeklyScore(
                        team_external_id=str(match["entry_2_entry"]),
                        week=week,
                        points=float(match["entry_2_points"]),
                        opponent_external_id=entry_1,
                    )
                )
    return scores


def _normalize_h2h_fixtures(pages: list[dict]) -> list[H2HFixture]:
    """Every gameweek's H2H pairing for every team, past and future.

    Unlike _normalize_h2h_matches (which discards anything past
    current_week, since it's building settled *results*), this keeps
    every event the pages contain. The H2H schedule itself is fixed at
    the start of the season and known for all gameweeks regardless of
    whether they've been played — see
    docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
    """
    fixtures = []
    for page in pages:
        for match in page["results"]:
            week = match["event"]
            entry_1 = str(match["entry_1_entry"])
            entry_2 = str(match["entry_2_entry"]) if match.get("entry_2_entry") is not None else None
            fixtures.append(H2HFixture(team_external_id=entry_1, week=week, opponent_external_id=entry_2))
            if entry_2 is not None:
                fixtures.append(H2HFixture(team_external_id=entry_2, week=week, opponent_external_id=entry_1))
    return fixtures


def _normalize_entry_history(raw_json: dict) -> list[dict]:
    """Normalize one manager's `past` seasons from /entry/{id}/history/.

    Pure function, no network call — mirrors every other `_normalize_*`
    in this file. Only `past` (multi-season track record) is surfaced;
    `current` (this season's gameweek-by-gameweek, already synced via
    fetch_classic_league_data/fetch_h2h_league_data) and `chips` are
    deliberately not modeled here — see
    docs/superpowers/specs/2026-09-11-fpl-manager-season-history-design.md.

    A manager new to FPL this season has `"past": []`, which normalizes
    to `[]` — a normal, valid outcome, not an error.

    `rank_percentage` arrives from FPL as a JSON string (e.g. `"36"`);
    it's semantically numeric, so it's cast to float here rather than
    stored as text.
    """
    return [
        {
            "season_name": season["season_name"],
            "total_points": season["total_points"],
            "rank": season["rank"],
            "rank_percentage": float(season["rank_percentage"]),
        }
        for season in raw_json.get("past", [])
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

    def current_gameweek(self) -> int:
        """The gameweek `fetch_projections` needs — public so callers
        (e.g. warehouse.sync_projections) can discover it without
        duplicating _current_gameweek's event-parsing logic themselves."""
        return _current_gameweek(self._fetch_bootstrap_static())

    def fetch_players(self) -> list[Player]:
        return _normalize_players(self._fetch_bootstrap_static())

    def fetch_teams(self) -> list[Team]:
        return _normalize_teams(self._fetch_bootstrap_static())

    def fetch_matchups(self) -> list[dict]:
        # FPL head-to-head standings require a league ID and manager ID,
        # neither of which is available from bootstrap-static. Not implemented yet.
        raise NotImplementedError("FPL matchups require a league ID and manager ID")

    def fetch_projections(self, week: int) -> list[PlayerProjection]:
        """Current-gameweek expected points for every player.

        `bootstrap-static` only ever exposes `ep_this` for whatever
        gameweek it currently considers active — there's no way to ask
        for an arbitrary past/future week's projection through this
        endpoint. `week` must match that gameweek; passing anything else
        raises rather than silently mislabeling stale data.
        """
        bootstrap = self._fetch_bootstrap_static()
        current_week = _current_gameweek(bootstrap)
        if week != current_week:
            raise ValueError(
                f"FPL only exposes projections for the current gameweek ({current_week}), not {week}"
            )
        return _normalize_projections(bootstrap)

    def fetch_entry_history(self, entry_id: str) -> list[dict]:
        """Fetch one FPL manager's multi-season track record.

        Not part of the FantasySourceAdapter interface (fetch_players/
        fetch_teams/fetch_matchups) — a manager's own season-by-season
        summary is a genuinely different kind of data, league- and
        roster-independent, so it lives as its own method here, same as
        fetch_h2h_league_data/fetch_classic_league_data.
        """
        response = self._client.get(ENTRY_HISTORY_URL.format(entry_id=entry_id))
        response.raise_for_status()
        return _normalize_entry_history(response.json())

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

    def _fetch_matches_pages(self, url: str) -> list[dict]:
        pages = []
        page = 1
        while True:
            response = self._client.get(url, params={"page": page})
            response.raise_for_status()
            data = response.json()
            pages.append(data)
            if not data["has_next"]:
                break
            page += 1
        return pages

    def fetch_h2h_league_data(self, league_id: str, my_entry_id: str) -> LeagueSyncResult:
        bootstrap = self._fetch_bootstrap_static()
        current_week = _current_gameweek(bootstrap)
        names_by_id = {element["id"]: f"{element['first_name']} {element['second_name']}" for element in bootstrap["elements"]}

        standings_pages = self._fetch_standings_pages(H2H_STANDINGS_URL.format(league_id=league_id))
        teams = _normalize_h2h_teams(standings_pages, my_entry_id)

        matches_pages = self._fetch_matches_pages(H2H_MATCHES_URL.format(league_id=league_id))
        weekly_scores = _normalize_h2h_matches(matches_pages, current_week)

        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            try:
                live_response = self._client.get(EVENT_LIVE_URL.format(week=week))
                live_response.raise_for_status()
            except httpx.HTTPStatusError as error:
                print(f"fpl: skipping league {league_id} week {week} (live points): {error}", file=sys.stderr)
                continue
            live = live_response.json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}

            for team in teams:
                try:
                    picks_response = self._client.get(ENTRY_PICKS_URL.format(entry_id=team.external_id, week=week))
                    picks_response.raise_for_status()
                except httpx.HTTPStatusError as error:
                    print(
                        f"fpl: skipping league {league_id} week {week} for entry {team.external_id}: {error}",
                        file=sys.stderr,
                    )
                    continue
                picks = picks_response.json()
                roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, team.external_id, week))

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
