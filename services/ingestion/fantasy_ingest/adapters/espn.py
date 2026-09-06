"""ESPN adapter.

Unlike FPL's bootstrap-static and Sleeper's players/nfl, ESPN has no
single public endpoint that returns every player in one call: its core
API's /athletes list is paginated $ref links (one HTTP call per player —
not viable for ~2000+ players), so this adapter instead fetches the
32-team list and then each team's roster, which does embed full player
detail per ESPN's site API convention.

Confirmed live (2026-09-06, from outside the dev sandbox that blocks
site.api.espn.com): the endpoint pattern is correct — GET .../teams
returns the 32-team list, and GET .../teams/{id}/roster returns 200 for
most ids. One real, ESPN-side gotcha found by that same run: `/teams`
lists team id "22", but its `/roster` 404s while other ids (e.g. "1")
return 200 — not a bug in this adapter's URL pattern, just an
inconsistency on ESPN's side. `fetch_players()` treats a single team's
roster 404 as skippable, not fatal, for exactly this reason.

Still unverified: the exact response *body* shape for a successful
roster call (grouped-by-position-category vs. a flat athlete list) was
inferred from public documentation (the nntrn/ee26cb2a0716de0947a0a4e9a157bc1c
gist, pseudo-r/Public-ESPN-API), not confirmed against a captured
payload — `_normalize_roster` handles both shapes defensively for this
reason. If real players are silently missing from a sync, check this
first.
"""

import sys

import httpx

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.models import Player, Team

TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"
ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team_id}/roster"


def _normalize_teams(raw_json: dict) -> list[Team]:
    teams = []
    for entry in raw_json.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        team = entry.get("team", entry)
        team_id = team.get("id")
        if team_id is None:
            continue
        teams.append(
            Team(
                id=str(team_id),
                name=team.get("displayName") or team.get("name", "Unknown"),
                short_name=team.get("abbreviation", "UNK"),
            )
        )
    return teams


def _normalize_roster(raw_json: dict, team_short_name: str) -> list[Player]:
    """Normalize one team's roster response into that team's Players.

    Handles both documented shapes defensively: athletes grouped by
    position category (`{"athletes": [{"items": [...athlete...]}]}`) and
    a flat athlete list (`{"athletes": [...athlete...]}`), since the
    exact shape couldn't be confirmed live (see module docstring).
    """
    players = []
    for group in raw_json.get("athletes", []):
        items = group.get("items") if isinstance(group, dict) and "items" in group else [group]
        for athlete in items:
            if not isinstance(athlete, dict):
                continue
            athlete_id = athlete.get("id")
            name = athlete.get("fullName") or athlete.get("displayName")
            position = athlete.get("position")
            position_abbr = (
                position.get("abbreviation") if isinstance(position, dict) else position
            )
            if athlete_id is None or not name or not position_abbr:
                continue

            players.append(
                Player(
                    id=str(athlete_id),
                    name=name,
                    team=team_short_name,
                    position=position_abbr,
                    # ESPN's standard game has no per-player salary; auction
                    # leagues do, but that's league-specific config this
                    # adapter has no access to without a league ID.
                    price=0.0,
                    # Season totals require a league-scoped stats view
                    # (`?view=kona_player_info` + an X-Fantasy-Filter
                    # header) not implemented yet.
                    total_points=0,
                    form=0.0,
                )
            )
    return players


class ESPNAdapter(FantasySourceAdapter):
    source = "espn"
    sport = "nfl"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

    def fetch_teams(self) -> list[Team]:
        response = self._client.get(TEAMS_URL)
        response.raise_for_status()
        return _normalize_teams(response.json())

    def fetch_players(self) -> list[Player]:
        players = []
        for team in self.fetch_teams():
            response = self._client.get(ROSTER_URL.format(team_id=team.id))
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                # One team's roster failing (confirmed live: some team IDs
                # from /teams 404 on /roster) shouldn't lose every other
                # team's data — skip it and keep going.
                print(
                    f"espn: skipping team {team.id} ({team.short_name}) roster: {error}",
                    file=sys.stderr,
                )
                continue
            players.extend(_normalize_roster(response.json(), team.short_name))
        return players

    def fetch_matchups(self) -> list[dict]:
        # ESPN fantasy matchups are league-scoped
        # (.../seasons/{year}/segments/0/leagues/{league_id}?view=mBoxscore),
        # and private leagues additionally need espn_s2/SWID auth cookies.
        # No league ID is available yet. Not implemented.
        raise NotImplementedError("ESPN matchups require a league ID")
