# Mart Layer: Trade Value & Team Strength (Second Slice) Design

## Goal

`docs/ARCHITECTURE.md` stage 4 ("Analytics / mart layer") lists five
derived-metric ideas. The first slice (`player_consistency_scores`, see
`docs/superpowers/specs/2026-09-10-player-consistency-mart-design.md`)
covered idea 1. This is the second slice, covering the two remaining ideas
that are honestly buildable from data already in the warehouse without new
ingestion:

- **Trade value / player-vs-player comparisons** — a single comparable
  "value" figure per player, combining how much they score with how
  reliably they score it.
- **Team strength/weakness breakdowns** — per-fantasy-team scoring level,
  volatility, and how concentrated a team's output is in its starters vs.
  its bench.

The remaining two stage-4 ideas (opportunity/target share, matchup-adjusted
projections) and automated trade-opportunity detection are explicitly out
of scope — see "Explicitly out of scope" below for why each one specifically
can't be honestly built from what's already synced.

## Architecture

Two new Postgres views, both created via `mcp__supabase__apply_migration`
against the same `wsmegxfnmkhaailxhuih` project as every other warehouse
change, both using `with (security_invoker = true)` for the same reason the
precedent view does: it makes the view run with the *querying* role's
permissions, so it inherits the base tables' existing RLS (public `SELECT`,
writes need the service role key) instead of running with the view owner's
elevated rights. No new tables, no new columns, no application code changes
in `services/ingestion` or `apps/web`.

### View 1: `player_trade_value`

Builds directly on `player_consistency_scores` (the precedent view) rather
than re-deriving `avg_points`/`stddev` from `roster_players` a second time —
it's a comparable "value" figure layered on top of consistency, not a
competing computation of the same underlying stats:

```sql
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

**Why `avg_points / (1 + coefficient_of_variation)`, not just `avg_points`
or a blended average+stddev sum.** Raw `avg_points` alone is already in
`player_consistency_scores` and ranks players purely on output, ignoring
reliability entirely — two players averaging 12 points/week rank identically
whether one of them is always within a point or swings from 0 to 30. Trade
value needs to discount the swingy one. Dividing by `(1 + CoV)` does that
proportionally: a perfectly consistent player (`CoV = 0`) keeps their full
average as their value; a player whose stddev equals their average
(`CoV = 1`) has their value halved; a highly volatile player is discounted
further. `1 +` (rather than dividing by `CoV` directly) avoids a
division-by-zero / undefined blowup at `CoV = 0`, which is the *common*
case for a perfectly steady player, not an edge case to special-case away.
`coalesce(coefficient_of_variation, 0)` handles the one case
`player_consistency_scores` itself leaves as `null` — `avg_points = 0` —
where the division is moot anyway since the numerator is already `0`.

**Why build on `player_consistency_scores` instead of `roster_players`
directly.** Every grouping decision that view already made (per
`(source_id, external_league_id, player_external_id)`, `having
count(*) >= 2` to exclude single-week noise) applies identically here — a
trade-value figure is meaningless without the same "enough weeks to say
something real" floor consistency needed. Re-deriving the same aggregates
from the base table a second time would be duplicated logic that could
silently drift out of sync with the precedent view's definitions (e.g. if
`player_consistency_scores`'s grouping or filter ever changes, this view
would need the identical change made twice). Layering avoids that, and
`security_invoker` composes correctly through a chain of views: each view
in the chain evaluates its own permissions as the invoking role, so a
security-invoker view built on another security-invoker view still
ultimately checks the invoking role against `roster_players`' actual RLS
policy rather than short-circuiting on an intermediate view owner's rights
(verified directly — see "RLS verification" below).

**Sanity check against real data** (see "Verification" below for the exact
query): Erling Haaland (avg ~15.2, CoV ~0.64) ranks above Bruno Fernandes
(avg ~13.7, but CoV ~1.25 — nearly double the relative volatility) despite
Bruno's higher raw average, which is exactly the behavior a trade-value
metric should have: a high, unreliable scorer should not automatically
outrank a slightly-lower, much steadier one.

**Incidental effect on the known `coefficient_of_variation` noise
limitation.** The precedent design doc names a known limitation: `CoV`
blows up for low-scoring bench players (e.g. avg 0.3, stddev 0.7 → CoV 2.4
reads as "wildly inconsistent" but is really noise around near-zero). That
limitation is *not* fixed here — `coefficient_of_variation` itself is
untouched, still exposed as-is, still noisy at low averages, exactly per
the precedent's own "the view's job is to expose the raw statistics, not
pre-decide relevance" reasoning. But `trade_value` as a *derived* number
happens to handle that same case sensibly on its own terms: a bench player
averaging 0.3 with CoV 2.4 gets `trade_value = 0.3 / 3.4 ≈ 0.09` — correctly
reads as "low value," not "wildly inconsistent," because a near-zero
average dominates the result regardless of how noisy its ratio to a tiny
stddev is. This is a side effect of the formula, not a deliberate fix, and
it's specific to `trade_value` — anyone querying
`coefficient_of_variation` directly from the precedent view still sees the
original, undampened limitation.

### View 2: `fantasy_team_strength`

Aggregates `weekly_scores` (team-level scoring, per week) and
`roster_players` (per-player-per-week, tagged `is_starter`) per fantasy
team, joined to `fantasy_teams` for a human-readable name:

```sql
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

