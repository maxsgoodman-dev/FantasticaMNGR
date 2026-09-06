# Data source: FPL Core Insights

> **Note on provenance:** this doc reconstructs the original
> `claude_data-sources_fpl-core-insights.md` from the "FPL Manager" Claude
> Project. That file is original work that lived only in that project's
> knowledge base — it was not reachable from this environment (no
> filesystem/API path into another Claude Project's knowledge, and it
> wasn't found in this account's Google Drive either). This version is
> rebuilt from the ingestion brief's own description of the file, cross-
> checked against the actual ingested CSVs where possible. Reconcile
> against the original if it's ever exported.

## What this source is

[`olbauday/FPL-Core-Insights`](https://github.com/olbauday/FPL-Core-Insights)
(powers fplcore.com) — the official FPL API plus curated match stats and
ClubElo ratings. Upstream refreshes twice daily.

Ingested into `data/fpl-core-insights/<season>/` (season format
`2026-2027`, with a hyphen-free 4-digit-year pair — different from
vaastav's `2026-27`; preserved as-is, normalized only in code).

## Files

**`2026-2027/` (current season)**

| File | What it is |
|---|---|
| `players.csv` | Identity only — `player_code, player_id, first_name, second_name, web_name, team_code, position`. **Does not** carry cost/status/ICT/xG fields, despite that being a reasonable assumption from the filename. |
| `playerstats.csv` | The real stats table. Joined to `players.csv` via `players.player_id` == `playerstats.id`. |
| `teams.csv` | `code, id, name, short_name, strength, strength_overall_home/away, strength_attack_home/away, strength_defence_home/away, pulse_id, elo, fotmob_name`. |
| `gameweek_summaries.csv` | Deadlines, average scores, chip plays, most captained, etc. |
| `team_history.csv` | `player_id, gw, team_code` — a player→club mapping per gameweek. Useful for detecting mid-season transfers; **not** an Elo table (current-season Elo lives in `teams.csv`'s `elo` column). |

**`2025-2026/` (last completed season)** — same files, plus
`playerstats_season_end_gw38.csv` in place of a full-season `playerstats.csv`:
we derived it in-repo by filtering the upstream `playerstats.csv` (which
upstream keeps at full gw-by-gw granularity, ~9.6MB) down to `gw == 38`
rows only, to match the original project's storage-saving choice of
keeping just the final cumulative snapshot. The full gw-by-gw file was
*not* re-ingested (see "Not pulled" below).

## `playerstats` key columns

`id`, `gw`, `total_points`, `event_points`, `minutes`, `starts`,
`goals_scored`, `assists`, `clean_sheets`, `bonus`, `bps`,
`expected_goals`, `expected_assists`, `expected_goal_involvements`,
`expected_goals_conceded` (+ `_per_90` variants), `ict_index`,
`influence`, `creativity`, `threat`, `now_cost`, `cost_change_start`,
`selected_by_percent`, `form`, `value_form`, `value_season`, `ep_next`,
`ep_this`, `status`, `chance_of_playing_next_round`, `news`,
`defensive_contribution`, `tackles`,
`clearances_blocks_interceptions`, `recoveries`, `penalties_order`,
`direct_freekicks_order`, `corners_and_indirect_freekicks_order`,
`set_piece_threat`.

## Verified discrepancies vs. the original doc's description

1. `players.csv` in 2026-2027 is identity-only (7 columns) — confirmed
   against the actual header. All stats live in `playerstats.csv`.
2. `team_history.csv` is `player_id, gw, team_code` — confirmed. Not an
   Elo/form history table.
3. At small-sample-size (preseason / very early season) `playerstats.csv`
   can have exactly one row per player, which looks like — but is not — a
   1:1 `players.csv` join. **Do not hardcode a 1:1 assumption**: as of this
   ingest (2026-09-06, ~3 gameweeks into 2026-27), `playerstats.csv` has
   multiple rows per player, confirming the loader's `latest_only`
   handling (see `fpl_planner/loaders.py`) is required, not optional.
4. **Units mismatch with vaastav, not previously documented**: this
   source's `now_cost` is already in £m (e.g. `5.5`), unlike vaastav's
   `now_cost`, which is in tenths of a £m (`155` = £15.5m). A loader that
   divides both by 10 will silently produce a squad worth a tenth of its
   real price for this source. `fpl_planner/loaders.py` handles this
   explicitly — see the comment in `_load_fpl_core_players`.

## Not pulled (deliberately, for storage)

- `By Gameweek/GW{x}/` and `By Tournament/{name}/GW{x}/` — point-in-time
  snapshots, match/player-match-level stats, preseason friendlies under
  GW0.
- Full 2025-26 `playerstats.csv` at true gw-by-gw granularity (~9.6MB);
  only the derived GW38 (season-end) snapshot was kept.

Pull these later if per-gameweek historical detail becomes necessary —
see `docs/analysis-2026-27-optimal-starting-squad.md`'s fixture-difficulty
section for why the fixture list is the higher-priority gap.
