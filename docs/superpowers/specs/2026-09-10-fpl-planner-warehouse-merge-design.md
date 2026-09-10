# FPL-Planner → Warehouse Merge (First Slice) Design

## Goal

`docs/ARCHITECTURE.md` stage 4 lists merging `services/fpl-planner`'s
historical FPL CSV archive into the Supabase warehouse as an open item,
explicitly flagged as "real design work, not a rename" because the two
data shapes don't line up:

- The warehouse's `players` table is a **live, current-snapshot** catalog:
  one row per `(source_id, external_id)`, upserted on every sync — the row
  *is* the player's current state, with no history retained.
- `services/fpl-planner/data/` is a **season-by-season historical
  archive**: many rows per real-world player, one per season, where season
  is part of the row's identity, not something a sync overwrites.

Cramming the second shape into the first would mean either (a) losing
every season but the most recent on each upsert, which destroys the one
thing that makes this data valuable (multi-season history), or (b)
bolting a `season` column onto `players` and turning its
`unique(source_id, external_id)` constraint into something it was never
designed to be — a live-catalog table used by every other adapter
(Sleeper, ESPN) would suddenly carry an FPL-only, season-scoped notion of
identity. Both are worse than a dedicated table.

This is the **first slice** only: one new table, one season backfilled,
via direct SQL through the Supabase MCP tools. It does not touch
`fpl_planner/optimise.py`'s CSV-reading path, does not backfill history,
and does not wire up an ongoing sync. See "Out of scope" below.

## Why a new table, not a change to `players`

Covered above in short form; concretely, the new table needs a
**composite identity that includes season** (`unique(season,
player_code)`), which `players` structurally cannot express without
changing what every other adapter's rows mean. A second table with its
own key shape is the cheaper, correct answer — same reasoning
`0001_league_tables.sql` already used for league-scoped data
(`leagues`/`fantasy_teams`/`weekly_scores`/`roster_players` are a
separate set of tables from the platform-wide `teams`/`players`, for
exactly the same "different identity shape" reason).

## Table: `public.fpl_player_season_stats`

One row per `(season, player_code)`. `player_code` (vaastav's `code`
column) is used as the player key, not `id` — `fpl_planner/loaders.py`'s
own module docstring and `docs/data-sources-vaastav-fpl-history.md` both
document that `id` is re-numbered per season and unusable as a
cross-season key, while `code` is upstream's stable identifier. Using
`code` now means a later multi-season backfill is additive (more rows),
not a key migration.

```sql
create table public.fpl_player_season_stats (
  id bigint generated always as identity primary key,
  season text not null,
  player_code text not null,
  player_id integer not null,
  web_name text not null,
  first_name text not null,
  second_name text not null,
  team_name text not null,
  team_code integer not null,
  position text not null check (position in ('GKP', 'DEF', 'MID', 'FWD')),
  price numeric not null,
  status text not null,
  chance_of_playing_next_round integer,
  news text not null default '',
  total_points integer not null default 0,
  points_per_game numeric,
  minutes integer not null default 0,
  starts integer,
  goals_scored integer not null default 0,
  assists integer not null default 0,
  clean_sheets integer not null default 0,
  goals_conceded integer not null default 0,
  own_goals integer not null default 0,
  penalties_saved integer not null default 0,
  penalties_missed integer not null default 0,
  yellow_cards integer not null default 0,
  red_cards integer not null default 0,
  saves integer not null default 0,
  bonus integer not null default 0,
  bps integer not null default 0,
  influence numeric,
  creativity numeric,
  threat numeric,
  ict_index numeric,
  expected_goals numeric,
  expected_assists numeric,
  expected_goal_involvements numeric,
  expected_goals_conceded numeric,
  defensive_contribution numeric,
  tackles numeric,
  clearances_blocks_interceptions numeric,
  recoveries numeric,
  selected_by_percent numeric,
  transfers_in integer,
  transfers_out integer,
  form numeric,
  value_season numeric,
  schema_era text not null,
  source text not null default 'vaastav-fpl-history',
  updated_at timestamptz not null default now(),
  unique (season, player_code)
);
```

Column choices:

- **`price`** is stored already divided by 10 (£m, e.g. `6.0` not `60`) —
  matching the convention `fpl_planner/loaders.py::_load_vaastav_players`
  already establishes (`df["price"] = df["now_cost"] / 10`), and the unit
  every other price value in this repo uses (`fpl_planner/config.py`'s
  `ManagerRules.budget = 100.0`). Storing raw `now_cost` and pushing the
  ÷10 to every consumer would just reproduce the exact cross-source unit
  bug `docs/data-sources-fpl-core-insights.md` warns about, one layer
  later.
