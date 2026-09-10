-- Community-maintained FPL data sheet ("FPL Data & Planner - 2026/2027"),
-- ingested as a distinct, source-tagged data source -- not folded into
-- players or fpl_player_season_stats, since this is genuinely different
-- provenance (a third-party curated spreadsheet, not FPL's own API) with
-- its own refresh cadence (once daily, 5 AM GMT) and its own gotchas.
-- external_player_id matches FPL's own element id, joining cleanly
-- against players.external_id where source_id='fpl'. See
-- docs/superpowers/specs/2026-09-10-matchup-prep-design.md's "Fourth
-- data source" section for the sheet URL, access mechanism, and
-- attribution note.

create table public.fpl_sheet_player_data (
  id bigint generated always as identity primary key,
  external_player_id text not null,
  web_name text not null,
  position text not null,
  team_name text not null,
  cost_today numeric not null,
  form numeric,
  selection_percent numeric,
  total_points integer not null default 0,
  points_per_game numeric,
  chance_of_playing_next integer,
  total_cost_change numeric,
  cost_change_gw numeric,
  total_transfers_in integer,
  total_transfers_out integer,
  influence numeric,
  creativity numeric,
  threat numeric,
  ict_index numeric,
  next_fixtures jsonb not null default '[]',
  difficulty_score numeric,
  xgi_per_90 numeric,
  xgc_per_90 numeric,
  defcon numeric,
  price_change_progress numeric,
  data_fetched date not null,
  source text not null default 'fpl-community-sheet',
  synced_at timestamptz not null default now(),
  unique (external_player_id, data_fetched)
);

alter table public.fpl_sheet_player_data enable row level security;

create policy "public read fpl_sheet_player_data"
  on public.fpl_sheet_player_data for select using (true);
