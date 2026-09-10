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