- **`team_name`** is resolved at backfill time via
  `fpl_planner.loaders.resolve_team(season, team_id)` rather than storing
  the raw numeric `team` id — team ids are Premier-League-wide and
  renumbered every season (see that function's own docstring), so a raw
  id in the warehouse would be actively misleading without also shipping
  a season-scoped id→name table. `team_code` (vaastav's `team_code`,
  which — unlike `team` — is stable enough for the current single-season
  slice) is kept alongside for anyone who wants the numeric value.
- **`schema_era`** is carried through from `loaders._schema_era()` even
  though every row in this first backfill has the same value
  (`"xg_defensive_contribution"`, since only 2026-27 is loaded) — it
  costs nothing now and saves a migration later when a historical
  backfill actually needs to tell eras apart.
- **`source`** defaults to `'vaastav-fpl-history'` and is not currently
  varied — see "Not merging fpl-core-insights in this slice" below for
  why. It exists so that a later slice adding fpl-core rows doesn't need
  a schema change, only a decision about how the two sources coexist in
  the same table (or don't).
- Columns are a curated subset of vaastav's raw ~109, not a 1:1 mirror —
  matching this repo's existing pattern of trimming the platform-wide
  `players` table to what's actually used, rather than mirroring every
  upstream field. The subset chosen covers everything
  `fpl_planner/config.py`'s `RiskDiscountRule`s and
  `docs/analysis-2026-27-optimal-starting-squad.md`'s methodology
  reference (status/news/chance_of_playing, minutes/starts, the
  underlying-stats block, ICT, selected_by/transfers/form/value).
- No foreign keys to `sports`/`sources` — this table is FPL-only and
  season-scoped by construction (unlike `teams`/`players`, which are
  multi-platform and rely on those tables to disambiguate). Adding
  `source_id`/`sport_id` FKs here would just be two constant columns that
  can never take another value; `source` (as a plain text provenance tag,
  not an FK into `public.sources`) already documents "this came from
  vaastav" without pretending it varies per adapter.

**`unique (season, player_code)` only, not `(source, season,
player_code)`.** With one source ingested, this is the correct key. If a
later slice adds fpl-core rows, that decision (a separate table with its
own key, one row per player merged via `cross_source_join`, or genuinely
two source-tagged rows per player-season) is exactly the kind of judgment
call that slice's own design doc should make with the two real answers in
front of it — baking in a guess now would be more likely to need
reversal than to save work. Flagged explicitly in "Out of scope."

## Why current-season-only for this slice

`services/fpl-planner/fpl_planner/league_config`-style "current season"
convention lives in `services/ingestion/fantasy_ingest/league_config.py`
as `CURRENT_FPL_SEASON = "2026-27"` (vaastav format — fpl-core's own
format for the same season is `2026-2027`, per
`docs/data-sources-fpl-core-insights.md`). This slice backfills exactly
that one season, 616 rows (`wc -l
services/fpl-planner/data/vaastav-fpl-history/2026-27/players_raw.csv` −
1 header row), from `players_raw.csv` joined with that season's own
`teams.csv` for team names (`resolve_team` falls back to `teams.csv`
because `master_team_list.csv` stops at 2023-24 — see
`docs/data-sources-vaastav-fpl-history.md`).

Backfilling all 11 seasons (2016-17 → 2026-27, ~616-865 rows each, ~8,000
rows total) in one shot was explicitly ruled out by the task's own scope
guardrail, and independently makes sense to defer: it's an order of
magnitude more data to hand-verify, the schema-era boundaries
(`pre_xg`/`xg`/`xg_defensive_contribution`) mean several columns are
legitimately `NULL` for older seasons in ways worth spot-checking
individually, and nothing downstream needs the older seasons yet
(`optimise.py` isn't being changed to read from this table in this
slice — see below). One well-verified season is a safer, still-genuine
first slice than eleven unverified ones.

## Not merging fpl-core-insights in this slice

`services/fpl-planner` has two upstream sources
(`docs/data-sources-vaastav-fpl-history.md`,
`docs/data-sources-fpl-core-insights.md`), joined today by
`fpl_planner.loaders.cross_source_join()` — a `code`-based merge with a
`(first_name, second_name)` fallback, and even then ~37 fpl-core rows per
season currently go unmatched and are logged, not dropped. Reproducing
that join logic correctly in a one-off SQL backfill (rather than in the
already-tested `pandas` code that implements it) risks silently
introducing a second, divergent implementation of a join that the
loaders module's own comments describe as non-trivial (two different id
schemes, a name-based fallback, logged-but-real unmatched rows on both
sides). vaastav's `players_raw.csv` alone already has everything this
slice's column list needs (identity, price, status/news, the full
underlying-stats block) without that risk. fpl-core's unique value
(Elo ratings in its `teams.csv`, true gameweek-by-gameweek granularity)
is real but additive — worth its own slice once this one is proven out,
not a reason to block it.

