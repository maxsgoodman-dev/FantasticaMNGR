import httpx
import pytest

from fantasy_ingest.adapters.fpl import (
    FPLAdapter,
    _current_gameweek,
    _normalize_classic_standings,
    _normalize_entry_history,
    _normalize_h2h_fixtures,
    _normalize_h2h_matches,
    _normalize_h2h_teams,
    _normalize_picks,
    _normalize_players,
    _normalize_projections,
    _normalize_teams,
)
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, PlayerProjection, Team

EVENTS_FIXTURE = [
    {"id": 1, "is_current": False, "finished": True},
    {"id": 2, "is_current": False, "finished": True},
    {"id": 3, "is_current": True, "finished": False},
    {"id": 4, "is_current": False, "finished": False},
]

BOOTSTRAP_STATIC_FIXTURE = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS"},
        {"id": 2, "name": "Liverpool", "short_name": "LIV"},
    ],
    "elements": [
        {
            "id": 101,
            "first_name": "Bukayo",
            "second_name": "Saka",
            "team": 1,
            "element_type": 3,
            "now_cost": 100,
            "total_points": 150,
            "form": "5.5",
            "ep_this": "6.1",
        },
        {
            "id": 102,
            "first_name": "David",
            "second_name": "Raya",
            "team": 1,
            "element_type": 1,
            "now_cost": 55,
            "total_points": 90,
            "form": "3.0",
            "ep_this": "3.4",
        },
        {
            "id": 201,
            "first_name": "Mohamed",
            "second_name": "Salah",
            "team": 2,
            "element_type": 4,
            "now_cost": 130,
            "total_points": 200,
            "form": "7.2",
            "ep_this": "8.0",
        },
    ],
    "events": EVENTS_FIXTURE,
}


def test_adapter_declares_sport():
    assert FPLAdapter.sport == "premier-league"


def test_normalize_teams():
    teams = _normalize_teams(BOOTSTRAP_STATIC_FIXTURE)

    assert teams == [
        Team(id="1", name="Arsenal", short_name="ARS"),
        Team(id="2", name="Liverpool", short_name="LIV"),
    ]


def test_normalize_players():
    players = _normalize_players(BOOTSTRAP_STATIC_FIXTURE)

    assert players == [
        Player(
            id="101",
            name="Bukayo Saka",
            team="ARS",
            position="MID",
            price=10.0,
            total_points=150,
            form=5.5,
        ),
        Player(
            id="102",
            name="David Raya",
            team="ARS",
            position="GKP",
            price=5.5,
            total_points=90,
            form=3.0,
        ),
        Player(
            id="201",
            name="Mohamed Salah",
            team="LIV",
            position="FWD",
            price=13.0,
            total_points=200,
            form=7.2,
        ),
    ]


def test_normalize_projections():
    projections = _normalize_projections(BOOTSTRAP_STATIC_FIXTURE)

    assert projections == [
        PlayerProjection(player_external_id="101", projected_points=6.1),
        PlayerProjection(player_external_id="102", projected_points=3.4),
        PlayerProjection(player_external_id="201", projected_points=8.0),
    ]


def test_fetch_projections_returns_current_week_projections():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE)

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    projections = adapter.fetch_projections(3)

    assert projections == _normalize_projections(BOOTSTRAP_STATIC_FIXTURE)


def test_fetch_projections_raises_for_a_week_that_isnt_current():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE)

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    with pytest.raises(ValueError, match="current gameweek"):
        adapter.fetch_projections(4)


def test_current_gameweek_method_matches_the_module_function():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE)

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    assert adapter.current_gameweek() == 3


def test_current_gameweek_is_the_in_progress_or_latest_finished_week():
    assert _current_gameweek({"events": EVENTS_FIXTURE}) == 3


def test_current_gameweek_raises_when_season_has_not_started():
    with pytest.raises(ValueError, match="no finished or current gameweek"):
        _current_gameweek({"events": [{"id": 1, "is_current": False, "finished": False}]})


PICKS_FIXTURE = {
    "picks": [
        {"element": 101, "position": 1, "multiplier": 1, "is_captain": False},
        {"element": 201, "position": 2, "multiplier": 2, "is_captain": True},
        {"element": 301, "position": 12, "multiplier": 0, "is_captain": False},
    ],
    "entry_history": {"points": 65, "event": 4},
}

