import httpx

from fantasy_ingest.adapters.espn import ESPNAdapter, _normalize_roster, _normalize_teams
from fantasy_ingest.models import Player, Team

# Shaped per public documentation (nntrn gist, pseudo-r/Public-ESPN-API),
# not captured from a live response — see espn.py's module docstring.
TEAMS_FIXTURE = {
    "sports": [
        {
            "leagues": [
                {
                    "teams": [
                        {
                            "team": {
                                "id": "12",
                                "displayName": "Kansas City Chiefs",
                                "abbreviation": "KC",
                            }
                        },
                        {
                            "team": {
                                "id": "8",
                                "displayName": "Detroit Lions",
                                "abbreviation": "DET",
                            }
                        },
                    ]
                }
            ]
        }
    ]
}

ROSTER_FIXTURE_GROUPED = {
    "athletes": [
        {
            "position": "offense",
            "items": [
                {
                    "id": "3139477",
                    "fullName": "Patrick Mahomes",
                    "position": {"abbreviation": "QB"},
                },
                {
                    # Missing position — should be skipped, not crash.
                    "id": "9999",
                    "fullName": "No Position Guy",
                    "position": None,
                },
            ],
        }
    ]
}

ROSTER_FIXTURE_FLAT = {
    "athletes": [
        {"id": "4362628", "fullName": "Amon-Ra St. Brown", "position": {"abbreviation": "WR"}},
    ]
}


def test_adapter_declares_sport():
    assert ESPNAdapter.sport == "nfl"


def test_normalize_teams():
    teams = _normalize_teams(TEAMS_FIXTURE)

    assert teams == [
        Team(id="12", name="Kansas City Chiefs", short_name="KC"),
        Team(id="8", name="Detroit Lions", short_name="DET"),
    ]


def test_normalize_roster_grouped_shape():
    players = _normalize_roster(ROSTER_FIXTURE_GROUPED, "KC")

    assert players == [
        Player(
            id="3139477",
            name="Patrick Mahomes",
            team="KC",
            position="QB",
            price=0.0,
            total_points=0,
            form=0.0,
        )
    ]


def test_normalize_roster_drops_entries_missing_position():
    players = _normalize_roster(ROSTER_FIXTURE_GROUPED, "KC")

    assert all(p.id != "9999" for p in players)


def test_normalize_roster_flat_shape_fallback():
    players = _normalize_roster(ROSTER_FIXTURE_FLAT, "DET")

    assert players == [
        Player(
            id="4362628",
            name="Amon-Ra St. Brown",
            team="DET",
            position="WR",
            price=0.0,
            total_points=0,
            form=0.0,
        )
    ]


def test_fetch_players_skips_a_team_whose_roster_404s():
    # Confirmed live (2026-09-06): ESPN's own /teams list includes team
    # id "22", but GET .../teams/22/roster 404s while other team ids
    # (e.g. "1") return 200 — a real, ESPN-side inconsistency, not a bug
    # in this adapter's URL pattern. One team 404ing must not lose every
    # other team's roster.
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/teams"):
            return httpx.Response(200, json=TEAMS_FIXTURE)
        if request.url.path.endswith("/teams/12/roster"):
            return httpx.Response(200, json=ROSTER_FIXTURE_FLAT)
        if request.url.path.endswith("/teams/8/roster"):
            return httpx.Response(404, json={"error": "not found"})
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = ESPNAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    players = adapter.fetch_players()

    assert players == [
        Player(
            id="4362628",
            name="Amon-Ra St. Brown",
            team="KC",
            position="WR",
            price=0.0,
            total_points=0,
            form=0.0,
        )
    ]
