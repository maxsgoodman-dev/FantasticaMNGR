# Player Consistency Score (Mart Layer First Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Postgres view, `player_consistency_scores`, over the existing `roster_players` table — the first slice of `docs/ARCHITECTURE.md` stage 4 ("Analytics / mart layer"), computing each player's weekly-points variance within a given league.

**Architecture:** One Supabase migration creates the view (`security_invoker = true` so it inherits `roster_players`' existing RLS rather than bypassing it). No new tables, no application code changes in `services/ingestion` or `apps/web` — this is a read-only derived view over data already synced. See `docs/superpowers/specs/2026-09-10-player-consistency-mart-design.md` for full rationale (why per-league grouping, why population stddev, the known coefficient-of-variation noise limitation at low averages — all deliberate, not gaps to fix here).

**Tech Stack:** Postgres/Supabase (`mcp__supabase__apply_migration`, `mcp__supabase__execute_sql`), matching the existing `supabase/migrations/0001_league_tables.sql` convention.

---

### Task 1: Create and apply the view migration

**Files:**
- Create: `supabase/migrations/0002_player_consistency_view.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0002_player_consistency_view.sql`:

```sql
-- Player consistency score: how much a player's weekly fantasy points vary,
-- computed per (source, league, player) -- not merged across leagues, since
-- different leagues can score the same real-world performance differently
-- (Sleeper leagues configure their own scoring; FPL is uniform but still
-- league-scoped in this schema). security_invoker makes this view respect
-- the querying role's own RLS on roster_players (public SELECT) instead of
-- running with the view owner's permissions. See
-- docs/superpowers/specs/2026-09-10-player-consistency-mart-design.md for
-- full rationale, including why coefficient_of_variation is left unfiltered
-- despite being noisy for low-scoring bench players.

create view public.player_consistency_scores
with (security_invoker = true) as
select
  source_id,
  external_league_id,
  player_external_id,
  max(player_name) as player_name,
  count(*) as weeks_played,
  round(avg(points), 2) as avg_points,
  round(stddev_pop(points), 2) as points_stddev,
  case
    when avg(points) > 0 then round((stddev_pop(points) / avg(points))::numeric, 3)
    else null
  end as coefficient_of_variation
from public.roster_players
group by source_id, external_league_id, player_external_id
having count(*) >= 2;
```

- [ ] **Step 2: Apply the migration to the `reality-manager` Supabase project**

Use the `mcp__supabase__apply_migration` tool (project id `wsmegxfnmkhaailxhuih`, the same project every other `apps/web`/`services/ingestion` command in this repo targets):
- `name`: `player_consistency_view`
- `query`: the exact SQL from Step 1

Expected: the tool call succeeds with no error.

- [ ] **Step 3: Verify the view returns the expected shape**

Use `mcp__supabase__execute_sql` (same project id) to run:

```sql
select source_id, external_league_id, player_external_id, player_name,
       weeks_played, avg_points, points_stddev, coefficient_of_variation
from public.player_consistency_scores
order by weeks_played desc
limit 5;
```

Expected: 5 rows, each with a non-null `player_name`, `weeks_played >= 2`, and `coefficient_of_variation` either a number or `null` (only `null` when `avg_points` is `0`). This is real synced data (FPL/Sleeper leagues already synced via `.github/workflows/sync.yml`), so exact values will vary run to run as more weeks sync — the shape and constraints are what to check, not specific numbers.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_player_consistency_view.sql
git commit -m "Add player_consistency_scores view (mart layer first slice)"
```

---

### Task 2: Verify the view is readable via the anon/publishable key (RLS check)

**Files:** none — verification only, confirming `security_invoker` actually inherited `roster_players`' RLS policy rather than silently exposing or blocking the view.

- [ ] **Step 1: Get the anon/publishable key and project URL**

Use `mcp__supabase__get_project_url` and `mcp__supabase__get_publishable_keys` (project id `wsmegxfnmkhaailxhuih`) — the same values `apps/web/.env.local` already uses (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Do not use the service role key for this check — the whole point is confirming the *public* key can read it, same as every other table `apps/web` queries.

- [ ] **Step 2: Query the view over PostgREST using only the anon key**

```bash
curl -s "<SUPABASE_URL>/rest/v1/player_consistency_scores?select=player_name,weeks_played,coefficient_of_variation&limit=3" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"
```

Expected: HTTP 200 with a JSON array of up to 3 rows (not an empty array, not a 401/403 permission error). An empty array or a permission error means `security_invoker` isn't working as intended and Task 1 needs another look before this task is considered done — don't silently accept either as "probably fine."

If this specific sandbox's network egress to `*.supabase.co` is blocked (see `docs/ARCHITECTURE.md`'s network-egress note — though note this session found Supabase reachable despite that documented restriction, so try this before assuming it's blocked), fall back to `mcp__supabase__execute_sql`, which can run `set role anon; select ... from public.player_consistency_scores limit 3;` to simulate the anon role's permissions from inside Postgres directly, without needing outbound HTTP.

- [ ] **Step 3: Report findings**

No commit for this task (verification only). Record in the final report: which method (PostgREST curl or `set role anon`) was used, and confirm rows came back.