LIVE_POINTS_FIXTURE = {101: 6, 201: 10, 301: 2}
NAMES_BY_ID_FIXTURE = {101: "Bukayo Saka", 201: "Mohamed Salah", 301: "David Raya"}


def test_normalize_picks_applies_captain_multiplier():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    assert RosterEntry(
        team_external_id="999", week=4, player_external_id="201", player_name="Mohamed Salah",
        is_starter=True, points=20.0,
    ) in entries


def test_normalize_picks_marks_bench_as_not_starter_and_zero_points():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    bench_entry = next(entry for entry in entries if entry.player_external_id == "301")
    assert bench_entry.is_starter is False
    assert bench_entry.points == 0.0


def test_normalize_picks_starting_xi_is_position_11_or_lower():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    assert len(entries) == 3
    assert sum(1 for entry in entries if entry.is_starter) == 2


CLASSIC_STANDINGS_PAGE_1 = {
    "standings": {
        "has_next": True,
        "results": [
            {"entry": 111, "entry_name": "Team Alpha", "player_name": "Max Goodman", "total": 987},
            {"entry": 222, "entry_name": "Team Beta", "player_name": "Someone Else", "total": 950},
        ],
    }
}

CLASSIC_STANDINGS_PAGE_2 = {
    "standings": {
        "has_next": False,
        "results": [
            {"entry": 333, "entry_name": "Team Gamma", "player_name": "A Third Person", "total": 900},
        ],
    }
}


def test_normalize_classic_standings_lists_every_entry_as_a_team():
    teams, _ = _normalize_classic_standings(
        [CLASSIC_STANDINGS_PAGE_1, CLASSIC_STANDINGS_PAGE_2], my_entry_id="111", week=4
    )

    assert teams == [
        FantasyTeam(external_id="111", name="Team Alpha", owner_name="Max Goodman", is_mine=True),
        FantasyTeam(external_id="222", name="Team Beta", owner_name="Someone Else", is_mine=False),
        FantasyTeam(external_id="333", name="Team Gamma", owner_name="A Third Person", is_mine=False),
    ]


def test_normalize_classic_standings_only_scores_entries_that_are_not_mine():
    # My own entry's weekly scores come from per-week picks instead (see
    # fetch_classic_league_data) — the standings total is season-cumulative,
    # not a real per-week number, so it must not collide with that.
    _, scores = _normalize_classic_standings(
        [CLASSIC_STANDINGS_PAGE_1, CLASSIC_STANDINGS_PAGE_2], my_entry_id="111", week=4
    )

    assert all(score.team_external_id != "111" for score in scores)
    assert any(score.team_external_id == "222" and score.points == 950.0 for score in scores)
    assert any(score.team_external_id == "333" and score.points == 900.0 for score in scores)


def test_fetch_classic_league_data_gives_my_entry_full_weekly_history_and_others_just_a_snapshot():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": EVENTS_FIXTURE[:3]})
        if path.endswith("/leagues-classic/C1/standings/"):
            return httpx.Response(
                200,
                json={"standings": {**CLASSIC_STANDINGS_PAGE_1["standings"], "has_next": False}},
            )
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/event/2/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 7}}]})
        if path.endswith("/event/3/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 9}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 55}}
            )
        if path.endswith("/entry/111/event/2/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 58}}
            )
        if path.endswith("/entry/111/event/3/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 60}}
            )
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_classic_league_data(league_id="C1", my_entry_id="111")

    my_scores = [s for s in result.weekly_scores if s.team_external_id == "111"]
    assert len(my_scores) == 3
    assert {s.week for s in my_scores} == {1, 2, 3}
    other_scores = [s for s in result.weekly_scores if s.team_external_id == "222"]
    assert other_scores == [WeeklyScore(team_external_id="222", week=3, points=950.0)]


