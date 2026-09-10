"""Ingest the community-maintained "FPL Data & Planner" Google Sheet.

Not a `FantasySourceAdapter` — this isn't a platform adapter, it's a
single read-only CSV pull from a third-party, publicly-shared spreadsheet
(see docs/superpowers/specs/2026-09-10-matchup-prep-design.md's "Fourth
data source" section for the sheet URL, provenance, and attribution
note). Same fetch/normalize split every adapter in this package follows,
so it's just as unit-testable without a network call.

Only the sheet's "Data" tab is ingested — a clean 52-column table (one
row per player). The other 8 tabs are prose-formatted dashboards built
*from* Data's own numbers by the sheet's own formulas; ingesting Data
alone captures everything they surface in raw form.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, timezone, datetime

import httpx

SHEET_ID = "1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM"
GVIZ_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"

# Data's own vocabulary ("GK") doesn't match the GKP/DEF/MID/FWD this
# codebase uses everywhere else (players, fpl_player_season_stats) —
# normalized here so every FPL-sourced table agrees.
_POSITION_MAP = {"GK": "GKP", "DEF": "DEF", "MID": "MID", "FWD": "FWD"}

_FIXTURE_RE = re.compile(r"^(.+?)\s*\(([HA])\)$")

# The columns this ingests, by exact header name in the sheet. Data has a
# duplicate column block (a spreadsheet-internal helper feeding the later
# xG/DefCon columns, in a different format) repeating Cost Today/Total
# Cost Change/Cost Change GW/Position/Team — `_header_index` below always
# resolves to the *first* occurrence, which is these display-formatted
# ones, not the redundant second block.


def _parse_currency(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    return float(value.replace("£", "").replace(",", ""))


def _parse_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    return float(value)


def _parse_int(value: str) -> int | None:
    value = value.strip()
    if not value:
        return None
    return int(float(value))


def _parse_fixture(value: str, gw: int) -> dict | None:
    value = value.strip()
    if not value:
        return None
    match = _FIXTURE_RE.match(value)
    if not match:
        return None
    opponent, home_away = match.groups()
    return {"gw": gw, "opponent": opponent, "is_home": home_away == "H"}


def _header_index(header: list[str]) -> dict[str, int]:
    """Name -> first occurrence's column index (see module docstring re: the duplicate block)."""
    index: dict[str, int] = {}
    for i, name in enumerate(header):
        if name not in index:
            index[name] = i
    return index


def _normalize_rows(csv_text: str, data_fetched: date) -> list[dict]:
    reader = csv.reader(io.StringIO(csv_text))
    header = next(reader)
    index = _header_index(header)

    def get(row: list[str], name: str) -> str:
        return row[index[name]]

    rows = []
    for row in reader:
        player_id = get(row, "Player ID").strip()
        if not player_id:
            continue

        next_fixtures = []
        for gw in range(4, 10):
            fixture = _parse_fixture(get(row, f"GW{gw}"), gw)
            if fixture:
                next_fixtures.append(fixture)

        raw_position = get(row, "Position").strip()
        rows.append(
            {
                "external_player_id": player_id,
                "web_name": f"{get(row, 'Name').strip()} {get(row, 'Last Name').strip()}".strip(),
                "position": _POSITION_MAP.get(raw_position, raw_position),
                "team_name": get(row, "Team").strip(),
                "cost_today": _parse_currency(get(row, "Cost Today")),
                "form": _parse_float(get(row, "Form")),
                "selection_percent": _parse_float(get(row, "Selection %")),
                "total_points": _parse_int(get(row, "Total Points")) or 0,
                "points_per_game": _parse_float(get(row, "Points/Game")),
                "chance_of_playing_next": _parse_int(get(row, "Chance Of Playing Next")),
                "total_cost_change": _parse_currency(get(row, "Total Cost Change")),
                "cost_change_gw": _parse_currency(get(row, "Cost Change GW")),
                "total_transfers_in": _parse_int(get(row, "Total Transfers in")),
                "total_transfers_out": _parse_int(get(row, "Total Transfers Out")),
                "influence": _parse_float(get(row, "Influence")),
                "creativity": _parse_float(get(row, "Creativity")),
                "threat": _parse_float(get(row, "Threat")),
                "ict_index": _parse_float(get(row, "ICT Index")),
                "next_fixtures": next_fixtures,
                "difficulty_score": _parse_float(get(row, "Difficulty Score")),
                "xgi_per_90": _parse_float(get(row, "xGi / 90 (ATT)")),
                "xgc_per_90": _parse_float(get(row, "xGc / 90 (DEF)")),
                "defcon": _parse_float(get(row, "DefCon")),
                "price_change_progress": _parse_float(get(row, "Price change progress")),
                "data_fetched": data_fetched.isoformat(),
            }
        )
    return rows


def _fetch_csv(client: httpx.Client) -> str:
    response = client.get(GVIZ_URL, params={"tqx": "out:csv", "sheet": "Data"})
    response.raise_for_status()
    return response.text


def fetch_fpl_sheet_data(client: httpx.Client | None = None) -> list[dict]:
    """Fetch and normalize the sheet's Data tab. `data_fetched` is our own
    sync date (UTC), not literally parsed off the sheet — see the design
    doc's "data_fetched revision" note for why."""
    owns_client = client is None
    client = client or httpx.Client(follow_redirects=True)
    try:
        csv_text = _fetch_csv(client)
    finally:
        if owns_client:
            client.close()
    return _normalize_rows(csv_text, datetime.now(timezone.utc).date())
