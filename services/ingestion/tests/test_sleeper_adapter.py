import httpx

from fantasy_ingest.adapters.sleeper import (
    NFL_TEAMS,
    SleeperAdapter,
    _normalize_league_teams,
    _normalize_players,
    _normalize_teams,
    _normalize_week,
)
from fantasy_ingest.league_models import FantasyTeam, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, Team

PLAYERS_FIXTURE = {
    "4046": {
        "player_id": "4046",
        "full_name": "Patrick Mahomes",
        "first_name": "Patrick",
        "last_name": "Mahomes",
        "team": "KC",
        "position": "QB",
        "fantasy_positions": ["QB"],
    },
    "6786": {
        "player_id": "6786",
        "full_name": "Justin Jefferson",
        "first_name": "Justin",
        "last_name": "Jefferson",
        "team": "MIN",
        "position": "WR",
        "fantasy_positions": ["WR"],
    },
    "9999": {
        # Retired/no-team entry — Sleeper's dump includes these; must be filtered.
        "player_id": "9999",
        "full_name": "Old Retired Guy",
        "first_name": "Old",
        "last_name": "Guy",
        "team": None,
        "position": None,
    },
}


def test_adapter_declares_sport():
    assert SleeperAdapter.sport == "nfl"


def test_normalize_teams():
    teams = _normalize_teams()

    assert len(teams) == 32
    assert Team(id="KC", name="Kansas City Chiefs", short_name="KC") in teams
    assert len(NFL_TEAMS) == 32


def test_normalize_players():
    players = _normalize_players(PLAYERS_FIXTURE)

    assert players == [
        Player(
            id="4046",
            name="Patrick Mahomes",
            team="KC",
            position="QB",
            price=0.0,
            total_points=0,
            form=0.0,
        ),
        Player(
            id="6786",
            name="Justin Jefferson",
            team="MIN",
            position="WR",
            price=0.0,
            total_points=0,
            form=0.0,
        ),
    ]


def test_normalize_players_drops_entries_without_team_or_position():
    players = _normalize_players(PLAYERS_FIXTURE)

    assert all(p.id != "9999" for p in players)


ROSTERS_FIXTURE = [
    {"roster_id": 1, "owner_id": "u1", "metadata": {"team_name": "Dynasty Warriors"}},
    {"roster_id": 2, "owner_id": "u2", "metadata": {}},
]

USERS_FIXTURE = [
    {"user_id": "u1", "display_name": "MaxG"},
    {"user_id": "u2", "display_name": "RivalPlayer"},
]

MATCHUPS_FIXTURE_WEEK_1 = [
    {
        "roster_id": 1,
        "matchup_id": 100,
        "points": 112.5,
        "starters": ["4046"],
        "players": ["4046", "6786"],
        "players_points": {"4046": 24.0, "6786": 8.0},
    },
    {
        "roster_id": 2,
        "matchup_id": 100,
        "points": 98.0,
        "starters": ["9999"],
        "players": ["9999"],
        "players_points": {"9999": 15.0},
    },
]

BYE_WEEK_FIXTURE = [
    {
        "roster_id": 3,
        "matchup_id": None,
        "points": 50.0,
        "starters": [],
        "players": [],
        "players_points": {},
    },
]

NAMES_BY_ID = {"4046": "Patrick Mahomes", "6786": "Justin Jefferson", "9999": "Old Retired Guy"}


def test_normalize_league_teams():
    teams = _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")

    assert teams == [
        FantasyTeam(external_id="1", name="Dynasty Warriors", owner_name="MaxG", is_mine=True),
        FantasyTeam(external_id="2", name="RivalPlayer", owner_name="RivalPlayer", is_mine=False),
    ]


def test_normalize_league_teams_falls_back_to_display_name_when_no_team_name():
    teams = _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")

    assert teams[1].name == "RivalPlayer"


def test_normalize_week_pairs_opponents_and_computes_scores():
    scores, roster_entries = _normalize_week(MATCHUPS_FIXTURE_WEEK_1, week=1, names_by_id=NAMES_BY_ID)

    assert WeeklyScore(team_external_id="1", week=1, points=112.5, opponent_external_id="2") in scores
    assert WeeklyScore(team_external_id="2", week=1, points=98.0, opponent_external_id="1") in scores
    assert RosterEntry(
        team_external_id="1",
        week=1,
        player_external_id="4046",
        player_name="Patrick Mahomes",
        is_starter=True,
        points=24.0,
    ) in roster_entries
    assert RosterEntry(
        team_external_id="1",
        week=1,
        player_external_id="6786",
        player_name="Justin Jefferson",
        is_starter=False,
        points=8.0,
    ) in roster_entries


def test_normalize_week_handles_bye_week_with_no_matchup_id():
    scores, roster_entries = _normalize_week(BYE_WEEK_FIXTURE, week=1, names_by_id=NAMES_BY_ID)

    assert scores == [WeeklyScore(team_external_id="3", week=1, points=50.0, opponent_external_id=None)]
    assert roster_entries == []


def test_fetch_league_data_pulls_teams_and_every_week_so_far():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/players/nfl"):
            return httpx.Response(200, json=PLAYERS_FIXTURE)
        if path.endswith("/league/L1/users"):
            return httpx.Response(200, json=USERS_FIXTURE)
        if path.endswith("/league/L1/rosters"):
            return httpx.Response(200, json=ROSTERS_FIXTURE)
        if path.endswith("/state/nfl"):
            return httpx.Response(200, json={"week": 2})
        if path.endswith("/league/L1/matchups/1"):
            return httpx.Response(200, json=MATCHUPS_FIXTURE_WEEK_1)
        if path.endswith("/league/L1/matchups/2"):
            return httpx.Response(200, json=[])
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = SleeperAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_league_data(league_id="L1", my_user_id="u1")

    assert result.teams == _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")
    assert len(result.weekly_scores) == 2  # both rosters, week 1 only (week 2 empty)
    assert any(score.week == 1 and score.team_external_id == "1" for score in result.weekly_scores)
    assert any(entry.player_name == "Patrick Mahomes" for entry in result.roster_players)


def test_fetch_league_data_skips_a_week_whose_matchups_call_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/players/nfl"):
            return httpx.Response(200, json=PLAYERS_FIXTURE)
        if path.endswith("/league/L1/users"):
            return httpx.Response(200, json=USERS_FIXTURE)
        if path.endswith("/league/L1/rosters"):
            return httpx.Response(200, json=ROSTERS_FIXTURE)
        if path.endswith("/state/nfl"):
            return httpx.Response(200, json={"week": 2})
        if path.endswith("/league/L1/matchups/1"):
            return httpx.Response(200, json=MATCHUPS_FIXTURE_WEEK_1)
        if path.endswith("/league/L1/matchups/2"):
            return httpx.Response(500, json={"error": "internal error"})
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = SleeperAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_league_data(league_id="L1", my_user_id="u1")

    # Week 1 data survives even though week 2's call failed.
    assert len(result.weekly_scores) == 2
    assert any(score.week == 1 for score in result.weekly_scores)
    assert not any(score.week == 2 for score in result.weekly_scores)
