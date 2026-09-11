# FPL-Planner Historical Backfill (Remaining 10 Seasons) — Completion Note

Follow-up to `2026-09-10-fpl-planner-warehouse-merge-design.md`, which
explicitly deferred all seasons except 2026-27 ("Out of scope:
Backfilling any season other than 2026-27... a follow-up slice would
re-run the same backfill mechanism per season"). This slice does exactly
that for the 10 remaining seasons: 2016-17 through 2025-26.

## Result

- Same table as the first slice: `public.fpl_player_season_stats`
  (migration `0005`, no schema change needed — the nullable xG/defensive
  columns and `schema_era` were already designed for exactly this).
- 10 seasons backfilled, 7,338 rows, from
  `services/fpl-planner/data/vaastav-fpl-history/{season}/players_raw.csv`
  for each season, via `fpl_planner.loaders.load_players("vaastav",
  season)` and `resolve_team(season, team_id)` — the same tested loader
  the first slice used, run once per season instead of hand-rolled per
  season.
- Combined with the existing 616-row 2026-27 slice: **7,954 rows across
  all 11 seasons** now in the warehouse.
- Row counts per season match `load_players(...)` output exactly after
  the one exclusion below (verified via `count(*) group by season`).

## One exclusion found and handled: FPL "Manager" rows in 2024-25

20 rows in the 2024-25 season have `element_type == 5` — this is FPL's
short-lived "Fantasy Manager" feature (real-world managers like Arteta,
Guardiola, Slot as a selectable fantasy position), not a real
GKP/DEF/MID/FWD player. `_load_vaastav_players` maps unknown
`element_type` values to `position = NaN`, which would violate this
table's `check (position in ('GKP','DEF','MID','FWD'))` constraint.
These 20 rows were excluded from the backfill (filtered on
`position.isin(['GKP','DEF','MID','FWD'])` before generating INSERT
statements) — no other season has this issue (checked via `element_type`
value counts across all 10 seasons).

## Backfill mechanism

Same spirit as the first slice (no new sync script, no service-role-key
path — this is a one-off historical load) but a different execution path
discovered during this session's earlier `fpl_sheet_player_data`
population: generated batched `insert ... on conflict (season,
player_code) do nothing` SQL (78 files, 100 rows each) via a local,
uncommitted Python script, then ran each file directly against the
linked project with `supabase db query -f <file> --linked` (Supabase
CLI, `supabase link --project-ref wsmegxfnmkhaailxhuih` run once first)
instead of pasting each batch's SQL through the conversation via the
`execute_sql` MCP tool. Same result, far cheaper for this much data.

**Bug caught mid-run, worth flagging for future use of this mechanism:**
the CLI's local link state (`supabase/.temp/project-ref`) went missing
partway through the run for reasons that weren't root-caused, and the
loop's error detection (`grep -qi '"error"'` on stdout) did not catch
the resulting plain-text failure ("Cannot find project ref..." — not
JSON, no literal `"error"`), so the loop reported success while most
batches silently no-opped. Caught by verifying row counts after the
"successful" run showed only 50 of 683 expected rows for 2016-17.
Re-linked (`supabase link` again) and re-ran with proper exit-code-based
error checking (`if ! supabase db query ...; then ...`), which is the
right way to gate this kind of loop — never grep stdout for a literal
string to detect failure.

## Spot-checks

- Ospina (2016-17, code 48844): now_cost 47 → price 4.7, total_points 2,
  minutes 143 — matches `players_raw.csv` exactly.
- Salah 2017-18: 303 total_points (his record-breaking season) —
  matches well-known real-world fact, `expected_goals` correctly `NULL`
  (pre_xg era).
- Haaland: absent from all seasons before 2022-23 (correct — he joined
  the Premier League in 2022-23), `expected_goals` populated from
  2022-23 onward, `defensive_contribution` `NULL` until 2025-26 (correct
  era boundary in both cases).
- Arteta: absent from 2024-25 results — confirms the Manager-row
  exclusion worked.

## RLS verification

`set role anon; select season, web_name from ... where web_name =
'Salah' order by season limit 3; reset role;` returned 3 real rows
across seasons — same pattern as the first slice's verification.

`mcp__supabase__get_advisors` (security): zero lints after the backfill.

## Test suite

`services/fpl-planner`'s 13 tests pass unmodified — nothing in
`loaders.py`, `config.py`, or `optimise.py` was touched.

## Still out of scope (unchanged from the first slice's design doc)

- Adding `fpl-core-insights` rows (the cross-source join question).
- Any change to `fpl_planner/optimise.py` or `apps/web` to read from
  this table — it remains a parallel, warehouse-backed path nothing
  downstream consumes yet.
- Any ongoing/scheduled sync of this table (still a one-off historical
  load; vaastav's repo is only re-cloned by hand per
  `services/fpl-planner/README.md`).