def test_fetch_classic_league_data_skips_a_week_whose_live_points_call_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": EVENTS_FIXTURE[:3]})
        if path.endswith("/leagues-classic/C1/standings/"):
            return httpx.Response(
                200,
                json={"standings": {**CLASSIC_STANDINGS_PAGE_1["standings"], "has_next": False}},
            )
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/event/2/live/"):
            return httpx.Response(500, json={"error": "internal error"})
        if path.endswith("/event/3/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 9}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 55}}
            )
        if path.endswith("/entry/111/event/3/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 60}}
            )
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_classic_league_data(league_id="C1", my_entry_id="111")

    my_scores = [s for s in result.weekly_scores if s.team_external_id == "111"]
    assert len(my_scores) == 2
    assert {s.week for s in my_scores} == {1, 3}
    assert not any(s.week == 2 for s in my_scores)

    my_roster_weeks = {entry.week for entry in result.roster_players if entry.team_external_id == "111"}
    assert my_roster_weeks == {1, 3}


H2H_STANDINGS_PAGE = {
    "standings": {
        "has_next": False,
        "results": [
            {"entry": 111, "entry_name": "Team Alpha", "player_name": "Max Goodman"},
            {"entry": 222, "entry_name": "Team Beta", "player_name": "Rival Person"},
        ],
    }
}

H2H_MATCHES_PAGE = {
    "has_next": False,
    "results": [
        {"event": 1, "entry_1_entry": 111, "entry_1_points": 65, "entry_2_entry": 222, "entry_2_points": 58},
        {"event": 2, "entry_1_entry": 111, "entry_1_points": 70, "entry_2_entry": None, "entry_2_points": 0},
        {"event": 3, "entry_1_entry": 111, "entry_1_points": 0, "entry_2_entry": 333, "entry_2_points": 0},
    ],
}


def test_normalize_h2h_teams():
    teams = _normalize_h2h_teams([H2H_STANDINGS_PAGE], my_entry_id="111")

    assert teams == [
        FantasyTeam(external_id="111", name="Team Alpha", owner_name="Max Goodman", is_mine=True),
        FantasyTeam(external_id="222", name="Team Beta", owner_name="Rival Person", is_mine=False),
    ]


def test_normalize_h2h_matches_produces_a_score_row_per_side():
    scores = _normalize_h2h_matches([H2H_MATCHES_PAGE], current_week=2)

    assert WeeklyScore(team_external_id="111", week=1, points=65.0, opponent_external_id="222") in scores
    assert WeeklyScore(team_external_id="222", week=1, points=58.0, opponent_external_id="111") in scores


def test_normalize_h2h_matches_handles_a_bye_with_no_second_entry():
    scores = _normalize_h2h_matches([H2H_MATCHES_PAGE], current_week=2)

    week_2_scores = [s for s in scores if s.week == 2]
    assert week_2_scores == [WeeklyScore(team_external_id="111", week=2, points=70.0, opponent_external_id=None)]


def test_normalize_h2h_matches_excludes_weeks_after_current():
    scores = _normalize_h2h_matches([H2H_MATCHES_PAGE], current_week=1)

    assert all(score.week <= 1 for score in scores)
    assert any(score.team_external_id == "111" and score.week == 1 for score in scores)


def test_normalize_h2h_fixtures_includes_every_week_past_and_future():
    fixtures = _normalize_h2h_fixtures([H2H_MATCHES_PAGE])

    assert H2HFixture(team_external_id="111", week=1, opponent_external_id="222") in fixtures
    assert H2HFixture(team_external_id="222", week=1, opponent_external_id="111") in fixtures
    assert H2HFixture(team_external_id="111", week=3, opponent_external_id="333") in fixtures
    assert H2HFixture(team_external_id="333", week=3, opponent_external_id="111") in fixtures


def test_normalize_h2h_fixtures_handles_a_bye_with_no_second_entry():
    fixtures = _normalize_h2h_fixtures([H2H_MATCHES_PAGE])

    week_2_fixtures = [f for f in fixtures if f.week == 2]
    assert week_2_fixtures == [H2HFixture(team_external_id="111", week=2, opponent_external_id=None)]


