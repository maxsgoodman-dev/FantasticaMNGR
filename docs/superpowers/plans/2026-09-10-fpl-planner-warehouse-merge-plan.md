# FPL-Planner → Warehouse Merge (First Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one new warehouse table, `public.fpl_player_season_stats`,
season-scoped (unlike the live-snapshot `players` table), and backfill it
with the current season (2026-27, 616 rows) from
`services/fpl-planner/data/vaastav-fpl-history/2026-27/players_raw.csv` via
direct SQL through the Supabase MCP tools. See
`docs/superpowers/specs/2026-09-10-fpl-planner-warehouse-merge-design.md`
for full rationale — table shape, why season-scoped, why current-season
only, why vaastav-only, why no ongoing sync.

**Architecture:** One Supabase migration creates the table (RLS: public
`SELECT`, no write policy — matching `0001_league_tables.sql`). The backfill
is a local, uncommitted script that reuses `fpl_planner.loaders.load_players`
and `resolve_team` to normalize the CSV exactly the way `fpl_planner` itself
already does, then emits batched `INSERT` statements run through
`mcp__supabase__execute_sql`. No changes to `fpl_planner/optimise.py`,
`fpl_planner/loaders.py`, `services/ingestion`, or `apps/web`.

**Tech Stack:** Postgres/Supabase (`mcp__supabase__apply_migration`,
`mcp__supabase__execute_sql`, project id `wsmegxfnmkhaailxhuih`), the
existing `fpl_planner` Python package (read-only use of its loader) — no new
dependencies.

---

### Task 1: Create and apply the table migration

**Files:**
- Create: `supabase/migrations/0003_fpl_player_season_stats.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0003_fpl_player_season_stats.sql`:

```sql
-- Season-scoped FPL player stats, backfilled from services/fpl-planner's
-- historical CSV archive (vaastav/Fantasy-Premier-League) -- a different
-- shape from the live-snapshot public.players table, which is why this is
-- its own table rather than a column added to players. One row per
-- (season, player_code); player_code (not the season-scoped id) is the
-- stable cross-season key vaastav itself uses. See
-- docs/superpowers/specs/2026-09-10-fpl-planner-warehouse-merge-design.md
-- for full schema rationale and what's deliberately out of scope
-- (all other seasons, fpl-core-insights, any optimiser/UI wiring).

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

alter table public.fpl_player_season_stats enable row level security;

create policy "public read fpl_player_season_stats"
  on public.fpl_player_season_stats for select using (true);
```

- [ ] **Step 2: Apply the migration**

Use `mcp__supabase__apply_migration`, project id `wsmegxfnmkhaailxhuih`:
- `name`: `fpl_player_season_stats`
- `query`: the exact SQL above

Expected: succeeds with no error.

- [ ] **Step 3: Confirm the table shape**

