-- League-scoped rosters and already-computed fantasy scores (Sleeper, FPL).
-- Separate from teams/players (platform-wide catalogs, untouched here).
-- Keyed by natural external ids throughout, not surrogate-key FKs, so a
-- write never needs to read back a generated id from an upsert response
-- (same reasoning as teams/players' own unique(source_id, external_id)).

create table public.leagues (
  id bigint generated always as identity primary key,
  source_id text not null references public.sources(id),
  sport_id text not null references public.sports(id),
  external_league_id text not null,
  name text not null,
  season text not null,
  format text not null check (format in ('head_to_head', 'classic')),
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id)
);

create table public.fantasy_teams (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  team_name text not null,
  owner_name text not null,
  is_mine boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id),
  foreign key (source_id, external_league_id)
    references public.leagues (source_id, external_league_id) on delete cascade
);

create table public.weekly_scores (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  points numeric not null,
  opponent_external_team_id text,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week),
  foreign key (source_id, external_league_id, external_team_id)
    references public.fantasy_teams (source_id, external_league_id, external_team_id) on delete cascade
);

create table public.roster_players (
  id bigint generated always as identity primary key,
  source_id text not null,
  external_league_id text not null,
  external_team_id text not null,
  week integer not null,
  player_external_id text not null,
  player_name text not null,
  is_starter boolean not null default false,
  points numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (source_id, external_league_id, external_team_id, week, player_external_id),
  foreign key (source_id, external_league_id, external_team_id)
    references public.fantasy_teams (source_id, external_league_id, external_team_id) on delete cascade
);

alter table public.leagues enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.weekly_scores enable row level security;
alter table public.roster_players enable row level security;

create policy "public read leagues" on public.leagues for select using (true);
create policy "public read fantasy_teams" on public.fantasy_teams for select using (true);
create policy "public read weekly_scores" on public.weekly_scores for select using (true);
create policy "public read roster_players" on public.roster_players for select using (true);