## Backfill mechanism

Per the task's explicit direction: **no new Python sync script**, and no
use of `services/ingestion`'s `warehouse.py` httpx/service-role-key path
(that path is for the *live, ongoing* multi-platform sync; this is a
one-off historical backfill of a different table shape entirely — reusing
it would mean adding FPL-planner-specific upsert logic to a module whose
whole job is being adapter-agnostic).

Instead: a local, uncommitted script
(`fpl_planner.loaders.load_players("vaastav", "2026-27")` plus
`resolve_team`) reads and normalizes the 616 rows exactly the way the
existing, tested loader already does, and emits batched
`insert into public.fpl_player_season_stats (...) values (...), (...),
...;` statements, run through `mcp__supabase__execute_sql`. This:

- reuses the loader's own normalization (position mapping, price ÷10,
  `code`/`schema_era` handling) instead of re-deriving it, so the backfill
  can't silently diverge from what `fpl_planner` itself considers correct;
- needs no secret material — `execute_sql`/`apply_migration` authenticate
  via this session's authorized Supabase MCP access, never the service
  role key (consistent with the network-egress note in the root
  `CLAUDE.md`: MCP tools reach this project even though this sandbox's own
  outbound HTTP to `*.supabase.co` is blocked);
- is a one-time operation, appropriately expressed as SQL run once, not a
  standing script that would imply an ongoing job (there isn't one — see
  "Out of scope").

Batches of 100 rows per `execute_sql` call (≈7 calls for 616 rows) —
small enough to keep each statement easy to review/re-run individually if
one batch fails, large enough that the backfill isn't 616 round trips.

## RLS approach

Same model as every existing warehouse table
(`0001_league_tables.sql`): enable RLS, one `for select using (true)`
policy, **no write policy at all**. The task is explicit that this table
gets no ongoing sync job and thus no application write path, so there's
no reason to grant `anon`/`authenticated` insert/update/delete the way
`players`/`teams` don't either (those are written only via the service
role key from `warehouse.py`, which bypasses RLS entirely — this table
has no equivalent writer, service-role or otherwise, so it needs no write
policy of any kind). The backfill itself runs through the Supabase MCP
tools' own elevated access, not through a policy-gated role.

## Verification plan

1. Row count: `select count(*) from public.fpl_player_season_stats;` must
   equal 616.
2. Spot-check 2-3 known players (e.g. Haaland, a name from
   `fpl_planner/config.py`'s locked codes) against the source CSV by
   `player_code`.
3. RLS: `set role anon; select ... from public.fpl_player_season_stats
   limit 3;` (matching how `0002`'s `player_consistency_view` was
   verified in this same project) — expect real rows back, not a
   permission error or empty set.
4. `services/fpl-planner`'s existing test suite still passes unmodified
   (no source file in that package changes in this slice).

## Out of scope (explicit)

- **Backfilling any season other than 2026-27.** All 10 remaining seasons
  are deferred; a follow-up slice would re-run the same backfill mechanism
  per season, most likely worth batching once repeated 10 more times
  rather than one-off.
- **Adding fpl-core-insights rows.** Deferred pending a decision on how
  its `code`-matched-with-name-fallback join should be represented for
  rows that don't match cleanly (see "Not merging fpl-core-insights"
  above).
- **Any change to `fpl_planner/optimise.py` or `fpl_planner/loaders.py`.**
  The optimiser keeps reading CSVs exactly as it does today; this table is
  a new, parallel, warehouse-backed path that nothing in `fpl_planner` or
  `apps/web` reads from yet. Pointing the optimiser (or a future
  `apps/web` view) at this table is future work.
- **Any ongoing/scheduled sync of this table.** Unlike
  `.github/workflows/sync.yml` (which the "player-consistency" precedent
  work assumes for `roster_players`), there is no per-season live upstream
  feed being polled here — vaastav's own repo is only re-cloned by hand
  (`services/fpl-planner/README.md`, "Re-ingesting"). Wiring a scheduled
  job to re-backfill this table would need that manual re-ingest step
  automated first, which is a separate, larger project.
- **A `(source, season, player_code)` uniqueness model for multi-source
  rows.** Noted above under the table schema.
- **Exposing this table in `apps/web`.** No UI change in this slice.
