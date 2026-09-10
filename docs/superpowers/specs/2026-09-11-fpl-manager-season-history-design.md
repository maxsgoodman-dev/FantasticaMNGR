# FPL Manager Season History Ingestion — Design

## Goal

Every FPL fantasy manager ("entry") has a season-by-season track record —
total points, overall rank, and rank percentile for every season they've
played FPL, going back to whenever they started. FPL's public
`GET /api/entry/{entry_id}/history/` endpoint exposes this under its
`past` array. No adapter in this repo fetches it today.

This is distinct from three things already in the warehouse:

- `public.players` / `fantasy_ingest.models.Player` — a live, current-season
  **Premier League player** catalog (not fantasy managers at all).
- `public.fpl_player_season_stats` (`0005_fpl_player_season_stats.sql`) —
  historical **real Premier League players'** per-season stats, backfilled
  from `services/fpl-planner`'s CSV archive.
- `public.roster_players` / `public.weekly_scores` (`0001_league_tables.sql`)
  — a **fantasy manager's current-season, gameweek-by-gameweek** performance
  within one league.

This new data is a **fantasy manager's own multi-season summary** —
independent of any league, and independent of which real players they
owned — one row per `(entry_id, season_name)`.

## Why a new table, not a column on an existing one

`fantasy_teams` (`0001_league_tables.sql`) is scoped to
`(source_id, external_league_id, external_team_id)` — a manager's row
there is specific to one league, one season (the current one). Bolting
season-history columns onto it would either (a) only fit the current
season, defeating the point, or (b) require denormalizing N historical
seasons into N sets of columns on a table whose whole key shape assumes
"one row = one team in one league right now." A new table with its own
`(entry_id, season_name)` key is the same reasoning
`fpl_player_season_stats`'s own design doc already used for a structurally
identical problem (season as part of identity, not something a sync
overwrites).

`entry_id` (not a join through `fantasy_teams`) is used as the key
because a manager's FPL-wide history has nothing to do with which league
this warehouse happens to have them rostered in — the same entry_id is
valid league-independently, and this table's own docstring will note
that `entry_id` is FPL's `entry_id`, textually identical to
`fantasy_teams.external_team_id` for `source_id = 'fpl'`, without an FK
(this table has no reason to cascade-delete with a league membership row;
a manager keeps their history even if a league disappears from this
warehouse).

## Adapter method

`FPLAdapter.fetch_entry_history(entry_id: str) -> list[dict]` — a new
method on `FPLAdapter`, not forced into `fetch_players`/`fetch_teams`/
`fetch_matchups` (per `base.py`'s interface, which is about a platform's
catalog/roster shape; a manager's own season history is a different kind
of data with no natural home there, same reasoning the h2h/classic league
methods already establish as adapter-specific extensions beyond the base
interface).

Returns `list[dict]` rather than a dataclass: the `past` season rows
have no other consumer/shape needing type safety like `Player`/`Team`/
`FantasyTeam` do (those are shared across every adapter's normalize
functions and eventually feed multiple call sites in `warehouse.py`).
A plain dict list keeps this additive without touching
`league_models.py`, and each row maps directly onto the new table's
columns 1:1, so a dataclass would just be a redundant restatement of the
same four fields.

```python
ENTRY_HISTORY_URL = "https://fantasy.premierleague.com/api/entry/{entry_id}/history/"

def _normalize_entry_history(raw_json: dict) -> list[dict]:
    """Pure normalize function — one dict per past season, no network call."""
    return [
        {
            "season_name": season["season_name"],
            "total_points": season["total_points"],
            "rank": season["rank"],
            "rank_percentage": season["rank_percentage"],
        }
        for season in raw_json.get("past", [])
    ]

def fetch_entry_history(self, entry_id: str) -> list[dict]:
    response = self._client.get(ENTRY_HISTORY_URL.format(entry_id=entry_id))
    response.raise_for_status()
    return _normalize_entry_history(response.json())
```