**Grain is per fantasy team, not per player** — `(source_id,
external_league_id, external_team_id)` — since "team strength" is
inherently a team-level question, unlike the player-scoped precedent view.

**`having count(*) >= 2` on `team_weeks`, same reasoning as the precedent
view's identical filter on player-weeks.** A team with exactly one
recorded week has an undefined variance, and `stddev_pop` of one row
evaluates to `0`, which would misleadingly read as "perfectly steady team"
rather than "we've only seen one data point." This is the same
"single-observation statistics are meaningless, not just noisy" argument
the precedent view already made for players — not a new judgment call.

**Real, current effect of that filter, checked against live data
(2026-09-10): it currently excludes both synced Sleeper leagues
entirely** (`1312106693248700416`, `1389724292484194304` — each has only
`week = 1` synced so far) **and most of FPL league `740`'s 125 rostered
teams** (that classic league's `weekly_scores` rows are mostly one row per
team, not one per team per week — see the live-data note below). The view
currently surfaces real multi-week data mainly from FPL h2h league
`401057` (20 teams, 3 weeks each). This is not a bug in the view; it's an
honest reflection of how much has actually synced so far
(`.github/workflows/sync.yml` runs every 6 hours — coverage will broaden
as more weeks accumulate). Documenting this now so nobody mistakes a
currently-thin result set for a query bug later.

