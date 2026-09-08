import os
from unittest.mock import patch

import pytest

from fantasy_ingest.adapters.sleeper import SleeperAdapter
from fantasy_ingest.league_config import build_league_sync_jobs


@pytest.fixture(autouse=True)
def clear_league_env(monkeypatch):
    for key in ["SLEEPER_USER_ID", "SLEEPER_LEAGUE_IDS", "FPL_ENTRY_ID", "FPL_H2H_LEAGUE_ID", "FPL_CLASSIC_LEAGUE_ID"]:
        monkeypatch.delenv(key, raising=False)


def test_build_league_sync_jobs_with_nothing_configured_returns_empty():
    assert build_league_sync_jobs() == []


def test_build_league_sync_jobs_builds_two_sleeper_jobs(monkeypatch):
    monkeypatch.setenv("SLEEPER_USER_ID", "u1")
    monkeypatch.setenv("SLEEPER_LEAGUE_IDS", "L1,L2")

    jobs = build_league_sync_jobs()

    assert [league["external_league_id"] for league, _ in jobs] == ["L1", "L2"]
    assert all(league["source_id"] == "sleeper" for league, _ in jobs)
    assert all(league["format"] == "head_to_head" for league, _ in jobs)
    assert all(callable(fetch_fn) for _, fetch_fn in jobs)


def test_build_league_sync_jobs_builds_fpl_h2h_and_classic(monkeypatch):
    monkeypatch.setenv("FPL_ENTRY_ID", "111")
    monkeypatch.setenv("FPL_H2H_LEAGUE_ID", "H1")
    monkeypatch.setenv("FPL_CLASSIC_LEAGUE_ID", "C1")

    jobs = build_league_sync_jobs()

    formats_by_league_id = {league["external_league_id"]: league["format"] for league, _ in jobs}
    assert formats_by_league_id == {"H1": "head_to_head", "C1": "classic"}
    assert all(league["source_id"] == "fpl" for league, _ in jobs)


def test_build_league_sync_jobs_skips_fpl_when_entry_id_missing(monkeypatch):
    monkeypatch.setenv("FPL_H2H_LEAGUE_ID", "H1")
    monkeypatch.setenv("FPL_CLASSIC_LEAGUE_ID", "C1")

    assert build_league_sync_jobs() == []


def test_build_league_sync_jobs_sleeper_fetch_fns_use_their_own_league_id(monkeypatch):
    monkeypatch.setenv("SLEEPER_USER_ID", "u1")
    monkeypatch.setenv("SLEEPER_LEAGUE_IDS", "L1,L2")

    jobs = build_league_sync_jobs()

    # Prove each job's fetch_fn closure carries its own league_id rather than
    # all of them sharing the loop's final value (the classic Python
    # late-binding closure bug) by actually invoking both fetch_fns and
    # recording what SleeperAdapter.fetch_league_data was called with.
    with patch.object(SleeperAdapter, "fetch_league_data", return_value="fake-result") as mock_fetch:
        for _, fetch_fn in jobs:
            fetch_fn()

    assert mock_fetch.call_args_list[0].args == ("L1", "u1")
    assert mock_fetch.call_args_list[1].args == ("L2", "u1")
