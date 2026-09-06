# Data source: vaastav/Fantasy-Premier-League

> **Note on provenance:** this doc reconstructs the original
> `claude_data-sources_vaastav-fpl-history.md` from the "FPL Manager"
> Claude Project — original work not reachable from this environment (see
> the same note in `data-sources-fpl-core-insights.md`). Rebuilt from the
> ingestion brief and cross-checked against the actual ingested CSVs.
> Reconcile against the original if it's ever exported.

## What this source is

[`vaastav/Fantasy-Premier-League`](https://github.com/vaastav/Fantasy-Premier-League)
— the canonical open FPL historical dataset, 2016-17 onward. Column set
trimmed from the upstream ~50-110 raw columns (it grows every season —
see below) to the subset that's actually useful for squad selection;
ranks, set-piece order/text pairs, photo/opta housekeeping fields were
considered for dropping but were, in the end, ingested in full per
season since the upstream file is small enough not to bother trimming.

Ingested into `data/vaastav-fpl-history/<season>/` (season format
`2026-27`, no century prefix on the second year — different from
fpl-core's `2026-2027`).

## Files

| Pattern | Seasons | Rows (as ingested) |
|---|---|---|
| `{season}/players_raw.csv` | 2016-17 → 2026-27 (11 seasons) | 616-865 depending on season |
| `{season}/teams.csv` | 2019-20 → 2026-27 (8 seasons; not published earlier) | 20 each |
| `master_team_list.csv` | **2016-17 → 2023-24 only** | 160 — `season, team, team_name` |

## Corrected discrepancy: `master_team_list.csv` does not cover all seasons

The original doc (per the brief) describes `master_team_list.csv` as
covering "all" seasons. **As ingested, it does not** — it stops at
2023-24 and was never extended for 2024-25, 2025-26, or 2026-27, even
though those seasons' `players_raw.csv`/`teams.csv` exist and are current.
`fpl_planner.loaders.resolve_team(season, team_id)` handles this: it
tries `master_team_list.csv` first, and falls back to that season's own
`teams.csv` (`id` → `name`) when the season isn't in the master list.
Coverage is complete either way, since the two files' season ranges
overlap-and-cover: `master_team_list.csv` covers the three earliest
seasons that lack a `teams.csv`, and each season from 2019-20 has its own
`teams.csv`.

## `players_raw.csv` schema grows over time — do not assume a stable schema

Column count by season, as ingested: 2016-17 = 57, 2019-20 = 61,
2020-21 = 67, 2022-23 = 88, 2024-25 = 103, 2025-26 = 105, 2026-27 = 109.

**Corrected discrepancy**: the brief guessed xG/xA arrive "~2020-21" and
`defensive_contribution`/tackles/CBI/recoveries arrive "from 2025-26".
Checked against actual headers:

- `expected_goals` (and xA/xGI) actually first appears in **2022-23**, not
  2020-21.
- `defensive_contribution`/`tackles`/`clearances_blocks_interceptions`/
  `recoveries` first appear in **2025-26**, matching the brief.

`fpl_planner.loaders.unify_seasons()` assigns a `schema_era` per row —
`"pre_xg"`, `"xg"`, or `"xg_defensive_contribution"` — using these
corrected boundaries, not the brief's originals.

2026-27's `players_raw.csv` columns (109 total) include, among others:
`id, code, first_name, second_name, web_name, team, team_code,
element_type, status, now_cost, cost_change_start, total_points,
event_points, points_per_game, minutes, starts, goals_scored, assists,
clean_sheets, goals_conceded, own_goals, penalties_saved,
penalties_missed, yellow_cards, red_cards, saves, bonus, bps, influence,
creativity, threat, ict_index, expected_goals, expected_assists,
expected_goal_involvements, expected_goals_conceded,
selected_by_percent, transfers_in, transfers_out, value_season, form,
chance_of_playing_next_round, news, defensive_contribution, tackles,
clearances_blocks_interceptions, recoveries`.

`teams.csv` carries `strength_overall_home/away`,
`strength_attack_home/away`, `strength_defence_home/away`, plus
final-table `played/won/drawn/lost/points/position` for completed
seasons — fixture-difficulty raw material (see the analysis doc's
fixture-difficulty section).

## Cross-source join guidance

Prefer `code` (vaastav) / `player_code` (fpl-core) — the one identifier
both sources treat as stable across seasons. `id` (vaastav) /
`player_id` (fpl-core) is season-scoped and will collide across seasons
if used as a cross-season key. When `code` fails to match (confirmed:
~37 fpl-core rows per season currently have no vaastav `code` match),
fall back to `(first_name, second_name)`. `fpl_planner.loaders.
cross_source_join()` implements exactly this, and logs match/no-match
counts rather than silently dropping unmatched rows.

## Other repos reviewed and rejected (per the original project's research)

- `Torvaney/fpl-optimiser` — code only, no data; potentially useful as an
  LP methodology reference, not a data source.
- `saheedniyi02/fpl-ai` — redundant re-derived data plus stale 2023-24
  predictions.
- `antoniaelek/fantasy-premier-league` — a Jekyll site built over
  vaastav's own data; no unique dataset of its own.

## Not pulled (deliberately, for storage)

- `fixtures.csv` per season — the single highest-value missing file; see
  the analysis doc's fixture-difficulty section.
- `gws/` and `players/` — true gameweek-by-gameweek history (this ingest
  only pulled the season-level `players_raw.csv`).
- `understat/` — shot-level xG per player, ~13MB/season.
