-- Platform-wide, week-scoped per-player point projections, pulled from
-- each platform's own API (FPL's bootstrap-static ep_next field; Sleeper's
-- dedicated /projections/nfl/{season}/{week} endpoint). Not league-scoped
-- -- a player's projection doesn't depend on which fantasy team owns
-- them -- so this mirrors the platform-wide `players` table's shape plus
-- a week dimension, not the league-scoped roster_players/weekly_scores
-- tables. See docs/superpowers/specs/2026-09-10-matchup-prep-design.md.

create table public.player_projections (
  id bigint generated always as identity primary key,
  source_id text not null references public.sources(id),
  sport_id text not null references public.sports(id),
  week integer not null,
  external_player_id text not null,
  projected_points numeric not null,
  updated_at timestamptz not null default now(),
  unique (source_id, sport_id, week, external_player_id)
);

alter table public.player_projections enable row level security;

create policy "public read player_projections"
  on public.player_projections for select using (true);
