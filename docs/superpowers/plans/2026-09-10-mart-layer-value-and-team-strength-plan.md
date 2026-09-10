# Mart Layer: Trade Value & Team Strength (Second Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two Postgres views — `player_trade_value` (layered on the precedent `player_consistency_scores` view) and `fantasy_team_strength` (aggregating `weekly_scores` + `roster_players` per fantasy team) — covering stage-4 ideas 4 and 5 from `docs/ARCHITECTURE.md`. Ideas 2 and 3, and automated trade-opportunity detection, are explicitly out of scope this round — see `docs/superpowers/specs/2026-09-10-mart-layer-value-and-team-strength-design.md` for full rationale on both the two views built and the three things deliberately not attempted.

**Architecture:** Two Supabase migrations, each one view, both `with (security_invoker = true)`. No new tables, no application code changes in `services/ingestion` or `apps/web`. See the design doc for the exact SQL and the reasoning behind every grouping/formula/join choice — this plan just executes it.

**Tech Stack:** Postgres/Supabase (`mcp__supabase__apply_migration`, `mcp__supabase__execute_sql`), matching `supabase/migrations/0001_league_tables.sql` and `0002_player_consistency_view.sql`.

---

### Task 1: Create and apply the `player_trade_value` view migration

**Files:**
- Create: `supabase/migrations/0003_player_trade_value_view.sql`

- [x] **Step 1: Write the migration file**

Create `supabase/migrations/0003_player_trade_value_view.sql`:

```sql
-- Player trade value: a single comparable "value" figure per player,
-- combining how much they score (avg_points) with how reliably they
-- score it (coefficient_of_variation), both already computed per
-- (source, league, player) by player_consistency_scores. trade_value =
-- avg_points / (1 + coefficient_of_variation) so a perfectly consistent
-- player keeps their full average, and volatility proportionally
-- discounts it. security_invoker makes this view respect the querying
-- role's own RLS -- it composes through player_consistency_scores'
-- own security_invoker down to roster_players' RLS. See
-- docs/superpowers/specs/2026-09-10-mart-layer-value-and-team-strength-design.md
-- for full rationale, including why this is layered on
-- player_consistency_scores rather than re-deriving avg/stddev from
-- roster_players directly.

create view public.player_trade_value
with (security_invoker = true) as
select
  source_id,
  external_league_id,
  player_external_id,
  player_name,
  weeks_played,
  avg_points,
  points_stddev,
  coefficient_of_variation,
  round(
    (avg_points / (1 + coalesce(coefficient_of_variation, 0)))::numeric,
    2
  ) as trade_value
from public.player_consistency_scores;
```

- [x] **Step 2: Apply the migration to the `reality-manager` Supabase project**

Use `mcp__supabase__apply_migration` (project id `wsmegxfnmkhaailxhuih`):
- `name`: `player_trade_value_view`
- `query`: the exact SQL from Step 1

Expected: the tool call succeeds with no error.

- [x] **Step 3: Verify the view returns the expected shape and sane rankings**

Use `mcp__supabase__execute_sql` (same project id):

```sql
select source_id, external_league_id, player_external_id, player_name,
       weeks_played, avg_points, coefficient_of_variation, trade_value
from public.player_trade_value
order by trade_value desc
limit 10;
```

