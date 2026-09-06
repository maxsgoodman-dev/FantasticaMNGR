import httpx
import pytest

from fantasy_ingest.adapters.base import FantasySourceAdapter
from fantasy_ingest.models import Player, Team
from fantasy_ingest.warehouse import sync_adapter, sync_all


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
