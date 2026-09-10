import csv
import io
from datetime import date

import httpx

from fantasy_ingest.sources.fpl_community_sheet import (
    _normalize_rows,
    _parse_currency,
    _parse_fixture,
    fetch_fpl_sheet_data,
)

# Real header order (see the design doc's "Fourth data source" section):
# columns 4/6/7/25/26 (Cost Today, Position, Team, Total Cost Change,
# Cost Change GW) are deliberately repeated at 43-47 as a spreadsheet-
# internal helper block, in a different (non-£-prefixed) format --
# _normalize_rows must use the first occurrence, not the second.
HEADER = [
    "Player ID", "Name", "Last Name", "Cost Today", "Form", "Position", "Team", "Selection %",
    "Goals", "Assists", "Clean Sheets", "GW Points", "Total Points", "Points/Game",
    "Total Bonus Points", "Total BPS", "Goals Conceded", "Minutes", "YC", "RC", "Saves",
    "Penalties Saved", "Penalties Missed", "Chance Of Playing Next", "Total Cost Change",
    "Cost Change GW", "Total Transfers Out", "Transfers Out GW", "Total Transfers in",
    "Transfers in GW", "Influence", "Creativity", "Threat", "ICT Index", "Last GW",
    "GW4", "GW5", "GW6", "GW7", "GW8", "GW9", "Difficulty Score",
    "Cost Today", "Total Cost Change", "Cost Change GW", "Position", "Team", "Index",
    "xGi / 90 (ATT)", "xGc / 90 (DEF)", "DefCon", "Price change progress",
]

ROW_NORMAL = [
    "1", "David", "Raya", "£6.00", "5", "GK", "Arsenal", "38.9",
    "0", "0", "2", "3", "15", "5",
    "0", "60", "1", "270", "0", "0", "5",
    "0", "0", "",  # blank Chance Of Playing Next
    "£0.00", "£0.00", "428001", "117295", "454314", "142632",
    "46.2", "0", "0", "4.7", "3",
    "SUN (A)", "BHA (A)", "LEE (H)", "NFO (A)", "EVE (H)", "LIV (A)", "14",
    "9999", "£99.00", "£99.00", "XXX", "XXX", "1",  # duplicate block -- must be ignored
    "0", "0.31", "0", "13.2",
]

ROW_ACCENTED_NAME_WITH_INJURY_CHANCE = [
    "5", "Jurriën", "J.Timber", "£6.50", "0", "DEF", "Arsenal", "0.1",
    "0", "0", "0", "0", "0", "0",
    "0", "0", "0", "0", "0", "0", "0",
    "0", "0", "25",  # 25% chance of playing
    "£0.00", "£0.00", "6554", "1009", "1429", "479",
    "0", "0", "0", "0", "3",
    "SUN (A)", "BHA (A)", "LEE (H)", "NFO (A)", "EVE (H)", "LIV (A)", "14",
    "9999", "£99.00", "£99.00", "XXX", "XXX", "1",
    "0", "0", "0", "-0.2",
]


def _fixture_csv(rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(HEADER)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


def test_normalize_rows_parses_currency_and_takes_first_occurrence_of_duplicate_columns():
    rows = _normalize_rows(_fixture_csv([ROW_NORMAL]), data_fetched=date(2026, 9, 10))

    assert rows == [
        {
            "external_player_id": "1",
            "web_name": "David Raya",
            "position": "GKP",
            "team_name": "Arsenal",
            "cost_today": 6.0,
            "form": 5.0,
            "selection_percent": 38.9,
            "total_points": 15,
            "points_per_game": 5.0,
            "chance_of_playing_next": None,
            "total_cost_change": 0.0,
            "cost_change_gw": 0.0,
            "total_transfers_in": 454314,
            "total_transfers_out": 428001,
            "influence": 46.2,
            "creativity": 0.0,
            "threat": 0.0,
            "ict_index": 4.7,
            "next_fixtures": [
                {"gw": 4, "opponent": "SUN", "is_home": False},
                {"gw": 5, "opponent": "BHA", "is_home": False},
                {"gw": 6, "opponent": "LEE", "is_home": True},
                {"gw": 7, "opponent": "NFO", "is_home": False},
                {"gw": 8, "opponent": "EVE", "is_home": True},
                {"gw": 9, "opponent": "LIV", "is_home": False},
            ],
            "difficulty_score": 14.0,
            "xgi_per_90": 0.0,
            "xgc_per_90": 0.31,
            "defcon": 0.0,
            "price_change_progress": 13.2,
            "data_fetched": "2026-09-10",
        }
    ]


def test_normalize_rows_handles_accented_name_and_nonblank_chance_of_playing():
    rows = _normalize_rows(
        _fixture_csv([ROW_ACCENTED_NAME_WITH_INJURY_CHANCE]), data_fetched=date(2026, 9, 10)
    )

    assert rows[0]["web_name"] == "Jurriën J.Timber"
    assert rows[0]["chance_of_playing_next"] == 25
    assert rows[0]["position"] == "DEF"


def test_normalize_rows_skips_a_row_with_no_player_id():
    blank_row = list(ROW_NORMAL)
    blank_row[0] = ""

    rows = _normalize_rows(_fixture_csv([blank_row]), data_fetched=date(2026, 9, 10))

    assert rows == []


def test_parse_currency_handles_blank_and_prefixed_values():
    assert _parse_currency("£6.00") == 6.0
    assert _parse_currency("") is None
    assert _parse_currency("-£0.10") == -0.10


def test_parse_fixture_parses_opponent_and_home_away():
    assert _parse_fixture("SUN (A)", gw=4) == {"gw": 4, "opponent": "SUN", "is_home": False}
    assert _parse_fixture("LEE (H)", gw=6) == {"gw": 6, "opponent": "LEE", "is_home": True}
    assert _parse_fixture("", gw=4) is None


def test_fetch_fpl_sheet_data_calls_the_gviz_endpoint_with_the_data_sheet():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["tqx"] == "out:csv"
        assert request.url.params["sheet"] == "Data"
        return httpx.Response(200, text=_fixture_csv([ROW_NORMAL]))

    client = httpx.Client(transport=httpx.MockTransport(handler))

    rows = fetch_fpl_sheet_data(client=client)

    assert len(rows) == 1
    assert rows[0]["external_player_id"] == "1"
