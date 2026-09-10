# Player Consistency Score (Analytics/Mart Layer, First Slice) Design

## Goal

`docs/ARCHITECTURE.md`'s stage 4, "Analytics / mart layer", lists five distinct
derived-metric ideas plus a separate data-architecture question (merging
`services/fpl-planner`'s historical CSVs into the warehouse) — too broad for
one plan. This is the first slice: a **player consistency score** — how much
a player's weekly fantasy output varies — computed purely from data already
in the warehouse (`roster_players`), with no new ingestion, no new service,
and no UI change. It's chosen as the first slice because it needs nothing
beyond what `fantasy_ingest.sync_leagues` already syncs, so it's a complete,
testable piece of the mart layer on its own.

## Architecture

One new Postgres view, `player_consistency_scores`, defined over the
existing `roster_players` table via a Supabase migration
(`mcp__supabase__apply_migration`, the same mechanism used for the
league-ingestion schema). No new tables, no new columns on existing tables,
no application code (Python or TypeScript) changes.

```sql
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

**`security_invoker = true`** (Postgres 15+ view option, supported on this
project's Postgres 17.6) makes the view run with the querying role's own
permissions rather than the view owner's — so it inherits `roster_players`'
existing RLS policy (public `SELECT`, writes need the service role key)
instead of silently bypassing it the way a default security-definer view
would. This matches the access model every other warehouse read already
uses.

**Grouping is per-league, not merged across leagues.** The same real-world
player can appear in `roster_players` rows under more than one league (e.g.
a player owned in both an FPL classic and FPL h2h league, or a player who
changes fantasy teams across weeks in a Sleeper redraft league), and
different leagues can score the same performance differently (Sleeper
leagues configure their own scoring rules; FPL scoring is uniform, but the
schema doesn't distinguish that at the view level). Merging across leagues
would silently mix incompatible scoring systems into one number. So the
grouping key is `(source_id, external_league_id, player_external_id)` —
consistency is a property of "this player, as scored by this league."

**`having count(*) >= 2`** excludes players with only one recorded week —
a single data point has no variance, and `stddev_pop` of one row is `0`,
which would misleadingly read as "perfectly consistent."

**`stddev_pop` (population, not sample) is a deliberate choice**, not an
oversight: this view describes how much a player's *observed* weeks varied,
not an estimate of some larger population the observed weeks are a sample
of — population stddev is the direct, unbiased description of exactly the
data present.

## Known limitation (explicitly not solved here)

`coefficient_of_variation` (stddev ÷ avg) blows up for low-scoring bench
players — e.g. a player averaging 0.3 points with a 0.7 stddev produces a
coefficient of 2.4, which reads as "wildly inconsistent" but is really just
noise around a near-zero mean. The view doesn't filter this out (e.g. no
minimum-average-points threshold) because "what counts as a meaningful
consistency ranking" is a presentation-layer judgment call for whoever
consumes the view — the view's job is to expose the raw, correct statistics
(`avg_points`, `points_stddev`, `weeks_played`), not to pre-decide relevance
for every future consumer. A follow-up slice that surfaces this in `apps/web`
would be the place to add a `weeks_played >= N` or `avg_points >= N` filter
if the raw numbers turn out to be noisy in practice.

## Testing / verification

No unit-testable application code exists here — it's pure SQL. Verification
is: run the view's `SELECT` directly against the live warehouse (via
`mcp__supabase__execute_sql`) and confirm the output shape and a few rows
make sense (already sanity-checked during design — see chat: FPL h2h league
401057 has real per-player results ranging from `weeks_played` 3 to 22, with
recognizable low-signal noise at the high-CoV end as expected). Confirm RLS:
query the view using the anon/publishable key (not the service role key) via
a raw PostgREST request or `apps/web`'s own Supabase client, and confirm it
returns rows (proving `security_invoker` correctly inherited the public
`SELECT` policy rather than blocking the anon key).

## Explicitly out of scope

- Any UI surfacing of this data in `apps/web` (a natural next slice).
- Team-level consistency (a different, smaller slice covered in the same
  brainstorm as an alternative — not chosen this round).
- Any of the other four stage-4 metric ideas (matchup-adjusted projections,
  trade value/player comparisons, team strength/weakness, automated
  trade-opportunity detection).
- Merging `services/fpl-planner`'s historical CSV archive into the warehouse
  (a separate, larger data-architecture project per `docs/ARCHITECTURE.md`
  stage 4's own description).
- Any filtering/weighting to address the low-average-noise limitation above.
