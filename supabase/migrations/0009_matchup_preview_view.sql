-- Per-team projected point total for the current week, joining each
-- head-to-head team's starters (roster_players) against
-- player_projections on player_external_id + week. security_invoker
-- makes this view respect the querying user's own RLS (the anon key
-- apps/web uses) rather than the view creator's -- same reasoning as
-- every other mart-layer view in this schema (player_consistency_scores,
-- player_trade_value, fantasy_team_strength).
--
-- starters_missing_projection surfaces gaps honestly (a bye week, a
-- newly-added player, a player the projections source doesn't cover)
-- instead of silently treating a missing projection as zero points. See
-- docs/superpowers/specs/2026-09-10-matchup-prep-design.md.

create view public.matchup_preview
with (security_invoker = true) as
select
  rp.source_id,
  rp.external_league_id,
  rp.external_team_id,
  rp.week,
  sum(pp.projected_points) as projected_points,
  count(*) filter (where pp.projected_points is null) as starters_missing_projection
from public.roster_players rp
left join public.player_projections pp
  on pp.source_id = rp.source_id
 and pp.external_player_id = rp.player_external_id
 and pp.week = rp.week
where rp.is_starter
group by rp.source_id, rp.external_league_id, rp.external_team_id, rp.week;