Follows this file's established convention (every other method in
`fpl.py` splits the HTTP fetch from a pure `_normalize_*`), verified live
this session: `GET .../api/entry/1/history/` returns exactly the
documented shape (`current`, `past`, `chips` keys; `past` entries have
`season_name`/`total_points`/`rank`/`rank_percentage`).

An entry with no FPL history before this season returns `"past": []` —
`_normalize_entry_history` returns `[]` for that, which is a normal,
valid outcome (a manager new to FPL this season), not an error condition,
and needs no special-casing beyond `.get("past", [])` already being safe
against a missing key too.

`chips` is not surfaced by this method at all — see "Out of scope."

## Table: `public.fpl_manager_season_history`

```sql
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
```

Column choices:

- **`entry_id text`** — matches `fantasy_teams.external_team_id`'s type
  (`text`, not `integer`), consistent with this repo's established
  "external ids are always text" convention (`0001_league_tables.sql`'s
  own comment: natural keys, not surrogate FKs). No foreign key to
  `fantasy_teams` — see above.
- **`rank bigint`** — FPL's rank values for popular/old seasons can
  exceed 2^31 in theory (multi-million-manager seasons already appear as
  ~9.6M in real data seen this session) and Postgres `integer` tops out
  at ~2.1B, so `bigint` is the safe choice with no realistic downside;
  matching FPL's field name `rank` (not `overall_rank`, which is what the
  *current*-season endpoint uses — a naming inconsistency in FPL's own
  API between `current` and `past` array shapes, not a bug in this
  design).
- **`rank` is nullable** — FPL's public JSON schema doesn't guarantee
  every historical season carries a rank (very old FPL seasons, or a
  manager who was banned/deleted mid-season, could plausibly return
  `null`); safer to allow it than to assume every row will always supply
  every field and fail the whole backfill on one edge case.
