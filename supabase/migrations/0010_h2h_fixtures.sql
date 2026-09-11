-- The fixed H2H schedule (who plays whom each gameweek), independent of
-- whether that gameweek has been played yet. Complements weekly_scores,
-- which only ever records a match that has already happened — see
-- docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md for
-- why this is a separate table rather than a nullable-points row in
-- weekly_scores.

create table public.h2h_fixtures (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  opponent_external_team_id text,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week),
  foreign key (source_id, external_league_id, external_team_id)
    references public.fantasy_teams (source_id, external_league_id, external_team_id) on delete cascade
);

alter table public.h2h_fixtures enable row level security;

create policy "public read h2h_fixtures" on public.h2h_fixtures for select using (true);