def test_fetch_h2h_league_data_pulls_teams_matches_and_every_teams_roster():
    events_one_week = [{"id": 1, "is_current": True, "finished": False}]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": events_one_week})
        if path.endswith("/leagues-h2h/H1/standings/"):
            return httpx.Response(200, json={"standings": {**H2H_STANDINGS_PAGE["standings"], "has_next": False}})
        if path.endswith("/leagues-h2h-matches/league/H1/"):
            return httpx.Response(200, json={**H2H_MATCHES_PAGE, "results": [H2H_MATCHES_PAGE["results"][0]]})
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 6}}
            )
        if path.endswith("/entry/222/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 6}}
            )
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_h2h_league_data(league_id="H1", my_entry_id="111")

    assert {team.external_id for team in result.teams} == {"111", "222"}
    assert WeeklyScore(team_external_id="111", week=1, points=65.0, opponent_external_id="222") in result.weekly_scores
    assert {entry.team_external_id for entry in result.roster_players} == {"111", "222"}


def test_fetch_h2h_league_data_skips_a_team_whose_picks_call_fails():
    events_one_week = [{"id": 1, "is_current": True, "finished": False}]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": events_one_week})
        if path.endswith("/leagues-h2h/H1/standings/"):
            return httpx.Response(200, json={"standings": {**H2H_STANDINGS_PAGE["standings"], "has_next": False}})
        if path.endswith("/leagues-h2h-matches/league/H1/"):
            return httpx.Response(200, json={**H2H_MATCHES_PAGE, "results": [H2H_MATCHES_PAGE["results"][0]]})
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 6}}
            )
        if path.endswith("/entry/222/event/1/picks/"):
            return httpx.Response(500, json={"error": "internal error"})
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_h2h_league_data(league_id="H1", my_entry_id="111")

    # Team 222's picks call failed, but team 111's roster data still comes
    # through, and the overall teams/weekly_scores are unaffected.
    assert {team.external_id for team in result.teams} == {"111", "222"}
    assert WeeklyScore(team_external_id="111", week=1, points=65.0, opponent_external_id="222") in result.weekly_scores
    assert {entry.team_external_id for entry in result.roster_players} == {"111"}


# Real shape confirmed live, 2026-09-09, against
# GET https://fantasy.premierleague.com/api/entry/{entry_id}/history/
ENTRY_HISTORY_FIXTURE = {
    "current": [
        {"event": 1, "points": 41, "total_points": 41, "rank": 6875552, "overall_rank": 6875541},
    ],
    "past": [
        {"season_name": "2012/13", "total_points": 1814, "rank": 931683, "rank_percentage": "36"},
        {"season_name": "2013/14", "total_points": 2248, "rank": 169686, "rank_percentage": "5"},
    ],
    "chips": [
        {"name": "bboost", "time": "2026-08-28T17:25:01.123184Z", "event": 2},
    ],
}

ENTRY_HISTORY_NO_PAST_FIXTURE = {
    "current": [],
    "past": [],
    "chips": [],
}


def test_normalize_entry_history_maps_past_seasons():
    rows = _normalize_entry_history(ENTRY_HISTORY_FIXTURE)

    assert rows == [
        {"season_name": "2012/13", "total_points": 1814, "rank": 931683, "rank_percentage": 36.0},
        {"season_name": "2013/14", "total_points": 2248, "rank": 169686, "rank_percentage": 5.0},
    ]


def test_normalize_entry_history_returns_empty_list_when_no_past_seasons():
    # A manager who is new to FPL this season has an empty `past` array —
    # a normal, valid outcome, not an error.
    assert _normalize_entry_history(ENTRY_HISTORY_NO_PAST_FIXTURE) == []


def test_normalize_entry_history_casts_rank_percentage_to_a_number():
    # FPL encodes rank_percentage as a JSON string (e.g. "36"); it's
    # semantically numeric, so normalize casts it rather than storing text.
    rows = _normalize_entry_history(ENTRY_HISTORY_FIXTURE)

    assert all(isinstance(row["rank_percentage"], float) for row in rows)


def test_normalize_entry_history_ignores_current_and_chips():
    rows = _normalize_entry_history(ENTRY_HISTORY_FIXTURE)

    assert all(set(row.keys()) == {"season_name", "total_points", "rank", "rank_percentage"} for row in rows)


def test_fetch_entry_history_calls_the_right_url_and_returns_normalized_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/entry/12345/history/")
        return httpx.Response(200, json=ENTRY_HISTORY_FIXTURE)

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    rows = adapter.fetch_entry_history("12345")

    assert rows == _normalize_entry_history(ENTRY_HISTORY_FIXTURE)
