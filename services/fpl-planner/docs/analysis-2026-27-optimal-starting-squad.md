# Analysis: 2026-27 optimal starting squad

> **Note on provenance:** this reconstructs
> `claude_analysis_2026-27-optimal-starting-squad.md` from the "FPL
> Manager" Claude Project. The original chat that produced the first-pass
> optimiser output (`a6314dcd-5207-423f-93d9-5c0e1f1f4467`, "Optimal FPL
> team for upcoming season") ran the optimiser as inline `python3 <<
> 'EOF'` heredocs — it was never saved as a file, so there is no source
> to port, only this spec to rebuild from. The rebuild lives at
> `fpl_planner/optimise.py` and `fpl_planner/config.py`. **The specific
> squad and point totals below are from re-running that rebuild against
> this ingest's live 2026-27 data (2026-09-06, ~3 gameweeks in) — they
> are not the original chat's numbers**, which were computed against an
> August preseason snapshot and are lost.

## Methodology

Decision variables (binary, keyed on player `code`): `squad_vars` (in the
15), `xi_vars` (in the starting XI), `cap_vars` (captain).

**Objective:** maximise
`Σ xi·adj_points + Σ cap·adj_points + 0.03 · Σ bench·adj_points`
— captaincy modelled as a double-count; the small bench coefficient
stops bench slots being filled arbitrarily while still valuing bench
quality.

**Linking:** `xi ≤ squad`, `cap ≤ xi`.

**Squad:** 15 total — 2 GKP / 5 DEF / 5 MID / 3 FWD; `Σ cost ≤ £100.0m`;
max 3 per club.

**XI:** `Σ xi == 11`, `Σ cap == 1`; GKP `== 1`; DEF `3-5`; MID `2-5`;
FWD `2-3` by default. The FWD floor is a manager override, not a model
result — see "Known model gaps" below — and is a config flag
(`ManagerRules.allow_lone_striker`), not a hardcoded constraint.

**Risk discount** applied to `total_points` before optimising (harshest
matching rule wins when several apply — see `fpl_planner/config.py`,
`DEFAULT_RISK_DISCOUNTS`):

| Condition | Multiplier |
|---|---|
| `news` contains "unknown return date" | 0.15 |
| `chance_of_playing_next_round == 0` | 0.15 |
| Injured/suspended, ≥50% chance next round (approximates "return before ~GW1" — see note below) | 0.70 |
| `chance_of_playing_next_round == 75` | 0.85 |
| `minutes < 500` last season | 0.50 |

The 0.70 rule is an approximation. The original spec's condition —
"injury with return date before ~GW1" — needs a parsed return date
compared against a fixture calendar. `news` is free text ("Ankle injury -
Expected back 12 Sep") with no reliably parseable date, and this repo has
no fixture calendar yet (see "Fixture difficulty" below). Treat this row
as a placeholder until a fixture list exists to make it exact.

**Forced inclusion/exclusion** (`ManagerRules.locked_codes` /
`excluded_codes`) is the mechanism the whole iterative workflow runs on:
the manager names players, the solver re-runs. Exposed via the CLI
(`python -m fpl_planner.optimise --lock CODE --exclude CODE`), not a code
edit.

**Candidate pool:** the original run pre-filtered ~570 players to a
curated ~260 to keep the LP tractable. Reproduced here as an explicit
rule (`build_candidate_pool` in `optimise.py`): every locked player is
kept unconditionally; the rest are ranked by adjusted points within their
own position, keeping the top slice sized proportionally to how many of
that position a 15-man squad needs, scaled up to
`ManagerRules.candidate_pool_size` (default 260).

## This rebuild's output (2026-09-06 data, default manager rules)

| Position | Players |
|---|---|
| GKP | Tzolakis, Trafford |
| DEF | Calafiori, Shaw, Senesi, De Cuyper, Mendy |
| MID | Gakpo, Anderson, Mbeumo, Hinshelwood, M.Sangaré |
| FWD | João Pedro, Isak, Haaland (C) |

Total cost: £99.3m / £100.0m. Solver status: Optimal.

This is **not** the manager's actual current squad (see below) — it's
what the rebuilt LP alone produces from this ingest's data under the
locks/excludes in `default_manager_rules()`. The gap between the two is
exactly the point: the LP is a starting point the manager overrides, not
a final answer.

## Current agreed squad (superseding the LP output above)

Per the ingestion brief, £100.0m exactly:

- **GK:** Kelleher, Dubravka
- **DEF:** Calafiori, Shaw, Senesi, Thiaw, O'Brien
- **MID:** Ndiaye, Mbeumo, Gakpo, Anderson, Caicedo
- **FWD:** João Pedro, Haaland (C), Isak

Locked: Calafiori, Shaw, Senesi, Mbeumo, Gakpo, Anderson, Haaland, Isak,
João Pedro. Excluded: Van Dijk, Guéhi, Zubimendi, Gusto, Tarkowski, Rice
(World Cup). These are the defaults in `config.default_manager_rules()`.

This squad differs from both the original first-pass LP output (lost,
per the provenance note above) and this rebuild's LP output above — it
reflects many rounds of manual manager direction after the original
first pass, and should be treated as historical record of a decision,
not as something the optimiser is expected to reproduce exactly. GKP and
some MID/DEF slots (Kelleher/Dubravka, Thiaw, O'Brien, Ndiaye, Caicedo)
are manager picks the LP was never asked to reproduce; only the 9 locked
+ 6 excluded codes are encoded as config.

## Manager decision rules carried over (encoded as config, not comments)

See `fpl_planner/config.py`, `ManagerRules`:

- Budget is a hard £100.0m. No overruns.
- Haaland is locked as captain.
- No two players from the same club within the same positional group
  (DEF/MID/FWD) — stricter than FPL's own max-3-per-club, additional to
  it. Cross-group duplication (e.g. one DEF + one MID from the same
  club) is fine.
- Value-focused defence: prefer cheap defenders with attacking-return
  potential over premium names. **Soft/advisory only** — not mechanically
  enforced by the LP (no per-defender attacking-return metric is wired
  in yet); recorded in `ManagerRules` so it isn't lost as tribal
  knowledge.
- Bench must be nailed starters at their clubs, not lottery tickets.
  Soft/advisory only, same reason.
- Decisions weigh underlying xGI **and** fixture difficulty, not raw
  points. Fixture difficulty specifically is blocked — see below.

## Known model gaps (all still open)

- No fixture-difficulty term in the objective (see below).
- No price-rise timing.
- No preseason-form modelling.
- No adaptation curve for new signings.
- Unlike the original August preseason snapshot, `total_points` in this
  ingest (2026-09-06) reflects real 2026-27 GW1-3 results, not a
  last-season proxy — the brief's original caveat about `total_points`
  being "last season as a proxy for this one" no longer applies to this
  specific ingest, but will apply again at the start of every future
  season until enough of that season's games have been played.

## Fixture difficulty — known blocker

No automated source exists in this project.

- `fplcopilot.com/fdr` cannot be scraped — it returns a JavaScript shell,
  no fixture data without a rendered browser.
- Alternatives previously used: Premier League official ratings,
  RotoWire (both manual, screenshot-driven).
- **Available offline right now**: `teams.csv`'s `strength_attack_*` /
  `strength_defence_*` / `strength_overall_*` columns (both sources),
  plus `elo` in fpl-core's `teams.csv`. A home/away-aware difficulty
  score can be derived from these without scraping anything — this is
  the natural next build, not currently implemented.
- **Not in this repo**: a fixture list. vaastav publishes
  `fixtures.csv` per season; it was not pulled in this ingest. Pulling it
  is the single highest-value remaining gap — everything else needed for
  a fixture-difficulty score is already ingested.

If live FDR becomes a requirement, budget for a headless-browser fetch or
an official-API fixture pull; do not plan around scraping fplcopilot.