**`roster_split` is `LEFT JOIN`ed, not required, because roster-level data
coverage is uneven across leagues** — confirmed live: FPL league `740` has
weekly team totals for 125 teams but `roster_players` rows for only 1 of
them (the adapter only pulls full roster detail for "my" team in that
classic league; scores for the other 124 come from the league's public
leaderboard, which doesn't expose their rosters). An `INNER JOIN` here
would silently drop every team without roster detail from the whole view,
even though their `weekly_scores`-derived stats (`avg_weekly_points`,
`weekly_points_stddev`) are perfectly valid on their own.
`starter_points_share` is simply `null` for those teams, distinguishable
from a real `0` (an actual all-bench-scoring week, e.g. every starter
benched or a scoreless week) — not a fabricated value standing in for
missing data.

**`starter_points_share` is a lower-fidelity concentration signal, not an
exact reconciliation with `weekly_scores`' team totals — documented, not
silently assumed.** Checked live: for FPL h2h league `401057`, summing a
team's `is_starter = true` `roster_players.points` for a given week does
not always equal that team's `weekly_scores.points` for the same week
(e.g. team `10735`, week 1: `weekly_scores.points = 79` but starter-row sum
`= 49`; weeks 2 and 3 for the same team match exactly). The gap is
consistent with FPL's captain armband doubling one starter's score at the
platform level — `roster_players` has no `is_captain` column, so that
doubling isn't reconstructable from what's synced. `starter_points_share`
is therefore computed independently from `roster_players` alone (starter
points ÷ total roster points, never compared against `weekly_scores`), so
it doesn't inherit that gap as an error — it answers "of the points this
team's synced roster produced, how much came from starters vs. bench,"
which is well-defined on its own terms. But it should not be read as "this
fraction of the team's *official* weekly score," which it isn't
guaranteed to equal.

## RLS verification

Both views were checked with `set role anon;` against the live project
(see the implementation plan for the exact commands and results) —
confirming `security_invoker` correctly propagates through
`player_trade_value`'s dependency on the also-`security_invoker`
`player_consistency_scores`, and through `fantasy_team_strength`'s direct
joins across `weekly_scores`, `roster_players`, and `fantasy_teams`.

## Explicitly out of scope

- **Opportunity / target share, red zone efficiency (stage-4 idea 2).**
  This needs raw per-play/per-target stat data — targets, red zone
  touches — that no adapter in `services/ingestion` ingests today.
  `sleeper.py` and `espn.py`'s own module docstrings are explicit that
  `price`/`total_points`/`form` are the only per-player numbers available
  from those platforms without a league ID, and even the league-scoped
  sync (`sync_leagues`) only adds fantasy points via `roster_players`, not
  underlying box-score stats. There is no target-share or red-zone data
  anywhere in this warehouse to build this from. Approximating it from
  points data instead would not actually measure opportunity or target
  share — it would be a different metric wearing that name, which is
  worse than not building it. **Not attempted.**
- **Matchup-adjusted projections (stage-4 idea 3).** This needs a
  fixture-difficulty / opponent-strength concept the warehouse doesn't
  have. FPL's public `fixtures` endpoint exposes
  `team_h_difficulty`/`team_a_difficulty` that could eventually feed this,
  but pulling that in is new adapter work in `services/ingestion`
  (a new endpoint, a new normalize function, new tests) — not a SQL view
  over data that already exists, which is what this mart-layer slice is
  scoped to. Sleeper and ESPN have no equivalent surfaced anywhere in this
  codebase either, so even a partial version would only ever cover FPL. A
  follow-up ingestion project (a `fixtures`/`schedule_strength` table) is
  the right shape for this, not an attempt here. **Not attempted.**
- **Automated trade-opportunity detection.** Algorithmically suggesting
  specific trades depends on `player_trade_value` existing first (done in
  this slice) but is a materially bigger, separate product decision on
  top of it: what makes two players a plausible trade (position
  eligibility? roster needs? both managers' willingness?), how "fair"
  is scored, whether it's surfaced per-league or cross-league, and what a
  false-positive suggestion costs in user trust. None of that is a small
  extension of a value-comparison view — it's a new feature with its own
  design space. Building a half version now (e.g. "any two players within
  X value of each other") would ship something that looks complete but
  isn't a real trade suggestion engine, which is worse than leaving it
  explicitly for a dedicated follow-up. **Not attempted.**
- Any UI surfacing of either new view in `apps/web` (a natural next slice,
  same as the precedent view's own "not yet surfaced in the UI" note).
- Cross-league merging for either view — `player_trade_value` inherits the
  precedent's per-league grouping (see that design doc's own rationale,
  which applies unchanged here); `fantasy_team_strength` is inherently
  per-league already since a "team" only exists within one league.
- Re-solving the precedent view's own known `coefficient_of_variation`
  noise limitation at the source (still not filtered/weighted in
  `player_consistency_scores` itself — see that design doc).
