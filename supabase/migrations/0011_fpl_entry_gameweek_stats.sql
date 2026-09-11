-- Per-team, per-week FPL manager stats (transfers made, chip used, bench
-- points, team value, overall rank) — extracted from the same
-- /entry/{id}/event/{week}/picks/ response fetch_h2h_league_data already
-- calls for every team every week (previously only `points` was read
-- from it). See
-- docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.

create table public.fpl_entry_gameweek_stats (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  event_transfers integer not null,
  event_transfers_cost integer not null,
  points_on_bench integer not null,
  bank numeric not null,
  team_value numeric not null,
  overall_rank integer,
  active_chip text,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week),
  foreign key (source_id, external_league_id, external_team_id)
    references public.fantasy_teams (source_id, external_league_id, external_team_id) on delete cascade
);

alter table public.fpl_entry_gameweek_stats enable row level security;

create policy "public read fpl_entry_gameweek_stats" on public.fpl_entry_gameweek_stats for select using (true);
