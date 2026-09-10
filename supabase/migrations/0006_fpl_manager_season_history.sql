-- Every FPL fantasy manager's ("entry") multi-season track record --
-- total points, overall rank, and rank percentile per season, going back
-- to whenever that manager started playing FPL -- from
-- GET /api/entry/{entry_id}/history/'s `past` array. Distinct from both
-- public.fpl_player_season_stats (real Premier League *players'*
-- historical stats) and public.roster_players/weekly_scores (a manager's
-- *current*-season, gameweek-by-gameweek performance within one league):
-- this is a manager's own season-by-season summary, league-independent.
-- See docs/superpowers/specs/2026-09-11-fpl-manager-season-history-design.md
-- for full schema rationale and what's deliberately out of scope (no
-- ongoing sync, no `chips`, no `current`-array data).

create table public.fpl_manager_season_history (
  id bigint generated always as identity primary key,
  entry_id text not null,
  season_name text not null,
  total_points integer not null,
  rank bigint,
  rank_percentage numeric,
  updated_at timestamptz not null default now(),
  unique (entry_id, season_name)
);

alter table public.fpl_manager_season_history enable row level security;

create policy "public read fpl_manager_season_history"
  on public.fpl_manager_season_history for select using (true);