Use `mcp__supabase__list_tables` (project id `wsmegxfnmkhaailxhuih`,
`verbose: true`) and confirm `public.fpl_player_season_stats` appears with
the columns above, RLS enabled, no foreign keys (by design — see spec).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_fpl_player_season_stats.sql
git commit -m "Add fpl_player_season_stats table for FPL historical warehouse merge (first slice)"
```

---

### Task 2: Generate the backfill SQL from the source CSV

**Files:**
- Create (local, NOT committed — see spec's "Backfill mechanism"):
  a throwaway script under the scratchpad or `/tmp`, not under `services/`.

- [ ] **Step 1: Write a script that normalizes the CSV the same way `fpl_planner` does**

The script should, in-process:

1. Import and call `fpl_planner.loaders.load_players("vaastav", "2026-27")`
   (requires `services/fpl-planner` installed in a venv, or running with
   `sys.path` pointed at `services/fpl-planner`) to get the normalized
   DataFrame (`position`, `price`, `code`, `season`, `schema_era` already
   computed).
2. For each row, resolve the team name via
   `fpl_planner.loaders.resolve_team("2026-27", row["team"])`.
3. Map columns to the target table's names 1:1 where they match
   (`web_name`, `first_name`, `second_name`, `total_points`, `minutes`,
   `starts`, `goals_scored`, `assists`, `clean_sheets`, `goals_conceded`,
   `own_goals`, `penalties_saved`, `penalties_missed`, `yellow_cards`,
   `red_cards`, `saves`, `bonus`, `bps`, `influence`, `creativity`,
   `threat`, `ict_index`, `expected_goals`, `expected_assists`,
   `expected_goal_involvements`, `expected_goals_conceded`,
   `defensive_contribution`, `tackles`,
   `clearances_blocks_interceptions`, `recoveries`,
   `selected_by_percent`, `transfers_in`, `transfers_out`, `form`,
   `value_season`, `points_per_game`), plus the renames already decided in
   the spec (`code` → `player_code`, `id` → `player_id`,
   `element_type`-derived `position` as-is, `now_cost`-derived `price`
   as-is since the loader already divides by 10).
4. Handle `chance_of_playing_next_round`: the raw CSV has the literal
   string `"None"` for missing values (confirmed by inspecting the file
   directly) — convert that (and any empty string) to SQL `NULL`, not the
   string `'None'`.
5. Escape single quotes in free-text fields (`news`, `second_name` — e.g.
   apostrophes in names) by doubling them (`'`  → `''`) before interpolating
   into the SQL string.
6. Emit one `insert into public.fpl_player_season_stats (<columns>) values
   (<row>), (<row>), ...;` statement per batch of 100 rows (≈7 batches for
   616 rows).

- [ ] **Step 2: Sanity-check the generated SQL before running any of it**

