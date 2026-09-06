# League team-view dashboard — design

Status: approved by Max, 2026-09-06. Next step: implementation plan (writing-plans).

## Background

The dashboard today (`apps/web`) reads the warehouse's platform-wide `teams`/`players`
tables and shows a flat top-10-by-points list per sport. That's disconnected from how
Max actually uses this tool: he plays in specific fantasy leagues and wants to see his
own rosters, live/weekly scores, and (ideally) other teams in those same leagues — not
a global player catalog.

This originally started as "make the player table richer" (search/sort/filter/infinite
scroll). Mid-brainstorm it became clear the real priority is a league/team-scoped view,
which is a materially bigger effort touching ingestion, the warehouse schema, and a new
UI surface — not a frontend-only change. This spec covers that larger piece. The
richer-table work is kept in scope as a secondary page (see "Scope" below), demoted
from the homepage.

## Leagues in scope

Max plays in 6 leagues total across 3 platforms. This project covers 4 of them —
Sleeper and FPL, both fully public APIs, no OAuth required:

| Platform | Format | Size | In this project? |
|---|---|---|---|
| Sleeper (NFL) | head-to-head | 2 leagues | Yes |
| FPL (Premier League / soccer) | head-to-head | 1 league, ~20 entries | Yes |
| FPL (Premier League / soccer) | classic (no matchups, ranked by points) | 1 league, ~100 entries | Yes |
| Yahoo (NFL) | — | 2 leagues | **No — deferred**, requires OAuth2 user auth, a materially different and larger integration than "add an adapter" |

All 20 entries in the FPL head-to-head league are also members of the ~100-person
classic league — same underlying FPL entries, viewed through two different league
lenses.

## Scoring: use platform-computed points, not a custom engine

