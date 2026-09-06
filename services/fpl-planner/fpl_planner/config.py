"""Config surface for the optimiser: manager rules and risk discounts.

Everything a manager might want to change between runs — budget, locks,
exclusions, the FWD floor — lives here as data, not as edits to
optimise.py. See docs/analysis-2026-27-optimal-starting-squad.md for
where the defaults below come from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd


@dataclass(frozen=True)
class RiskDiscountRule:
    label: str
    multiplier: float
    applies: Callable[[pd.Series], bool]


# Applied to `total_points` before optimising. When more than one rule
# matches a player, the harshest (lowest) multiplier wins — risk doesn't
# average out, it compounds toward "don't rely on this player".
#
# Rule 3 ("injury with return date before ~GW1") can't be evaluated
# precisely: `news` is free text ("Ankle injury - Expected back 12 Sep")
# with no reliable, parseable return date, and there's no fixture
# calendar in this repo yet (see docs/analysis-*.md, fixture-difficulty
# gap). It's approximated here as "not ruled out, and not written off
# entirely" for an injured/suspended player — status i/s with at least a
# 50% next-round chance.
DEFAULT_RISK_DISCOUNTS: list[RiskDiscountRule] = [
    RiskDiscountRule(
        "unknown return date",
        0.15,
        lambda p: "unknown return date" in str(p.get("news", "")).lower(),
    ),
    RiskDiscountRule(
        "ruled out next round",
        0.15,
        lambda p: p.get("chance_of_playing_next_round") == 0,
    ),
    RiskDiscountRule(
        "injury/suspension, likely back soon (approximate)",
        0.70,
        lambda p: p.get("status") in ("i", "s")
        and p.get("chance_of_playing_next_round") is not None
        and pd.notna(p.get("chance_of_playing_next_round"))
        and p.get("chance_of_playing_next_round") >= 50,
    ),
    RiskDiscountRule(
        "75% chance of playing",
        0.85,
        lambda p: p.get("chance_of_playing_next_round") == 75,
    ),
    RiskDiscountRule(
        "unproven — under 500 minutes",
        0.50,
        lambda p: pd.notna(p.get("minutes")) and p.get("minutes", 0) < 500,
    ),
]


@dataclass
class ManagerRules:
    """The hard constraints the LP enforces, plus locks/excludes."""

    budget: float = 100.0
    squad_size: int = 15
    squad_position_counts: dict[str, int] = field(
        default_factory=lambda: {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}
    )
    max_per_club: int = 3
    # Stricter than max_per_club: at most one player per club within each
    # of DEF/MID/FWD (cross-group duplication, e.g. one DEF + one MID
    # from the same club, is fine). Does not apply to GKP.
    no_two_same_club_per_position_group: bool = True

    starting_xi_size: int = 11
    xi_gkp: tuple[int, int] = (1, 1)
    xi_def: tuple[int, int] = (3, 5)
    xi_mid: tuple[int, int] = (2, 5)
    # The lone-striker floor: a bare FWD >= 1 XI scored ~7 points higher
    # in the raw model but was rejected as too fragile to rotation/injury
    # on a single striker. Keep it a flag, not a hardcode.
    allow_lone_striker: bool = False

    bench_points_weight: float = 0.03

    locked_codes: list[str] = field(default_factory=list)
    excluded_codes: list[str] = field(default_factory=list)
    captain_code: str | None = None

    candidate_pool_size: int = 260

    # Soft/advisory rules the LP does not (and currently cannot)
    # mechanically enforce, because they need data this repo doesn't
    # have yet (see docs/analysis-*.md — fixture-difficulty gap).
    # Recorded here so they're visible in config, not lost as tribal
    # knowledge: prefer cheap defenders with attacking upside over
    # premium names; bench players should be nailed starters at their
    # clubs, not lottery tickets; fixture difficulty and underlying xGI
    # should outweigh raw points once available.
    fixture_difficulty_enabled: bool = False

    @property
    def xi_fwd(self) -> tuple[int, int]:
        return (1, 3) if self.allow_lone_striker else (2, 3)


def default_manager_rules() -> ManagerRules:
    """The manager's currently agreed rules (see §6 of the ingestion brief).

    Codes below are `code` values in the 2026-27 vaastav player data,
    resolved by name at ingest time — see
    docs/analysis-2026-27-optimal-starting-squad.md.
    """
    return ManagerRules(
        locked_codes=[
            "466075",  # Calafiori
            "106760",  # Shaw
            "221466",  # Senesi
            "446008",  # Mbeumo
            "243298",  # Gakpo
            "215379",  # Anderson
            "223094",  # Haaland
            "219168",  # Isak
            "475168",  # João Pedro
        ],
        excluded_codes=[
            "97032",  # Van Dijk
            "209036",  # Guéhi
            "481655",  # Zubimendi
            "482609",  # Gusto
            "17761",  # Tarkowski
            "204480",  # Rice (World Cup)
        ],
        captain_code="223094",  # Haaland, locked as captain
    )
