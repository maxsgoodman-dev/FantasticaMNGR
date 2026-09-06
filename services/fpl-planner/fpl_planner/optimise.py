"""Squad/XI optimiser — reconstructed from the ingestion brief's §5 spec.

No source file for the original optimiser survived; it was written as
inline heredocs in a chat session and never saved. This is a from-scratch
rebuild of that spec using PuLP + CBC, not a port of working code.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import pandas as pd
import pulp

from fpl_planner.config import DEFAULT_RISK_DISCOUNTS, ManagerRules, RiskDiscountRule, default_manager_rules
from fpl_planner.loaders import available, load_players


@dataclass
class OptimiseResult:
    status: str
    squad_codes: list[str]
    xi_codes: list[str]
    captain_code: str | None
    total_cost: float
    objective_value: float


def apply_risk_discount(df: pd.DataFrame, rules: list[RiskDiscountRule] = DEFAULT_RISK_DISCOUNTS) -> pd.Series:
    """Multiply `total_points` down for players who are unlikely to deliver it.

    When multiple rules match, the harshest (lowest) multiplier applies.
    """

    def discount_for(row: pd.Series) -> float:
        matches = [rule.multiplier for rule in rules if rule.applies(row)]
        return min(matches) if matches else 1.0

    return df.apply(discount_for, axis=1)


def build_candidate_pool(df: pd.DataFrame, rules: ManagerRules) -> pd.DataFrame:
    """Cut the full player set down to a tractable, inspectable pool.

    Rule (explicit, not a hand-typed list): every locked player is kept
    unconditionally; every other player is ranked by adjusted points
    within their own position and the top slice is kept, sized
    proportionally to how many of that position a 15-man squad needs
    (2 GKP : 5 DEF : 5 MID : 3 FWD) scaled up to `candidate_pool_size`.
    """
    squad_counts = rules.squad_position_counts
    total_squad_slots = sum(squad_counts.values())
    scale = rules.candidate_pool_size / total_squad_slots

    locked = df[df["code"].isin(rules.locked_codes)]
    rest = df[~df["code"].isin(rules.locked_codes)]

    kept = [locked]
    for position, count in squad_counts.items():
        per_position_limit = max(int(round(count * scale)), count)
        position_rows = rest[rest["position"] == position].sort_values(
            "adjusted_points", ascending=False
        )
        kept.append(position_rows.head(per_position_limit))

    pool = pd.concat(kept, ignore_index=True).drop_duplicates(subset="code")
    return pool


def optimise_squad(df: pd.DataFrame, rules: ManagerRules) -> OptimiseResult:
    df = available(df).copy()
    df["adjusted_points"] = df["total_points"] * apply_risk_discount(df)

    pool = build_candidate_pool(df, rules)
    pool = pool.set_index("code", drop=False)
    codes = list(pool.index)

    missing_locks = set(rules.locked_codes) - set(codes)
    if missing_locks:
        raise ValueError(f"locked codes not in candidate pool or player data: {missing_locks}")

    prob = pulp.LpProblem("fpl_squad_optimisation", pulp.LpMaximize)

    squad_vars = pulp.LpVariable.dicts("squad", codes, cat="Binary")
    xi_vars = pulp.LpVariable.dicts("xi", codes, cat="Binary")
    cap_vars = pulp.LpVariable.dicts("cap", codes, cat="Binary")

    points = pool["adjusted_points"].to_dict()
    cost = pool["price"].to_dict()
    position = pool["position"].to_dict()
    team = pool["team"].to_dict()

    prob += (
        pulp.lpSum(xi_vars[c] * points[c] for c in codes)
        + pulp.lpSum(cap_vars[c] * points[c] for c in codes)
        + rules.bench_points_weight
        * pulp.lpSum((squad_vars[c] - xi_vars[c]) * points[c] for c in codes)
    )

    # Linking constraints.
    for c in codes:
        prob += xi_vars[c] <= squad_vars[c]
        prob += cap_vars[c] <= xi_vars[c]

    # Squad constraints.
    prob += pulp.lpSum(squad_vars[c] for c in codes) == rules.squad_size
    prob += pulp.lpSum(squad_vars[c] * cost[c] for c in codes) <= rules.budget

    for pos, required in rules.squad_position_counts.items():
        prob += pulp.lpSum(squad_vars[c] for c in codes if position[c] == pos) == required

    for club in set(team.values()):
        club_codes = [c for c in codes if team[c] == club]
        prob += pulp.lpSum(squad_vars[c] for c in club_codes) <= rules.max_per_club

        if rules.no_two_same_club_per_position_group:
            for pos in ("DEF", "MID", "FWD"):
                group_codes = [c for c in club_codes if position[c] == pos]
                if group_codes:
                    prob += pulp.lpSum(squad_vars[c] for c in group_codes) <= 1

    # XI constraints.
    prob += pulp.lpSum(xi_vars[c] for c in codes) == rules.starting_xi_size
    prob += pulp.lpSum(cap_vars[c] for c in codes) == 1

    def xi_position_sum(pos: str):
        return pulp.lpSum(xi_vars[c] for c in codes if position[c] == pos)

    gkp_min, gkp_max = rules.xi_gkp
    def_min, def_max = rules.xi_def
    mid_min, mid_max = rules.xi_mid
    fwd_min, fwd_max = rules.xi_fwd

    prob += xi_position_sum("GKP") >= gkp_min
    prob += xi_position_sum("GKP") <= gkp_max
    prob += xi_position_sum("DEF") >= def_min
    prob += xi_position_sum("DEF") <= def_max
    prob += xi_position_sum("MID") >= mid_min
    prob += xi_position_sum("MID") <= mid_max
    prob += xi_position_sum("FWD") >= fwd_min
    prob += xi_position_sum("FWD") <= fwd_max

    # Forced inclusion/exclusion — the mechanism the iterative
    # manager-in-the-loop workflow runs on.
    for code in rules.locked_codes:
        prob += squad_vars[code] == 1
    for code in rules.excluded_codes:
        if code in codes:
            prob += squad_vars[code] == 0
    if rules.captain_code:
        prob += cap_vars[rules.captain_code] == 1

    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    squad_codes = [c for c in codes if squad_vars[c].value() == 1]
    xi_codes = [c for c in codes if xi_vars[c].value() == 1]
    captain_codes = [c for c in codes if cap_vars[c].value() == 1]

    return OptimiseResult(
        status=pulp.LpStatus[prob.status],
        squad_codes=squad_codes,
        xi_codes=xi_codes,
        captain_code=captain_codes[0] if captain_codes else None,
        total_cost=sum(cost[c] for c in squad_codes),
        objective_value=pulp.value(prob.objective),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimise an FPL squad and starting XI.")
    parser.add_argument("--source", default="vaastav", choices=["vaastav", "fpl-core"])
    parser.add_argument("--season", default="2026-27")
    parser.add_argument("--budget", type=float, default=None)
    parser.add_argument("--pool-size", type=int, default=None)
    parser.add_argument("--allow-lone-striker", action="store_true")
    parser.add_argument("--lock", action="append", default=[], help="player `code` to force into the squad")
    parser.add_argument("--exclude", action="append", default=[], help="player `code` to force out of the squad")
    parser.add_argument("--captain", default=None, help="player `code` to force as captain")
    parser.add_argument("--use-defaults", action="store_true", help="start from the manager's current agreed rules")
    args = parser.parse_args()

    rules = default_manager_rules() if args.use_defaults else ManagerRules()
    if args.budget is not None:
        rules.budget = args.budget
    if args.pool_size is not None:
        rules.candidate_pool_size = args.pool_size
    rules.allow_lone_striker = args.allow_lone_striker
    rules.locked_codes = list(dict.fromkeys(rules.locked_codes + args.lock))
    rules.excluded_codes = list(dict.fromkeys(rules.excluded_codes + args.exclude))
    if args.captain:
        rules.captain_code = args.captain

    df = load_players(args.source, args.season)
    result = optimise_squad(df, rules)

    names = df.set_index("code")["web_name"]
    print(f"status: {result.status}")
    print(f"total cost: £{result.total_cost:.1f}m / £{rules.budget:.1f}m")
    print(f"objective: {result.objective_value:.1f}")
    print(f"captain: {names.get(result.captain_code, result.captain_code)}")
    print("squad:")
    for code in result.squad_codes:
        marker = "XI" if code in result.xi_codes else "bench"
        print(f"  {names.get(code, code):20s} {marker}")


if __name__ == "__main__":
    main()
