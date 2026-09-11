import httpx
import pytest

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
from fantasy_ingest.models import Player, PlayerProjection, Team
from fantasy_ingest.warehouse import (
    sync_adapter,
    sync_all,
    sync_all_leagues,
    sync_fpl_sheet,
    sync_league_data,
    sync_projections,
)


class FakeAdapter(FantasySourceAdapter):
    source = "testsource"
    sport = "testsport"

    def fetch_teams(self) -> list[Team]:
        return [Team(id="1", name="Test United", short_name="TST")]

    def fetch_players(self) -> list[Player]:
        return [
            Player(id="101", name="Test Player", team="TST", position="MID", price=5.0, total_points=42, form=3.5)
        ]

    def fetch_matchups(self) -> list[dict]:
        raise NotImplementedError


@pytest.fixture
def recorded_requests():
    return []


def make_client(recorded_requests):
    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        return httpx.Response(201, json=[])

    return httpx.Client(base_url="https://example.supabase.co/rest/v1", transport=httpx.MockTransport(handler))


def test_sync_adapter_posts_teams_and_players_with_upsert_semantics(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_adapter(FakeAdapter(), client=client)

    assert counts == {"teams": 1, "players": 1}
    assert len(recorded_requests) == 2

    teams_request, players_request = recorded_requests
    assert teams_request.url.path.endswith("/teams")
    assert "on_conflict=source_id,external_id" in str(teams_request.url)
    assert players_request.url.path.endswith("/players")
    assert "on_conflict=source_id,external_id" in str(players_request.url)


def test_sync_adapter_rows_carry_source_and_sport(recorded_requests):
    import json

    client = make_client(recorded_requests)

    sync_adapter(FakeAdapter(), client=client)

    teams_request, players_request = recorded_requests
    team_row = json.loads(teams_request.content)[0]
    player_row = json.loads(players_request.content)[0]

    assert team_row["source_id"] == "testsource"
    assert team_row["sport_id"] == "testsport"
    assert team_row["external_id"] == "1"
    assert player_row["source_id"] == "testsource"
    assert player_row["sport_id"] == "testsport"
    assert player_row["external_id"] == "101"
    assert player_row["total_points"] == 42


def test_sync_adapter_skips_empty_post_when_no_rows(recorded_requests):
    class EmptyAdapter(FakeAdapter):
        def fetch_teams(self) -> list[Team]:
            return []

        def fetch_players(self) -> list[Player]:
            return []

    client = make_client(recorded_requests)

    counts = sync_adapter(EmptyAdapter(), client=client)

    assert counts == {"teams": 0, "players": 0}
    assert recorded_requests == []


class FakeAdapterWithProjections(FakeAdapter):
    def fetch_projections(self, week: int) -> list[PlayerProjection]:
        return [PlayerProjection(player_external_id="101", projected_points=12.5)]


def test_sync_projections_posts_with_upsert_semantics(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_projections(FakeAdapterWithProjections(), week=3, client=client)

    assert counts == {"projections": 1}
    assert len(recorded_requests) == 1
    request = recorded_requests[0]
    assert request.url.path.endswith("/player_projections")
    assert "on_conflict=source_id,sport_id,week,external_player_id" in str(request.url)


def test_sync_projections_rows_carry_week_and_identity(recorded_requests):
    import json

    client = make_client(recorded_requests)

    sync_projections(FakeAdapterWithProjections(), week=3, client=client)

    row = json.loads(recorded_requests[0].content)[0]
    assert row["source_id"] == "testsource"
    assert row["sport_id"] == "testsport"
    assert row["week"] == 3
    assert row["external_player_id"] == "101"
    assert row["projected_points"] == 12.5


def test_sync_projections_skips_empty_post_when_no_rows(recorded_requests):
    class EmptyProjectionsAdapter(FakeAdapter):
        def fetch_projections(self, week: int) -> list[PlayerProjection]:
            return []

    client = make_client(recorded_requests)

    counts = sync_projections(EmptyProjectionsAdapter(), week=3, client=client)

    assert counts == {"projections": 0}
    assert recorded_requests == []


class BrokenAdapter(FakeAdapter):
    source = "brokensource"

    def fetch_teams(self):
        raise RuntimeError("upstream is down")


def test_sync_all_isolates_one_adapters_failure_from_the_rest(recorded_requests):
    # Confirmed live (2026-09-06): ESPN's /teams list includes team ids
    # that 404 on /roster (team 22 specifically) — one adapter failing
    # partway through must not stop the others from syncing.
    client = make_client(recorded_requests)

    results = sync_all([FakeAdapter(), BrokenAdapter()], client=client)

    assert results["testsource"] == {"teams": 1, "players": 1}
    assert "upstream is down" in results["brokensource"]["error"]


SLEEPER_LEAGUE = {
    "source_id": "sleeper",
    "sport_id": "nfl",
    "external_league_id": "L1",
    "name": "Test Sleeper League",
    "season": "2026",
    "format": "head_to_head",
}


def make_league_sync_result() -> LeagueSyncResult:
    return LeagueSyncResult(
        teams=[FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)],
        weekly_scores=[WeeklyScore(team_external_id="1", week=1, points=100.0, opponent_external_id="2")],
        roster_players=[
            RosterEntry(
                team_external_id="1", week=1, player_external_id="4046", player_name="Patrick Mahomes",
                is_starter=True, points=24.0,
            )
        ],
    )


def test_sync_league_data_posts_league_teams_scores_and_roster(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_league_data(SLEEPER_LEAGUE, make_league_sync_result(), client=client)

    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
    paths = [request.url.path for request in recorded_requests]
    assert paths == [
        "/rest/v1/leagues",
        "/rest/v1/fantasy_teams",
        "/rest/v1/weekly_scores",
        "/rest/v1/roster_players",
    ]

    league_request = recorded_requests[0]
    assert "on_conflict=source_id,external_league_id" in str(league_request.url)


def test_sync_league_data_posts_h2h_fixtures_when_present(recorded_requests):
    client = make_client(recorded_requests)
    result = LeagueSyncResult(h2h_fixtures=[H2HFixture(team_external_id="1", week=4, opponent_external_id="2")])

    counts = sync_league_data(SLEEPER_LEAGUE, result, client=client)

    assert counts["h2h_fixtures"] == 1
    paths = [request.url.path for request in recorded_requests]
    assert paths == ["/rest/v1/leagues", "/rest/v1/h2h_fixtures"]

    fixture_request = recorded_requests[1]
    assert "on_conflict=source_id,external_league_id,external_team_id,week" in str(fixture_request.url)


def test_sync_all_leagues_isolates_a_failing_league(recorded_requests):
    client = make_client(recorded_requests)

    def broken_fetch():
        raise RuntimeError("FPL is down")

    jobs = [
        (SLEEPER_LEAGUE, make_league_sync_result),
        ({**SLEEPER_LEAGUE, "source_id": "fpl", "external_league_id": "L2"}, broken_fetch),
    ]

    results = sync_all_leagues(jobs, client=client)

    assert results["sleeper:L1"] == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
    assert "FPL is down" in results["fpl:L2"]["error"]


def test_sync_league_data_always_posts_league_row_but_skips_empty_child_tables(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_league_data(SLEEPER_LEAGUE, LeagueSyncResult(), client=client)

    assert counts == {"teams": 0, "weekly_scores": 0, "roster_players": 0, "h2h_fixtures": 0}
    paths = [request.url.path for request in recorded_requests]
    assert paths == ["/rest/v1/leagues"]


FAKE_SHEET_ROW = {
    "external_player_id": "101",
    "web_name": "Test Player",
    "position": "MID",
    "team_name": "Test United",
    "cost_today": 6.0,
    "form": 5.0,
    "selection_percent": 10.0,
    "total_points": 42,
    "points_per_game": 4.2,
    "chance_of_playing_next": None,
    "total_cost_change": 0.0,
    "cost_change_gw": 0.0,
    "total_transfers_in": 100,
    "total_transfers_out": 50,
    "influence": 10.0,
    "creativity": 5.0,
    "threat": 3.0,
    "ict_index": 1.8,
    "next_fixtures": [{"gw": 4, "opponent": "ARS", "is_home": True}],
    "difficulty_score": 14.0,
    "xgi_per_90": 0.5,
    "xgc_per_90": 0.3,
    "defcon": 2.0,
    "price_change_progress": 12.0,
    "data_fetched": "2026-09-10",
}


def test_sync_fpl_sheet_posts_with_upsert_semantics(recorded_requests, monkeypatch):
    monkeypatch.setattr(
        "fantasy_ingest.warehouse.fetch_fpl_sheet_data", lambda: [FAKE_SHEET_ROW]
    )
    client = make_client(recorded_requests)

    counts = sync_fpl_sheet(client=client)

    assert counts == {"fpl_sheet_rows": 1}
    assert len(recorded_requests) == 1
    request = recorded_requests[0]
    assert request.url.path.endswith("/fpl_sheet_player_data")
    assert "on_conflict=external_player_id,data_fetched" in str(request.url)


def test_sync_fpl_sheet_skips_empty_post_when_no_rows(recorded_requests, monkeypatch):
    monkeypatch.setattr("fantasy_ingest.warehouse.fetch_fpl_sheet_data", lambda: [])
    client = make_client(recorded_requests)

    counts = sync_fpl_sheet(client=client)

    assert counts == {"fpl_sheet_rows": 0}
    assert recorded_requests == []
