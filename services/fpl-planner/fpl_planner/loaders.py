"""Loader layer for the two ingested FPL data sources.

Every function here exists to encode a specific gotcha discovered while
ingesting the data (see services/fpl-planner/docs/). Do not bypass these
by reading the CSVs directly elsewhere in the codebase.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
VAASTAV_DIR = DATA_DIR / "vaastav-fpl-history"
FPL_CORE_DIR = DATA_DIR / "fpl-core-insights"

ELEMENT_TYPE_TO_POSITION = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

# fpl-core's players.csv spells positions out in full instead of using
# vaastav's element_type codes. Normalize to the same GKP/DEF/MID/FWD
# vocabulary so the two sources are comparable.
FPL_CORE_POSITION_TO_CODE = {
    "Goalkeeper": "GKP",
    "Defender": "DEF",
    "Midfielder": "MID",
    "Forward": "FWD",
}

# Column that first appears in each schema era, in vaastav's players_raw.csv.
# Verified against the actual ingested headers — NOT the same boundary the
# ingestion brief guessed ("~2020-21" for xG); the real break is 2022-23.
_SCHEMA_ERA_MARKERS = [
    ("xg_defensive_contribution", "defensive_contribution"),
    ("xg", "expected_goals"),
]


def _schema_era(columns: set[str]) -> str:
    for era, marker_col in _SCHEMA_ERA_MARKERS:
        if marker_col in columns:
            return era
    return "pre_xg"


def _read_csv(path: Path) -> pd.DataFrame:
    # utf-8-sig + explicit \r stripping: belt-and-braces even though the
    # ingested files were already normalized to LF on disk.
    df = pd.read_csv(path, encoding="utf-8-sig")
    df.columns = [c.rstrip("\r") for c in df.columns]
    return df


def _load_vaastav_players(season: str) -> pd.DataFrame:
    df = _read_csv(VAASTAV_DIR / season / "players_raw.csv")
    df["position"] = df["element_type"].map(ELEMENT_TYPE_TO_POSITION)
    df["price"] = df["now_cost"] / 10
    df["code"] = df["code"].astype(str)
    df["season"] = season
    df["schema_era"] = _schema_era(set(df.columns))
    return df.set_index("code", drop=False)


def _load_fpl_core_players(season: str, latest_only: bool = True) -> pd.DataFrame:
    identity = _read_csv(FPL_CORE_DIR / season / "players.csv")
    identity["player_id"] = identity["player_id"].astype(str)

    stats_path = FPL_CORE_DIR / season / "playerstats.csv"
    if not stats_path.exists():
        stats_path = FPL_CORE_DIR / season / "playerstats_season_end_gw38.csv"
    stats = _read_csv(stats_path)
    stats["id"] = stats["id"].astype(str)

    if latest_only:
        stats = stats.sort_values("gw").groupby("id", as_index=False).tail(1)

    merged = identity.merge(stats, left_on="player_id", right_on="id", how="left", suffixes=("", "_stats"))
    merged["position"] = merged["position"].map(FPL_CORE_POSITION_TO_CODE).fillna("UNK")
    # fpl-core's now_cost is already in £m (5.5), unlike vaastav's tenths
    # (155 = £15.5m) — do NOT divide by 10 here.
    merged["price"] = merged["now_cost"]
    merged["code"] = merged["player_code"].astype(str)
    merged["season"] = season
    return merged.set_index("code", drop=False)


def load_players(source: str, season: str, **kwargs) -> pd.DataFrame:
    """Load one season's players from one source.

    `season` must be in the source's own format: "2026-27" for vaastav,
    "2026-2027" for fpl-core (see docs/data-sources-*.md).
    """
    if source == "vaastav":
        return _load_vaastav_players(season)
    if source == "fpl-core":
        return _load_fpl_core_players(season, **kwargs)
    raise ValueError(f"unknown source: {source!r}")


def resolve_team(season: str, team_id: int | str) -> str:
    """Resolve a vaastav season + numeric team id to a club name.

    Team ids are re-numbered by the FPL API every season, so this must
    never be memoized/hardcoded across seasons.

    master_team_list.csv only covers 2016-17..2023-24 in the upstream
    repo as ingested — it was never extended for 2024-25 onward. For
    those seasons we fall back to that season's own teams.csv, which
    vaastav has published since 2019-20.
    """
    team_id = str(team_id)
    master = _read_csv(VAASTAV_DIR / "master_team_list.csv")
    master["team"] = master["team"].astype(str)
    hit = master[(master["season"] == season) & (master["team"] == team_id)]
    if not hit.empty:
        return hit.iloc[0]["team_name"]

    teams_path = VAASTAV_DIR / season / "teams.csv"
    if teams_path.exists():
        teams = _read_csv(teams_path)
        teams["id"] = teams["id"].astype(str)
        hit = teams[teams["id"] == team_id]
        if not hit.empty:
            return hit.iloc[0]["name"]

    raise KeyError(f"no team name for season={season!r} team_id={team_id!r}")


def unify_seasons(seasons: list[str]) -> pd.DataFrame:
    """Union vaastav players_raw across seasons, null-filling missing columns.

    Adds `season` (already present per-season) and relies on `schema_era`
    (set per-row in load_players) so callers can tell which metrics are
    legitimately absent vs. simply not tracked yet in that era.
    """
    frames = [load_players("vaastav", season) for season in seasons]
    return pd.concat(frames, ignore_index=True, sort=False)


def cross_source_join(fpl_core_df: pd.DataFrame, vaastav_df: pd.DataFrame) -> pd.DataFrame:
    """Join fpl-core and vaastav player rows for the same season.

    Prefers `code` (fpl-core: player_code, vaastav: code) — the one
    identifier both sources treat as a stable, cross-season player key.
    Falls back to (first_name, second_name) for rows `code` fails to
    match, since the two sources are not guaranteed to assign the same
    id or even the same code for a given real-world player. Unmatched
    rows are logged, not silently dropped.
    """
    fpl_core_df = fpl_core_df.reset_index(drop=True)
    vaastav_df = vaastav_df.reset_index(drop=True)

    merged = fpl_core_df.merge(
        vaastav_df,
        on="code",
        how="outer",
        suffixes=("_fplcore", "_vaastav"),
        indicator=True,
    )
    matched_by_code = merged[merged["_merge"] == "both"].drop(columns=["_merge"])

    unmatched_fplcore = fpl_core_df[~fpl_core_df["code"].isin(vaastav_df["code"])]
    unmatched_vaastav = vaastav_df[~vaastav_df["code"].isin(fpl_core_df["code"])]

    matched_by_name = unmatched_fplcore.merge(
        unmatched_vaastav,
        on=["first_name", "second_name"],
        how="inner",
        suffixes=("_fplcore", "_vaastav"),
    )

    name_keys = set(zip(matched_by_name["first_name"], matched_by_name["second_name"]))
    still_unmatched_fplcore = unmatched_fplcore[
        [(fn, sn) not in name_keys for fn, sn in zip(unmatched_fplcore["first_name"], unmatched_fplcore["second_name"])]
    ]
    still_unmatched_vaastav = unmatched_vaastav[
        [(fn, sn) not in name_keys for fn, sn in zip(unmatched_vaastav["first_name"], unmatched_vaastav["second_name"])]
    ]

    print(
        f"cross_source_join: {len(matched_by_code)} matched on `code`, "
        f"{len(matched_by_name)} recovered by (first_name, second_name), "
        f"{len(still_unmatched_fplcore)} fpl-core rows and "
        f"{len(still_unmatched_vaastav)} vaastav rows still unmatched"
    )

    return pd.concat([matched_by_code, matched_by_name], ignore_index=True, sort=False)


def available(df: pd.DataFrame) -> pd.DataFrame:
    """Drop players who have left the league or carry a zero/unknown price."""
    return df[(df["status"] != "u") & (df["now_cost"] != 0)]