- **`rank_percentage numeric`** — FPL returns this as a JSON *string*
  (`"36"`, confirmed live: `"rank_percentage": "36"` in the real
  response), but it's a percentage value semantically, so it's cast to
  `numeric` at insert time rather than stored as `text` — matches this
  repo's existing convention of storing values in their semantic type
  even when the upstream JSON encodes them as strings (`_normalize_players`
  already does the analogous thing for `form`, casting `element["form"]`
  from FPL's string to `float`).
- **`total_points integer not null`** — every real `past` entry observed
  carries a `total_points` int; unlike `rank`, there's no known case
  where a season would lack a total-points figure once it exists in
  `past` at all, so this is `not null` while `rank`/`rank_percentage`
  are not.
- No `chips` column — see "Out of scope."
- No `source_id`/`sport_id` FK columns — same reasoning
  `fpl_player_season_stats` already documents: this table is FPL-only and
  entry-scoped by construction, so a constant-valued FK would add nothing
  a plain "this table is FPL's" fact (implicit in living entirely under
  one adapter's data) doesn't already convey.

RLS: enabled, one `for select using (true)` policy, no write policy —
identical pattern to every existing warehouse table
(`0001_league_tables.sql`, `0005_fpl_player_season_stats.sql`). This
table has no ongoing-sync writer either (see "Out of scope"), so like
`fpl_player_season_stats` it needs no write policy of any kind; the
backfill runs through the Supabase MCP tools' own elevated access.

## Backfill mechanism

Same reasoning and mechanism as `fpl_player_season_stats`'s precedent:
this is a one-off historical backfill of a different table shape from
the live, ongoing multi-platform sync `warehouse.py` exists to serve, so
it doesn't go through `warehouse.py`'s httpx/service-role-key path. It
also isn't a CSV read (unlike the `fpl_player_season_stats` precedent) —
it's a live HTTP call per entry — so unlike that precedent this backfill
uses the *adapter's own* `fetch_entry_history` (real network I/O, this
session's sandbox can reach `fantasy.premierleague.com` directly this
time — see root `CLAUDE.md`'s network-egress note for why that isn't
always true and shouldn't be assumed true in general) to fetch each of
the 125 known entry_ids' history, then batches the normalized rows into
`insert ... on conflict (entry_id, season_name) do update ...` statements
run through `mcp__supabase__execute_sql`, exactly like the precedent's
insert-via-MCP approach (no service role key needed).

**Isolate failures per entry.** `sync_all` (`warehouse.py`) and
`fetch_players` (`espn.py`) both establish the rule this repo follows:
one item failing partway through a batch must never lose everything that
already succeeded around it. `espn.py`'s docstring documents a *real*,
already-observed case of exactly this kind of failure (one ESPN team ID's
`/roster` 404s while others return 200) — the same category of risk
applies here: some of the 125 entry_ids could be deleted/banned FPL
accounts, could hit a transient 500, or (least likely, per FPL's public
API having no documented strict rate limit for read-only endpoints, but
still possible under 125 sequential calls) a 429. The backfill script
wraps each entry's `fetch_entry_history` call in its own try/except,
records `{"entry_id": ..., "error": str(error)}` for a failure, and
continues to the next entry rather than aborting the batch — matching
`sync_all`'s `except Exception as error: # noqa: BLE001` pattern and its
stated reasoning (isolate the batch from one bad item).

**Politeness.** 125 entries, sequential HTTP calls, no artificial delay
between them (per the task's explicit direction — FPL's public API has
no documented strict rate limit for these read-only endpoints, and 125
sequential GETs is not an aggressive volume). If a 429 is observed during
the actual backfill run, the script backs off (sleep and retry once)
and this document's "Verification" section below records whether that
occurred.

## Verification plan

1. Row count: should equal the sum, over all 125 entries, of how many
   `past` seasons each entry has actually played — inherently variable
   (a manager who started in 2014/15 has ~11 rows, a manager new this
   season has 0), so there's no single expected total to assert against
   in advance; sanity-checked after the fact as "row count is plausible
   given how many entries returned a non-empty `past`," not compared to
   a precomputed number.
2. Spot-check 2-3 real entry_ids' rows in the warehouse against a direct
   `curl` of `GET /api/entry/{id}/history/` for the same entry.
3. RLS: `set role anon; select ... from public.fpl_manager_season_history
   limit 3;` — same check `fpl_player_season_stats` used — expect real
   rows back, not a permission error or empty set.
4. `services/ingestion`'s full test suite (fresh venv) — 100% passing,
   including the new `_normalize_entry_history` unit tests.

## Out of scope (explicit)

- **Any change to Sleeper or ESPN adapters.** This capability is FPL-only
  — Sleeper/ESPN have no equivalent "manager's own multi-season summary"
  public endpoint documented or explored in this pass.
- **Any ongoing/scheduled sync of this table.** This is a one-off
  backfill against the 125 entry_ids known at the time this was written.
  A newly-discovered entry_id (a new league synced later) won't
  automatically get a history row — that would need this backfill
  re-run by hand, or a scheduled job wired up as a separate, later
  project (same "no scheduler yet" status the root `CLAUDE.md` already
  documents for `warehouse.py`'s own sync).
- **`current` (this-season gameweek-by-gameweek) data.** Explicitly
  already synced elsewhere (`weekly_scores`/`roster_players` via
  `fetch_classic_league_data`/`fetch_h2h_league_data`); redundant to
  re-derive from this endpoint's `current` array.
- **`chips` beyond capturing that the field exists.** The endpoint
  returns a `chips` array (season chip-usage history, usually empty for
  most managers — confirmed live: entry 1 returned two used chips this
  session). No column or table models it in this pass; a future slice
  that actually wants chip-usage data should design its own shape for
  the `(chip_name, event, entry_id)` grain that field carries, which is
  a different shape from the flat per-season row this table stores.
- **Any FK from `fpl_manager_season_history` to `fantasy_teams`.**
  Noted above — this data is meaningfully league-independent, so tying
  its lifetime to one league row's existence (via cascade delete) would
  be actively wrong, not just unnecessary.
- **Exposing this table in `apps/web`.** No UI change in this pass.
