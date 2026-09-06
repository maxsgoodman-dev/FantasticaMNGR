from fpl_planner.loaders import (
    available,
    cross_source_join,
    load_players,
    resolve_team,
    unify_seasons,
)


def test_load_players_vaastav_normalizes_position_and_price():
    df = load_players("vaastav", "2026-27")

    assert set(df["position"].unique()) <= {"GKP", "DEF", "MID", "FWD"}
    # now_cost is in tenths of a £m upstream; price must be divided down.
    sample = df.iloc[0]
    assert sample["price"] == sample["now_cost"] / 10
    # code must be usable as a stable key, not the season-scoped id.
    assert df.index.name == "code"
    assert df["code"].is_unique


def test_load_players_fpl_core_price_is_not_divided_by_ten():
    df = load_players("fpl-core", "2026-2027")

    assert set(df["position"].unique()) <= {"GKP", "DEF", "MID", "FWD", "UNK"}
    # fpl-core's now_cost is already in £m, unlike vaastav's tenths-of-a-£m.
    sample = df[df["now_cost"].notna()].iloc[0]
    assert sample["price"] == sample["now_cost"]


def test_load_players_fpl_core_latest_only_returns_one_row_per_player():
    df = load_players("fpl-core", "2026-2027", latest_only=True)

    assert df["player_id"].is_unique


def test_resolve_team_via_master_team_list():
    assert resolve_team("2016-17", 1) == "Arsenal"


def test_resolve_team_falls_back_to_season_teams_csv():
    # master_team_list.csv upstream stops at 2023-24; 2026-27 must resolve
    # via that season's own teams.csv instead.
    assert resolve_team("2026-27", 15) == "Man City"


def test_unify_seasons_assigns_schema_era():
    df = unify_seasons(["2019-20", "2022-23", "2025-26"])

    eras = dict(zip(df["season"], df["schema_era"]))
    assert eras["2019-20"] == "pre_xg"
    assert eras["2022-23"] == "xg"
    assert eras["2025-26"] == "xg_defensive_contribution"


def test_unify_seasons_null_fills_missing_columns():
    df = unify_seasons(["2019-20", "2025-26"])

    # expected_goals doesn't exist in 2019-20's raw schema.
    pre_xg_rows = df[df["season"] == "2019-20"]
    assert pre_xg_rows["expected_goals"].isna().all()


def test_cross_source_join_matches_on_code():
    fpl_core = load_players("fpl-core", "2026-2027")
    vaastav = load_players("vaastav", "2026-27")

    joined = cross_source_join(fpl_core, vaastav)

    # every vaastav row should find its fpl-core counterpart via `code`.
    assert len(joined) >= len(vaastav) * 0.9


def test_available_drops_departed_and_zero_priced_players():
    df = load_players("vaastav", "2026-27")

    result = available(df)

    assert (result["status"] != "u").all()
    assert (result["now_cost"] != 0).all()
    assert len(result) < len(df)
