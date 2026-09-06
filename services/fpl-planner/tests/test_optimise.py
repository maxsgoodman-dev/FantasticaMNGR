import pandas as pd

from fpl_planner.config import ManagerRules, default_manager_rules
from fpl_planner.loaders import load_players
from fpl_planner.optimise import apply_risk_discount, build_candidate_pool, optimise_squad


def test_apply_risk_discount_picks_harshest_matching_rule():
    df = pd.DataFrame(
        [
            # ruled out (0.15) AND unproven (0.50) -> harshest wins: 0.15
            {"news": "", "chance_of_playing_next_round": 0, "minutes": 100, "status": "a", "total_points": 10},
            # fit, proven -> no discount
            {"news": "", "chance_of_playing_next_round": None, "minutes": 2000, "status": "a", "total_points": 100},
        ]
    )

    discount = apply_risk_discount(df)

    assert discount.iloc[0] == 0.15
    assert discount.iloc[1] == 1.0


def test_build_candidate_pool_keeps_all_locked_players_even_if_low_scoring():
    df = pd.DataFrame(
        [
            {"code": "locked1", "position": "FWD", "adjusted_points": 0.0, "team": 1},
            *[
                {"code": f"filler{i}", "position": "FWD", "adjusted_points": 100.0 - i, "team": 2}
                for i in range(20)
            ],
        ]
    )
    rules = ManagerRules(locked_codes=["locked1"], candidate_pool_size=10)

    pool = build_candidate_pool(df, rules)

    assert "locked1" in set(pool["code"])


def test_optimise_squad_respects_all_hard_constraints():
    df = load_players("vaastav", "2026-27")
    rules = default_manager_rules()

    result = optimise_squad(df, rules)

    assert result.status == "Optimal"
    assert result.total_cost <= rules.budget + 1e-6
    assert len(result.squad_codes) == rules.squad_size
    assert len(result.xi_codes) == rules.starting_xi_size
    assert set(rules.locked_codes) <= set(result.squad_codes)
    assert not set(rules.excluded_codes) & set(result.squad_codes)
    assert result.captain_code == rules.captain_code

    pool = df.set_index("code", drop=False)
    squad = pool.loc[result.squad_codes]
    assert squad["position"].value_counts().to_dict() == rules.squad_position_counts

    for (_team, pos), group in squad.groupby(["team", "position"]):
        if pos != "GKP":
            assert len(group) <= 1, "no two same-club players within one position group"

    for _team, group in squad.groupby("team"):
        assert len(group) <= rules.max_per_club


def test_optimise_squad_allow_lone_striker_relaxes_fwd_floor():
    df = load_players("vaastav", "2026-27")
    rules = ManagerRules(allow_lone_striker=True)

    assert rules.xi_fwd == (1, 3)

    result = optimise_squad(df, rules)
    assert result.status == "Optimal"
