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
