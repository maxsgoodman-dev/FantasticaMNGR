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
