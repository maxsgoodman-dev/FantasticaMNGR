import pytest

from fantasy_ingest.adapters.fpl import (
    FPLAdapter,
    _current_gameweek,
    _normalize_picks,
    _normalize_players,
    _normalize_teams,
)
from fantasy_ingest.league_models import RosterEntry
from fantasy_ingest.models import Player, Team

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
        },
    ],
}

EVENTS_FIXTURE = [
    {"id": 1, "is_current": False, "finished": True},
    {"id": 2, "is_current": False, "finished": True},
    {"id": 3, "is_current": True, "finished": False},
    {"id": 4, "is_current": False, "finished": False},
]


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
