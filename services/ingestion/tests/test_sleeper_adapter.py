from fantasy_ingest.adapters.sleeper import (
    NFL_TEAMS,
    SleeperAdapter,
    _normalize_players,
    _normalize_teams,
)
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