Print (don't yet execute) the first batch and manually confirm:
- Row count across all batches sums to 616.
- A spot-checked row (e.g. `player_code = '223094'`, Haaland — a locked
  code in `fpl_planner/config.py::default_manager_rules`) has the right
  `web_name`, `team_name` (`Man City` per that season's `teams.csv`), and
  a `price` in the 12-16 range (£m), not the raw tenths value.
- No unescaped single quotes made it through (grep the generated SQL for
  a bare `'` inside what should be a closed string literal — or just trust
  the escaping step above and check 2-3 known apostrophe names, e.g. a
  player with `O'` in their surname if one exists this season).

---

### Task 3: Run the backfill and verify

**Files:** none — this task only calls `mcp__supabase__execute_sql`.

- [ ] **Step 1: Run each batch**

Call `mcp__supabase__execute_sql` (project id `wsmegxfnmkhaailxhuih`) once
per batch generated in Task 2, in order. Representative first batch (first
2 rows only, illustrative — the real batch has ~100):

```sql
insert into public.fpl_player_season_stats (
  season, player_code, player_id, web_name, first_name, second_name,
  team_name, team_code, position, price, status,
  chance_of_playing_next_round, news, total_points, points_per_game,
  minutes, starts, goals_scored, assists, clean_sheets, goals_conceded,
  own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards,
  saves, bonus, bps, influence, creativity, threat, ict_index,
  expected_goals, expected_assists, expected_goal_involvements,
  expected_goals_conceded, defensive_contribution, tackles,
  clearances_blocks_interceptions, recoveries, selected_by_percent,
  transfers_in, transfers_out, form, value_season, schema_era
) values
('2026-27', '154561', 1, 'Raya', 'David', 'Raya Martín', 'Arsenal', 3,
 'GKP', 6.0, 'a', null, '', 6, 6.0, 90, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
 3, 0, 20, 12.0, 0.0, 0.0, 1.2, 0.0, 0.0, 0.0, 1.1, 0.0, 0.0, 0.0, 0.0,
 38.3, 0, 0, 6.0, 1.2, 'xg_defensive_contribution'),
('2026-27', '109745', 2, 'Arrizabalaga', 'Kepa', 'Arrizabalaga Revuelta',
 'Arsenal', 3, 'GKP', 5.0, 'a', null, '', 0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0,
 0, 0, 0, 0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
 0.1, 0, 0, 0.0, 0.0, 'xg_defensive_contribution');
```

(Exact numeric values above for illustration — the real values must come
from Task 2's script output, not be retyped by hand, to avoid transcription
errors across 616 rows / ~45 columns each.)

Expected per batch: success, no constraint violation. A `unique
violation` on `(season, player_code)` most likely means the script emitted
a duplicate row or the batch was already run once — check before re-running
a batch.

- [ ] **Step 2: Verify row count**

```sql
select count(*) from public.fpl_player_season_stats;
```

Expected: `616`.

- [ ] **Step 3: Verify sample rows against the source CSV**

```sql
select season, player_code, web_name, team_name, position, price,
       total_points, minutes, form
from public.fpl_player_season_stats
where player_code in ('223094', '154561', '219168')
order by player_code;
```

Expected: matches the corresponding rows in
`services/fpl-planner/data/vaastav-fpl-history/2026-27/players_raw.csv`
(cross-check `code`, `web_name`, `now_cost/10`, `total_points`, `minutes`,
`form` by eye) — `223094` is Haaland (locked captain in
`fpl_planner/config.py`), `219168` is Isak, both good known-value checks.

---

### Task 4: Verify RLS via the anon role

**Files:** none — verification only.

- [ ] **Step 1: Query as the anon role**

```sql
set role anon;
select player_code, web_name, team_name, price
from public.fpl_player_season_stats
limit 3;
reset role;
```

Expected: 3 real rows back, not a permission error or empty result — same
check `0002_player_consistency_view.sql` used for
`player_consistency_scores` in this same project.

- [ ] **Step 2 (optional, if reachable): confirm over PostgREST too**

```bash
curl -s "<SUPABASE_URL>/rest/v1/fpl_player_season_stats?select=web_name,team_name,price&limit=3" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"
```

Get `<SUPABASE_URL>`/`<ANON_KEY>` via `mcp__supabase__get_project_url` /
`mcp__supabase__get_publishable_keys`. If this sandbox's outbound HTTP to
`*.supabase.co` is blocked (see root `CLAUDE.md`'s network-egress note),
Step 1's `set role anon` result is sufficient on its own — don't spend time
working around the curl restriction.

---

### Task 5: Run existing test suites and write the completion note

**Files:**
- Create: a short completion note (see Step 3) — since the actual
  backfilled data lives in Postgres, not in a git-tracked file, this note
  is what makes the backfill's outcome (row count, verification results)
  visible in the git history alongside the schema/docs.

- [ ] **Step 1: Run `services/fpl-planner`'s test suite**

```bash
cd services/fpl-planner
python3 -m venv .venv && source .venv/bin/activate
pip install -e . pytest -q
pytest -q
deactivate
rm -rf .venv
cd ../..
```

Expected: all existing tests pass unmodified — nothing in
`fpl_planner/loaders.py`, `config.py`, or `optimise.py` was changed by this
slice.

- [ ] **Step 2: `services/ingestion` — skip unless something there changed**

Per the design, `services/ingestion` (adapters, `warehouse.py`,
`league_config.py`) is untouched by this slice, so its test suite doesn't
need re-running. Confirm with `git status`/`git diff --stat` before
skipping — only skip if that directory truly shows no changes.

- [ ] **Step 3: Write and commit the completion note**

Add a short note (e.g. append to the design doc's end, or a new
`docs/superpowers/specs/2026-09-10-fpl-planner-warehouse-merge-COMPLETE.md`
— either is fine) recording: final row count (616), season backfilled
(2026-27), the 2-3 sample rows checked, and the RLS verification result
(anon role / PostgREST). Commit:

```bash
git add docs/superpowers/
git commit -m "Record fpl_player_season_stats backfill verification (616 rows, 2026-27)"
```
