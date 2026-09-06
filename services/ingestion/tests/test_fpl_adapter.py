from fantasy_ingest.adapters.fpl import FPLAdapter, _normalize_players, _normalize_teams
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
