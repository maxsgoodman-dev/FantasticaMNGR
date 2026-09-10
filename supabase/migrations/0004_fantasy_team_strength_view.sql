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