Expected: 10 rows, each with non-null `player_name` and `trade_value`,
`weeks_played >= 2` (inherited from `player_consistency_scores`'
`having` clause). Sanity check, not just shape: a player with a high
`avg_points` *and* low `coefficient_of_variation` should rank above a
player with a similar or higher `avg_points` but much higher
`coefficient_of_variation` — confirm this by eye on the returned rows
(e.g., as of 2026-09-10 this ordering puts Erling Haaland, avg ~15.2 /
CoV ~0.64, above Bruno Fernandes, avg ~13.7 / CoV ~1.25, even though
Bruno's raw average is close). Exact values will shift as more weeks
sync — the *ordering behavior*, not the specific numbers, is what to
verify.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0003_player_trade_value_view.sql
git commit -m "Add player_trade_value view (mart layer, trade value/comparison slice)"
```

---

### Task 2: Create and apply the `fantasy_team_strength` view migration

**Files:**
- Create: `supabase/migrations/0004_fantasy_team_strength_view.sql`

- [x] **Step 1: Write the migration file**

Create `supabase/migrations/0004_fantasy_team_strength_view.sql`:

```sql
-- Fantasy team strength/weakness: per-team weekly scoring level and
-- volatility from weekly_scores, plus how concentrated a team's roster
-- points are in starters vs. bench from roster_players. security_invoker
-- makes this view respect the querying role's own RLS on weekly_scores,
-- roster_players, and fantasy_teams. having count(*) >= 2 on team-weeks
-- excludes teams with only one recorded week, same reasoning as
-- player_consistency_scores' identical filter (a single observation has
-- no meaningful variance). roster_split is LEFT JOINed, not required,
-- because roster-level detail isn't synced for every team in every
-- league (e.g. large FPL classic leagues only pull full roster detail
-- for "my" team). See
-- docs/superpowers/specs/2026-09-10-mart-layer-value-and-team-strength-design.md
-- for full rationale, including the live-data caveat that
-- starter_points_share is computed independently from roster_players and
-- is not guaranteed to reconcile exactly with weekly_scores' official
-- team totals (FPL captain-armband doubling isn't reconstructable from
-- what's synced).

create view public.fantasy_team_strength
with (security_invoker = true) as
with team_weeks as (
  select
    source_id,
    external_league_id,
    external_team_id,
    count(*) as weeks_played,
    round(avg(points), 2) as avg_weekly_points,
    round(stddev_pop(points), 2) as weekly_points_stddev,
    max(points) as best_week_points,
    min(points) as worst_week_points
  from public.weekly_scores
  group by source_id, external_league_id, external_team_id
  having count(*) >= 2
),
roster_split as (
  select
    source_id,
    external_league_id,
    external_team_id,
    sum(points) filter (where is_starter) as starter_points,
    sum(points) as total_roster_points
  from public.roster_players
  group by source_id, external_league_id, external_team_id
)
select
  tw.source_id,
  tw.external_league_id,
  tw.external_team_id,
  ft.team_name,
  ft.owner_name,
  ft.is_mine,
  tw.weeks_played,
  tw.avg_weekly_points,
  tw.weekly_points_stddev,
  tw.best_week_points,
  tw.worst_week_points,
  case
    when rs.total_roster_points > 0
      then round((rs.starter_points / rs.total_roster_points)::numeric, 3)
    else null
  end as starter_points_share
from team_weeks tw
left join public.fantasy_teams ft
  on ft.source_id = tw.source_id
 and ft.external_league_id = tw.external_league_id
 and ft.external_team_id = tw.external_team_id
left join roster_split rs
  on rs.source_id = tw.source_id
 and rs.external_league_id = tw.external_league_id
 and rs.external_team_id = tw.external_team_id;
```

- [x] **Step 2: Apply the migration to the `reality-manager` Supabase project**

Use `mcp__supabase__apply_migration` (project id `wsmegxfnmkhaailxhuih`):
- `name`: `fantasy_team_strength_view`
- `query`: the exact SQL from Step 1

Expected: the tool call succeeds with no error.

- [x] **Step 3: Verify the view returns the expected shape**

Use `mcp__supabase__execute_sql` (same project id):

```sql
select source_id, external_league_id, external_team_id, team_name,
       owner_name, is_mine, weeks_played, avg_weekly_points,
       weekly_points_stddev, best_week_points, worst_week_points,
       starter_points_share
from public.fantasy_team_strength
order by avg_weekly_points desc
limit 10;
```

Expected: rows with `weeks_played >= 2`, a non-null `team_name`, and
`starter_points_share` either a number in `[0, 1]` or `null` (only
`null` when that team has no synced `roster_players` rows at all — see
design doc's note on FPL league `740`'s uneven roster coverage). As of
2026-09-10, real synced data puts this at 20 rows from FPL h2h league
`401057` (the only league where every team currently has 2+ weeks
synced) — count and specific values will grow as more weeks sync via
`.github/workflows/sync.yml`; the shape and constraints are what to
check.

```sql
select count(*) as total_rows,
       count(*) filter (where starter_points_share is null) as null_share_rows
from public.fantasy_team_strength;
```

Expected: `total_rows >= 1`; `null_share_rows` may be `0` or more,
never equal to `total_rows` (i.e., not *every* row should be missing
roster detail, or the join is broken, not just uneven).

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0004_fantasy_team_strength_view.sql
git commit -m "Add fantasy_team_strength view (mart layer, team strength/weakness slice)"
```

---

### Task 3: Verify both views are readable via the anon/publishable key (RLS check)

**Files:** none — verification only, confirming `security_invoker`
propagates correctly for both views, including through
`player_trade_value`'s dependency on the also-`security_invoker`
`player_consistency_scores`.

- [x] **Step 1: Get the anon/publishable key and project URL**

Use `mcp__supabase__get_project_url` and
`mcp__supabase__get_publishable_keys` (project id `wsmegxfnmkhaailxhuih`)
— same values `apps/web/.env.local` already uses. Do not use the service
role key.

- [x] **Step 2: Query both views using only the anon key**

Preferred (matches how `apps/web` actually reads these tables):

```bash
curl -s "<SUPABASE_URL>/rest/v1/player_trade_value?select=player_name,trade_value&order=trade_value.desc&limit=3" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"

curl -s "<SUPABASE_URL>/rest/v1/fantasy_team_strength?select=team_name,avg_weekly_points,starter_points_share&order=avg_weekly_points.desc&limit=3" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"
```

Expected: HTTP 200, non-empty JSON arrays for both — not a 401/403, and
not an empty array (either would mean `security_invoker` isn't
propagating as intended).

If outbound HTTP to `*.supabase.co` is blocked in this sandbox (see
`docs/ARCHITECTURE.md`'s network-egress note — though the precedent
verification found it reachable despite that documented restriction, so
try this first), fall back to `mcp__supabase__execute_sql` running:

```sql
set role anon;
select player_name, trade_value from public.player_trade_value order by trade_value desc limit 3;
select team_name, avg_weekly_points, starter_points_share from public.fantasy_team_strength order by avg_weekly_points desc limit 3;
reset role;
```

- [x] **Step 3: Report findings**

No commit for this task (verification only). Record in the final
report which method was used (PostgREST curl or `set role anon`) and
confirm rows came back for both views.

---

### Task 4: Confirm `services/ingestion` is unaffected

**Files:** none — this slice touches no Python code, only SQL migrations
and docs. This step exists to confirm that assumption rather than take
it on faith.

- [x] **Step 1: Run the ingestion test suite**

```bash
cd services/ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -e . pytest -q
pytest -q
deactivate
rm -rf .venv
```

Expected: all tests pass, same as before this slice — nothing in
`services/ingestion` was touched.

---

### Task 5: Mark this plan complete

- [x] **Step 1: Commit the checked-off plan**

```bash
git add docs/superpowers/plans/2026-09-10-mart-layer-value-and-team-strength-plan.md
git commit -m "Mark mart-layer value/team-strength plan complete"
```
