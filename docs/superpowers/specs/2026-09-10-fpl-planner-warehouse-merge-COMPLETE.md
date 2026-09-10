# FPL-Planner Warehouse Merge — Completion Note

Backfill executed against the `wsmegxfnmkhaailxhuih` Supabase project on
2026-09-10, per
`docs/superpowers/plans/2026-09-10-fpl-planner-warehouse-merge-plan.md`.

## Result

- Table: `public.fpl_player_season_stats` (migration
  `supabase/migrations/0003_fpl_player_season_stats.sql`, applied via
  `mcp__supabase__apply_migration`).
- Season backfilled: `2026-27` only (vaastav format), from
  `services/fpl-planner/data/vaastav-fpl-history/2026-27/players_raw.csv`.
- Row count: **616**, matching `wc -l players_raw.csv` minus the header
  row exactly.
- Mechanism: a local, uncommitted Python script (using
  `fpl_planner.loaders.load_players("vaastav", "2026-27")` and
  `fpl_planner.loaders.resolve_team` for normalization) generated 7
  batched `INSERT` statements (~100 rows each), each run through
  `mcp__supabase__execute_sql`. No service role key or new sync script
  was used.

## Spot-checks against the source CSV

| player_code | web_name | team_name | position | price | total_points | minutes |
|---|---|---|---|---|---|---|
| 223094 | Haaland | Man City | FWD | 15.5 | 2 | 90 |
| 219168 | Isak | Liverpool | FWD | 9.0 | 2 | 90 |
| 154561 | Raya | Arsenal | GKP | 6.0 | 6 | 90 |
| 106760 | Shaw | Man Utd | DEF | 4.5 | 1 | 90 |
| 446008 | Mbeumo | Man Utd | MID | 8.0 | 2 | 90 |

All five match `players_raw.csv` exactly (price already ÷10 from raw
`now_cost`, matching `fpl_planner/loaders.py`'s own convention).
`223094`, `106760`, and `446008` are three of the locked codes in
`fpl_planner/config.py::default_manager_rules()`, so this also confirms
the table's identity (`player_code`) lines up with what the optimiser
already treats as canonical.

A correctness bug was caught and fixed mid-backfill: `news` is a
`not null default ''` column, but pandas parses an empty CSV cell as
`NaN`, which the initial version of the generator script mapped to SQL
`null` instead of `''`. Fixed before running any batch against the live
table (verified via `grep` on the generated SQL — 0 occurrences of the
bug pattern in the final output, vs. 493 before the fix).

## RLS verification

```sql
set role anon;
select player_code, web_name, team_name, price
from public.fpl_player_season_stats
limit 3;
reset role;
```

Returned 3 real rows (`Raya`/Arsenal/6.0, `Arrizabalaga`/Arsenal/5.0,
`Meslier`/Arsenal/5.0) — confirms the public `SELECT` policy from the
migration works as intended for the anon role, matching how
`0002_player_consistency_view.sql`'s `security_invoker` was verified in
this same project.

`mcp__supabase__get_advisors` (security) returned zero lints after the
migration + backfill.

## Test suite

`services/fpl-planner`'s existing 13 tests all pass unmodified (fresh
venv, `pip install -e . pytest`, `pytest -q`) — nothing in `loaders.py`,
`config.py`, or `optimise.py` was touched by this slice.

## Judgment calls made (flagged for reviewer)

1. **vaastav-only for this slice, not a merged vaastav+fpl-core row.**
   See the design doc's "Not merging fpl-core-insights in this slice"
   section — `cross_source_join()`'s code/name-fallback matching (with
   ~37 unmatched fpl-core rows per season) was judged too much to safely
   reproduce in a one-off SQL backfill.
2. **`unique(season, player_code)` only** — no `source` in the
   uniqueness constraint, since only one source is loaded. Flagged as a
   design decision a future multi-source slice needs to revisit.
3. **Column curation** — 45 columns chosen out of vaastav's ~109 raw
   columns, based on what `fpl_planner/config.py`'s risk-discount rules
   and the optimiser's known methodology actually use, not a 1:1 mirror
   of the CSV.
4. **Migration numbered `0003`** — my worktree branched before
   `0002_player_consistency_view.sql` landed on `main` (confirmed via
   `git show main:supabase/migrations/`), so `0003` avoids a collision
   at merge time even though this worktree's own branch only had `0001`
   when I started.