Originally conceived as "ingest a scoring methodology once, then track raw live stats
and compute points ourselves." Dropped in favor of the simpler option: both Sleeper and
FPL already compute fantasy points themselves and expose them over their public APIs
(Sleeper's `/league/{id}/matchups/{week}` includes a per-team `points` total and a
per-player `players_points` breakdown, already scored per that league's own settings;
FPL's entry endpoints already carry per-gameweek totals). This project ingests those
already-computed numbers directly — no scoring-rules config, no raw stat ingestion, no
risk of our math drifting from what each platform actually shows its users.

Revisit a custom scoring engine only if we hit something a platform doesn't expose.

## Data model (new Supabase tables)

Separate from the existing `teams`/`players` (platform-wide catalogs, unchanged) —
these are league-scoped and carry weekly history plus "is this Max's team":

- **`leagues`** — `id`, `source_id` (`sleeper`/`fpl`), `external_league_id`, `sport_id`,
  `name`, `season`, `format` (`head_to_head` | `classic`). `format` is generic on
  purpose so Yahoo (also head-to-head) slots in later without a schema change.
- **`fantasy_teams`** — one row per team in a league: `id`, `league_id` (FK),
  `external_team_id` (Sleeper `roster_id` / FPL `entry_id`), `team_name`,
  `owner_name`, `is_mine` (bool).
- **`weekly_scores`** — one row per team per week: `league_id`, `team_id`, `week`,
  `points`, `opponent_team_id` (nullable — only populated for head-to-head leagues).
  For the FPL classic league's ~99 non-Max entries, `week` is always the latest synced
  week and `points` is the cumulative season total from the standings endpoint (see
  "Ingestion depth" below) rather than a true per-week breakdown.
- **`roster_players`** — one row per team per week per player: `league_id`, `team_id`,
  `week`, `player_external_id`, `player_name`, `is_starter`, `points` (that player's
  contribution that week). Populated at full depth for Sleeper and the FPL h2h league;
  for the FPL classic league, populated for Max's team only (see below).

Upsert-safe uniqueness, same pattern as the existing `teams`/`players` tables:
`unique(league_id, external_team_id)` on `fantasy_teams`,
`unique(league_id, team_id, week)` on `weekly_scores`, and
`unique(league_id, team_id, week, player_external_id)` on `roster_players`.

## Ingestion depth (why it's uneven across leagues)

| League | Teams/entries ingested | Weekly roster detail |
|---|---|---|
| Sleeper (both) | all teams | full, every week so far |
| FPL h2h (~20 entries) | all entries | full, every week so far |
| FPL classic (~100 entries) | all entries (standings) | **full only for Max's entry**; everyone else gets cumulative points + rank only |

The classic league's full history would be ~100 entries × ~20 gameweeks so far of
per-entry picks calls (up to ~2,000 HTTP calls) just to populate a standings table —
not worth it. The classic standings endpoint alone (a couple of paginated calls) gives
every entry's total points and rank, which is enough to show the full league table.

## Ingestion approach (services/ingestion)

This fills in an extension point that already exists but is stubbed out:
`FantasySourceAdapter.fetch_matchups()` on both `SleeperAdapter` and `FPLAdapter`
currently just raises `NotImplementedError("...requires a league ID")`.

- **Adapters gain an optional `league_id` constructor param** — `fetch_players()` /
  `fetch_teams()` (platform-wide) are unaffected; only the new league-scoped fetch uses it.
- **New adapter method** (replacing the `NotImplementedError` stub):
  `fetch_league_data() -> LeagueSyncResult`, a new dataclass carrying
  `teams: list[FantasyTeam]`, `weekly_scores: list[WeeklyScore]`,
  `roster_players: list[RosterEntry]` (new models alongside the existing `Player`/`Team`).
  - **Sleeper**: loop `GET /league/{id}/matchups/{week}` from week 1 through the
    current week (current week from `GET /state/nfl`).
  - **FPL h2h**: `GET /leagues-h2h/{id}/standings/` for the entry list, plus
    `GET /leagues-h2h-matches/?league={id}&page=N` for weekly opponent pairings, plus
    `GET /entry/{entry_id}/event/{week}/picks/` per entry per week for roster detail.
  - **FPL classic**: `GET /leagues-classic/{id}/standings/` (paginated) for every
    entry's current total + rank; `GET /entry/{FPL_ENTRY_ID}/event/{week}/picks/` for
    Max's own full weekly roster only. Current gameweek count comes from
    `bootstrap-static`'s `events` (`is_current`/`finished`).
- **"Which team is Max's"** resolved at sync time, not hardcoded per league: Sleeper by
  matching a roster's `owner_id` against `SLEEPER_USER_ID`; FPL trivially, since
  `FPL_ENTRY_ID` *is* the entry ID.
- **New `sync_league_data()` in `warehouse.py`**, separate from the existing
  `sync_all()` (which keeps syncing the platform-wide catalogs, unchanged). Same
  upsert-via-PostgREST approach. Same per-unit failure isolation as today's `sync_all`:
  one league failing doesn't block the others.
- **New `league_config.py`** reads the env vars below and builds the four
  `(adapter, league_id)` pairs to sync.
- No scheduler yet, consistent with the rest of this repo — invoked manually.

### Config (env vars, `services/ingestion/.env`)

```
SLEEPER_USER_ID=<sleeper account id>
SLEEPER_LEAGUE_IDS=<league1_id>,<league2_id>
FPL_ENTRY_ID=<max's fpl team/entry id>
FPL_H2H_LEAGUE_ID=<~20-person league id>
FPL_CLASSIC_LEAGUE_ID=<~100-person league id>
```

## Dashboard UI (apps/web)

- **Nav becomes real** (previously static/decorative): sidebar lists Max's actual
  leagues grouped by sport — NFL → 2 Sleeper leagues; Premier League → FPL h2h + FPL
  classic. A separate "Browse all players" link leads to the richer global table
  (below), kept off the primary nav.
- **`/leagues/[leagueId]`** — team-view page, one per league:
  - Week selector (prev/next), defaulting to the latest ingested week.
  - **My team**: roster for that week, each starter's points, team total.
  - **Head-to-head leagues** (both Sleeper leagues, FPL h2h): my team shown
    side-by-side with that week's opponent (same shape), plus a standings/all-teams
    table below.
  - **Classic league** (FPL, ~100 entries): no weekly opponent — instead the full
    league standings table (every entry, ranked by total points) underneath my team's
    roster.
- **`/players`** — the richer global player table, demoted from homepage to its own
  route: per-sport sections, search-by-name, sortable columns (name/price/points/form),
  filters (position/team/source), infinite scroll (25 rows/fetch) via a new
  general-purpose `fetchPlayers(...)` in `lib/players.ts` and extended `/api/players`
  query params (`sort`, `dir`, `q`, `position`, `team`, `source`, `offset`), plus a new
  `/api/players/filters?sport=` route for dropdown option values.
- **`/`** redirects to the first configured league's team-view.

## Error handling

Same graceful-degradation pattern used today: a failed warehouse query shows an inline
per-section error box rather than crashing the page; API routes return `502` on a
query failure.

## Out of scope (explicitly deferred, not forgotten)

- **Yahoo** (2 NFL leagues) — needs OAuth2 user auth, token storage/refresh; a separate,
  larger project, not "add an adapter."
- **Custom scoring engine / raw stat ingestion** — dropped in favor of ingesting
  platform-computed points (see "Scoring" above). Revisit only if a platform doesn't
  expose something we need.
- **A scheduler/cron for sync** — still manual, matches the rest of this repo's current state.
