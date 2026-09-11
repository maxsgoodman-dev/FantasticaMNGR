# Unified Gameweek Matchup View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FPL H2H league page's fragmented layout (stat tiles, Matchup Prep card, Next Gameweek Preview card, Head-to-Head Comparison chart+tables) with one `GameweekMatchupCard` component that renders the whole head-to-head picture for whichever week the user has navigated to — with positions, position-based sorting, and richer per-week stats (transfers, chip, bench points, team value, overall rank, Impact %) that were previously either missing or scattered.

**Architecture:** The `fetch_h2h_league_data` sync already calls FPL's `/entry/{id}/event/{week}/picks/` for every team, every week — it just throws away everything except `points`. A new `EntryGameweekStat` model captures the rest of that same response (transfers, chip, bench points, team value, rank) into a new table. Player position already sits unused in `fpl_sheet_player_data`, already joined into rosters — this pass just surfaces it and sorts by it. `apps/web/lib/leagues.ts`'s `fetchLeagueTeamView` is restructured around one `weekState: "future" | "played"` branch instead of the two separate fetch paths (`fetchNextGameweekPreview` vs. the main current-week gates) it has today.

**Tech Stack:** Python (pytest, httpx) for `services/ingestion`; Supabase Postgres (RLS, PostgREST) for the warehouse; TypeScript/Next.js (App Router, `@supabase/supabase-js`) for `apps/web`. `apps/web` changes are verified via `npm run build` (type-checking) plus live browser checks, not unit tests — this repo's established convention.

---

## Task 1: `EntryGameweekStat` model

**Files:**
- Modify: `services/ingestion/fantasy_ingest/league_models.py`
- Test: `services/ingestion/tests/test_league_models.py`

- [ ] **Step 1: Write the failing tests**

Add to `services/ingestion/tests/test_league_models.py`, changing the import line:

```python
from fantasy_ingest.league_models import (
    EntryGameweekStat,
    FantasyTeam,
    H2HFixture,
    LeagueSyncResult,
    RosterEntry,
    WeeklyScore,
)
```

Add these two tests anywhere after `test_h2h_fixture_opponent_defaults_to_none`:

```python
def test_entry_gameweek_stat_fields():
    stat = EntryGameweekStat(
        team_external_id="1",
        week=4,
        event_transfers=2,
        event_transfers_cost=0,
        points_on_bench=15,
        bank=0.2,
        team_value=100.4,
        overall_rank=2700348,
        active_chip="3xc",
    )
    assert stat.team_external_id == "1"
    assert stat.week == 4
    assert stat.event_transfers == 2
    assert stat.event_transfers_cost == 0
    assert stat.points_on_bench == 15
    assert stat.bank == 0.2
    assert stat.team_value == 100.4
    assert stat.overall_rank == 2700348
    assert stat.active_chip == "3xc"


def test_entry_gameweek_stat_chip_and_rank_default_to_none():
    stat = EntryGameweekStat(
        team_external_id="1",
        week=4,
        event_transfers=0,
        event_transfers_cost=0,
        points_on_bench=0,
        bank=0.0,
        team_value=100.0,
        overall_rank=None,
    )
    assert stat.overall_rank is None
    assert stat.active_chip is None
```

Replace `test_league_sync_result_bundles_the_four_lists` and
`test_league_sync_result_defaults_to_empty_lists` with:

```python
def test_league_sync_result_bundles_the_five_lists():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    score = WeeklyScore(team_external_id="1", week=1, points=10.0)
    entry = RosterEntry(
        team_external_id="1", week=1, player_external_id="101", player_name="P", is_starter=True, points=5.0
    )
    fixture = H2HFixture(team_external_id="1", week=2, opponent_external_id="2")
    stat = EntryGameweekStat(
        team_external_id="1",
        week=1,
        event_transfers=1,
        event_transfers_cost=0,
        points_on_bench=3,
        bank=0.5,
        team_value=100.5,
        overall_rank=100,
    )

    result = LeagueSyncResult(
        teams=[team],
        weekly_scores=[score],
        roster_players=[entry],
        h2h_fixtures=[fixture],
        entry_gameweek_stats=[stat],
    )

    assert result.teams == [team]
    assert result.weekly_scores == [score]
    assert result.roster_players == [entry]
    assert result.h2h_fixtures == [fixture]
    assert result.entry_gameweek_stats == [stat]


def test_league_sync_result_defaults_to_empty_lists():
    result = LeagueSyncResult()
    assert result.teams == []
    assert result.weekly_scores == []
    assert result.roster_players == []
    assert result.h2h_fixtures == []
    assert result.entry_gameweek_stats == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && .venv/bin/pytest tests/test_league_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'EntryGameweekStat'`

- [ ] **Step 3: Implement `EntryGameweekStat` and extend `LeagueSyncResult`**

In `services/ingestion/fantasy_ingest/league_models.py`, add this dataclass after `H2HFixture` (before `LeagueSyncResult`):

```python
@dataclass
class EntryGameweekStat:
    team_external_id: str
    week: int
    event_transfers: int
    event_transfers_cost: int
    points_on_bench: int
    bank: float
    team_value: float
    overall_rank: int | None
    active_chip: str | None = None
```

Replace the existing `LeagueSyncResult` class with:

```python
@dataclass
class LeagueSyncResult:
    teams: list[FantasyTeam] = field(default_factory=list)
    weekly_scores: list[WeeklyScore] = field(default_factory=list)
    roster_players: list[RosterEntry] = field(default_factory=list)
    h2h_fixtures: list[H2HFixture] = field(default_factory=list)
    entry_gameweek_stats: list[EntryGameweekStat] = field(default_factory=list)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_league_models.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/league_models.py services/ingestion/tests/test_league_models.py
git commit -m "Add EntryGameweekStat model, extend LeagueSyncResult with entry_gameweek_stats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `_normalize_entry_gameweek_stat` pure function

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing tests**

In `services/ingestion/tests/test_fpl_adapter.py`, update the two import lines:

```python
from fantasy_ingest.adapters.fpl import (
    FPLAdapter,
    _current_gameweek,
    _normalize_classic_standings,
    _normalize_entry_gameweek_stat,
    _normalize_entry_history,
    _normalize_h2h_fixtures,
    _normalize_h2h_matches,
    _normalize_h2h_teams,
    _normalize_next_week_projections,
    _normalize_picks,
    _normalize_players,
    _normalize_projections,
    _normalize_teams,
)
from fantasy_ingest.league_models import EntryGameweekStat, FantasyTeam, H2HFixture, RosterEntry, WeeklyScore
```

Add this fixture and these tests directly after the existing `PICKS_FIXTURE`/`LIVE_POINTS_FIXTURE`/`NAMES_BY_ID_FIXTURE` block (after `test_normalize_picks_starting_xi_is_position_11_or_lower`):

```python
# Real shape confirmed live, 2026-09-09, against
# GET https://fantasy.premierleague.com/api/entry/{entry_id}/event/{week}/picks/
FULL_PICKS_FIXTURE = {
    "active_chip": "3xc",
    "picks": [
        {"element": 101, "position": 1, "multiplier": 3, "is_captain": True},
    ],
    "entry_history": {
        "event": 4,
        "points": 65,
        "event_transfers": 2,
        "event_transfers_cost": 0,
        "points_on_bench": 15,
        "bank": 2,
        "value": 1004,
        "overall_rank": 2700348,
    },
}

FULL_PICKS_FIXTURE_NO_CHIP = {
    "active_chip": None,
    "picks": [
        {"element": 101, "position": 1, "multiplier": 1, "is_captain": False},
    ],
    "entry_history": {
        "event": 4,
        "points": 40,
        "event_transfers": 0,
        "event_transfers_cost": 0,
        "points_on_bench": 4,
        "bank": 0,
        "value": 998,
        "overall_rank": None,
    },
}


def test_normalize_entry_gameweek_stat_extracts_entry_history_and_active_chip():
    stat = _normalize_entry_gameweek_stat(FULL_PICKS_FIXTURE, team_external_id="111", week=4)

    assert stat == EntryGameweekStat(
        team_external_id="111",
        week=4,
        event_transfers=2,
        event_transfers_cost=0,
        points_on_bench=15,
        bank=0.2,
        team_value=100.4,
        overall_rank=2700348,
        active_chip="3xc",
    )


def test_normalize_entry_gameweek_stat_handles_no_chip_and_no_overall_rank():
    stat = _normalize_entry_gameweek_stat(FULL_PICKS_FIXTURE_NO_CHIP, team_external_id="111", week=4)

    assert stat.active_chip is None
    assert stat.overall_rank is None
    assert stat.bank == 0.0
    assert stat.team_value == 99.8
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py -v -k entry_gameweek_stat`
Expected: FAIL — `ImportError: cannot import name '_normalize_entry_gameweek_stat'`

- [ ] **Step 3: Implement `_normalize_entry_gameweek_stat`**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, update the `league_models` import to add `EntryGameweekStat`:

```python
from fantasy_ingest.league_models import (
    EntryGameweekStat,
    FantasyTeam,
    H2HFixture,
    LeagueSyncResult,
    RosterEntry,
    WeeklyScore,
)
```

Add this function directly after `_normalize_picks`:

```python
def _normalize_entry_gameweek_stat(picks_json: dict, team_external_id: str, week: int) -> EntryGameweekStat:
    """Extract the per-team, per-week manager stats already present on the
    same picks response _normalize_picks reads — event_transfers, chip
    used, bench points, team value, overall rank. fetch_h2h_league_data
    already fetches this exact response for every team, every week; this
    is the only place the rest of it (previously discarded) is read. See
    docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.

    bank/value arrive from FPL as tenths of a £m, same convention as
    now_cost elsewhere in this adapter — divided by 10 here.
    """
    entry_history = picks_json["entry_history"]
    return EntryGameweekStat(
        team_external_id=team_external_id,
        week=week,
        event_transfers=entry_history["event_transfers"],
        event_transfers_cost=entry_history["event_transfers_cost"],
        points_on_bench=entry_history["points_on_bench"],
        bank=entry_history["bank"] / 10,
        team_value=entry_history["value"] / 10,
        overall_rank=entry_history.get("overall_rank"),
        active_chip=picks_json.get("active_chip"),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py -v -k entry_gameweek_stat`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full FPL adapter test suite**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests — additive only)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add _normalize_entry_gameweek_stat: extract transfers/chip/rank from picks response

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire `EntryGameweekStat` into `fetch_h2h_league_data`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py:358-396` (the `fetch_h2h_league_data` method)
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing test**

Add this test to `services/ingestion/tests/test_fpl_adapter.py`, directly after `test_fetch_h2h_league_data_includes_h2h_fixtures_for_every_week`:

```python
def test_fetch_h2h_league_data_includes_entry_gameweek_stats_for_every_team():
    events_one_week = [{"id": 1, "is_current": True, "finished": False}]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": events_one_week})
        if path.endswith("/leagues-h2h/H1/standings/"):
            return httpx.Response(200, json={"standings": {**H2H_STANDINGS_PAGE["standings"], "has_next": False}})
        if path.endswith("/leagues-h2h-matches/league/H1/"):
            return httpx.Response(200, json={**H2H_MATCHES_PAGE, "has_next": False})
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(200, json=FULL_PICKS_FIXTURE)
        if path.endswith("/entry/222/event/1/picks/"):
            return httpx.Response(200, json=FULL_PICKS_FIXTURE_NO_CHIP)
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_h2h_league_data(league_id="H1", my_entry_id="111")

    stats_by_team = {stat.team_external_id: stat for stat in result.entry_gameweek_stats}
    assert stats_by_team["111"].active_chip == "3xc"
    assert stats_by_team["111"].week == 1
    assert stats_by_team["222"].active_chip is None
    assert stats_by_team["222"].overall_rank is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py::test_fetch_h2h_league_data_includes_entry_gameweek_stats_for_every_team -v`
Expected: FAIL — `result.entry_gameweek_stats` is empty

- [ ] **Step 3: Wire `_normalize_entry_gameweek_stat` into `fetch_h2h_league_data`**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, find the method's current body (around line 358). Replace:

```python
        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            try:
                live_response = self._client.get(EVENT_LIVE_URL.format(week=week))
                live_response.raise_for_status()
            except httpx.HTTPStatusError as error:
                print(f"fpl: skipping league {league_id} week {week} (live points): {error}", file=sys.stderr)
                continue
            live = live_response.json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}

            for team in teams:
                try:
                    picks_response = self._client.get(ENTRY_PICKS_URL.format(entry_id=team.external_id, week=week))
                    picks_response.raise_for_status()
                except httpx.HTTPStatusError as error:
                    print(
                        f"fpl: skipping league {league_id} week {week} for entry {team.external_id}: {error}",
                        file=sys.stderr,
                    )
                    continue
                picks = picks_response.json()
                roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, team.external_id, week))

        return LeagueSyncResult(
            teams=teams, weekly_scores=weekly_scores, roster_players=roster_players, h2h_fixtures=h2h_fixtures
        )
```

with:

```python
        roster_players: list[RosterEntry] = []
        entry_gameweek_stats: list[EntryGameweekStat] = []
        for week in range(1, current_week + 1):
            try:
                live_response = self._client.get(EVENT_LIVE_URL.format(week=week))
                live_response.raise_for_status()
            except httpx.HTTPStatusError as error:
                print(f"fpl: skipping league {league_id} week {week} (live points): {error}", file=sys.stderr)
                continue
            live = live_response.json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}

            for team in teams:
                try:
                    picks_response = self._client.get(ENTRY_PICKS_URL.format(entry_id=team.external_id, week=week))
                    picks_response.raise_for_status()
                except httpx.HTTPStatusError as error:
                    print(
                        f"fpl: skipping league {league_id} week {week} for entry {team.external_id}: {error}",
                        file=sys.stderr,
                    )
                    continue
                picks = picks_response.json()
                roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, team.external_id, week))
                entry_gameweek_stats.append(_normalize_entry_gameweek_stat(picks, team.external_id, week))

        return LeagueSyncResult(
            teams=teams,
            weekly_scores=weekly_scores,
            roster_players=roster_players,
            h2h_fixtures=h2h_fixtures,
            entry_gameweek_stats=entry_gameweek_stats,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py::test_fetch_h2h_league_data_includes_entry_gameweek_stats_for_every_team -v`
Expected: PASS

- [ ] **Step 5: Run the full FPL adapter test suite**

Run: `.venv/bin/pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Wire entry_gameweek_stats into fetch_h2h_league_data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `fpl_entry_gameweek_stats` migration

**Files:**
- Create: `supabase/migrations/0011_fpl_entry_gameweek_stats.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Using the Supabase MCP tool, call `apply_migration` with:
- `project_id`: `wsmegxfnmkhaailxhuih` (confirm via `list_projects` if this has changed)
- `name`: `fpl_entry_gameweek_stats`
- `query`: the exact SQL from Step 1

- [ ] **Step 3: Verify no new lints**

Call the Supabase MCP `get_advisors` tool with `type: "security"` for the same project.
Expected: `{"lints": []}` — no new findings from this migration.

- [ ] **Step 4: Verify the table**

Call `execute_sql` with:
```sql
select count(*) from public.fpl_entry_gameweek_stats;
```
Expected: `[{"count": 0}]` — table exists, empty.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_fpl_entry_gameweek_stats.sql
git commit -m "Add fpl_entry_gameweek_stats table migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Persist `entry_gameweek_stats` via `sync_league_data`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/warehouse.py`
- Test: `services/ingestion/tests/test_warehouse.py`

- [ ] **Step 1: Write the failing tests**

In `services/ingestion/tests/test_warehouse.py`, update the `league_models` import to add `EntryGameweekStat`:

```python
from fantasy_ingest.league_models import EntryGameweekStat, FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
```

Update the three existing exact-dict assertions, adding `"entry_gameweek_stats": 0` to each:

In `test_sync_league_data_posts_league_teams_scores_and_roster`, change:
```python
    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
```
to:
```python
    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0, "entry_gameweek_stats": 0}
```

In `test_sync_league_data_posts_h2h_fixtures_when_present`, change:
```python
    assert counts["h2h_fixtures"] == 1
```
to (add a line, don't remove the existing one):
```python
    assert counts["h2h_fixtures"] == 1
    assert counts["entry_gameweek_stats"] == 0
```

In `test_sync_all_leagues_isolates_a_failing_league`, change:
```python
    assert results["sleeper:L1"] == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
```
to:
```python
    assert results["sleeper:L1"] == {
        "teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0, "entry_gameweek_stats": 0
    }
```

In `test_sync_league_data_always_posts_league_row_but_skips_empty_child_tables`, change:
```python
    assert counts == {"teams": 0, "weekly_scores": 0, "roster_players": 0, "h2h_fixtures": 0}
```
to:
```python
    assert counts == {"teams": 0, "weekly_scores": 0, "roster_players": 0, "h2h_fixtures": 0, "entry_gameweek_stats": 0}
```

Add this new test directly after `test_sync_league_data_posts_h2h_fixtures_when_present`:

```python
def test_sync_league_data_posts_entry_gameweek_stats_when_present(recorded_requests):
    client = make_client(recorded_requests)
    result = LeagueSyncResult(
        entry_gameweek_stats=[
            EntryGameweekStat(
                team_external_id="1",
                week=4,
                event_transfers=2,
                event_transfers_cost=0,
                points_on_bench=15,
                bank=0.2,
                team_value=100.4,
                overall_rank=2700348,
                active_chip="3xc",
            )
        ]
    )

    counts = sync_league_data(SLEEPER_LEAGUE, result, client=client)

    assert counts["entry_gameweek_stats"] == 1
    paths = [request.url.path for request in recorded_requests]
    assert paths == ["/rest/v1/leagues", "/rest/v1/fpl_entry_gameweek_stats"]

    stats_request = recorded_requests[1]
    assert "on_conflict=source_id,external_league_id,external_team_id,week" in str(stats_request.url)


def test_sync_league_data_entry_gameweek_stat_row_shape(recorded_requests):
    import json

    client = make_client(recorded_requests)
    result = LeagueSyncResult(
        entry_gameweek_stats=[
            EntryGameweekStat(
                team_external_id="1",
                week=4,
                event_transfers=2,
                event_transfers_cost=4,
                points_on_bench=15,
                bank=0.2,
                team_value=100.4,
                overall_rank=2700348,
                active_chip="3xc",
            )
        ]
    )

    sync_league_data(SLEEPER_LEAGUE, result, client=client)

    row = json.loads(recorded_requests[1].content)[0]
    assert row["source_id"] == "sleeper"
    assert row["external_league_id"] == "L1"
    assert row["external_team_id"] == "1"
    assert row["week"] == 4
    assert row["event_transfers"] == 2
    assert row["event_transfers_cost"] == 4
    assert row["points_on_bench"] == 15
    assert row["bank"] == 0.2
    assert row["team_value"] == 100.4
    assert row["overall_rank"] == 2700348
    assert row["active_chip"] == "3xc"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_warehouse.py -v -k "sync_league_data or sync_all_leagues"`
Expected: FAIL — dict-mismatch on the four modified assertions, `KeyError`/index errors on the two new tests

- [ ] **Step 3: Implement `_entry_gameweek_stat_rows` and wire it into `sync_league_data`**

In `services/ingestion/fantasy_ingest/warehouse.py`, add this function directly after `_h2h_fixture_rows`:

```python
def _entry_gameweek_stat_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": stat.team_external_id,
            "week": stat.week,
            "event_transfers": stat.event_transfers,
            "event_transfers_cost": stat.event_transfers_cost,
            "points_on_bench": stat.points_on_bench,
            "bank": stat.bank,
            "team_value": stat.team_value,
            "overall_rank": stat.overall_rank,
            "active_chip": stat.active_chip,
        }
        for stat in result.entry_gameweek_stats
    ]
```

Find `sync_league_data`'s body. Replace:

```python
        fixture_rows = _h2h_fixture_rows(league, result)
        if fixture_rows:
            response = client.post(
                "/h2h_fixtures?on_conflict=source_id,external_league_id,external_team_id,week", json=fixture_rows
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {
        "teams": len(team_rows),
        "weekly_scores": len(score_rows),
        "roster_players": len(roster_rows),
        "h2h_fixtures": len(fixture_rows),
    }
```

with:

```python
        fixture_rows = _h2h_fixture_rows(league, result)
        if fixture_rows:
            response = client.post(
                "/h2h_fixtures?on_conflict=source_id,external_league_id,external_team_id,week", json=fixture_rows
            )
            response.raise_for_status()

        entry_stat_rows = _entry_gameweek_stat_rows(league, result)
        if entry_stat_rows:
            response = client.post(
                "/fpl_entry_gameweek_stats?on_conflict=source_id,external_league_id,external_team_id,week",
                json=entry_stat_rows,
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {
        "teams": len(team_rows),
        "weekly_scores": len(score_rows),
        "roster_players": len(roster_rows),
        "h2h_fixtures": len(fixture_rows),
        "entry_gameweek_stats": len(entry_stat_rows),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_warehouse.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full ingestion test suite**

Run: `.venv/bin/pytest -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/warehouse.py services/ingestion/tests/test_warehouse.py
git commit -m "Persist entry_gameweek_stats via sync_league_data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Note: same as `h2h_fixtures`, this requires no change to `sync_leagues.py` — it already flows through `sync_all_leagues` → `sync_league_data`, and `fetch_h2h_league_data`'s existing per-week loop means the next scheduled sync backfills every already-elapsed week automatically.

---

## Task 6: Web data layer — `EntryGameweekStatRow`, `fetchEntryGameweekStats`, position on the FPL sheet join

**Files:**
- Modify: `apps/web/lib/leagues.ts`

- [ ] **Step 1: Add `EntryGameweekStatRow` type and `fetchEntryGameweekStats`**

In `apps/web/lib/leagues.ts`, find the `H2HFixtureDbRow` interface (just before `NextGameweekPreview`). Insert the following directly after it, before `export interface NextGameweekPreview`:

```typescript
interface EntryGameweekStatDbRow {
  external_team_id: string;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
  bank: number;
  team_value: number;
  overall_rank: number | null;
  active_chip: string | null;
}

export interface EntryGameweekStatRow {
  externalTeamId: string;
  eventTransfers: number;
  eventTransfersCost: number;
  pointsOnBench: number;
  bank: number;
  teamValue: number;
  overallRank: number | null;
  activeChip: string | null;
}

function fromEntryGameweekStatRow(row: EntryGameweekStatDbRow): EntryGameweekStatRow {
  return {
    externalTeamId: row.external_team_id,
    eventTransfers: row.event_transfers,
    eventTransfersCost: row.event_transfers_cost,
    pointsOnBench: row.points_on_bench,
    bank: row.bank,
    teamValue: row.team_value,
    overallRank: row.overall_rank,
    activeChip: row.active_chip,
  };
}

// FPL H2H-only — this table is populated from the same picks response
// fetch_h2h_league_data already calls per team per week; Sleeper/ESPN
// and the FPL classic league have no equivalent row for this table. See
// docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.
async function fetchEntryGameweekStats(
  sourceId: string,
  externalLeagueId: string,
  externalTeamIds: string[],
  week: number
): Promise<Map<string, EntryGameweekStatRow>> {
  if (externalTeamIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("fpl_entry_gameweek_stats")
    .select(
      "external_team_id, event_transfers, event_transfers_cost, points_on_bench, bank, team_value, overall_rank, active_chip"
    )
    .eq("source_id", sourceId)
    .eq("external_league_id", externalLeagueId)
    .eq("week", week)
    .in("external_team_id", externalTeamIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const rows = (data ?? []).map(fromEntryGameweekStatRow);
  return new Map(rows.map((row) => [row.externalTeamId, row]));
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully. `fetchEntryGameweekStats` isn't called anywhere yet — this step just confirms the new code itself is valid (an unused non-exported function would fail lint; since it isn't called yet, temporarily export it to avoid an unused-declaration failure):

Change `async function fetchEntryGameweekStats(` to `export async function fetchEntryGameweekStats(` for now — Task 7 wires it in and removes the `export` again if it turns out to only be used within this same file (check at that point; if it's only used inside `leagues.ts` itself, it doesn't need `export` once called).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/leagues.ts
git commit -m "Add EntryGameweekStatRow and fetchEntryGameweekStats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Rewrite `fetchLeagueTeamView` around one `weekState` branch

**Files:**
- Modify: `apps/web/lib/leagues.ts`

This is the largest data-layer change: it replaces the `isCurrentHeadToHeadWeek`-gated `fetchNextGameweekPreview` side-path with one function that computes `weekState` up front and branches on it, extends the reachable week range to `latestWeek + 1`, and makes `fplSheetData` (needed for position on every roster row) available for any FPL week, not just the current one.

- [ ] **Step 1: Remove `NextGameweekPreview` and `fetchNextGameweekPreview`, add `fetchFutureOpponent`**

Find and delete the entire `NextGameweekPreview` interface and `fetchNextGameweekPreview` function (from the `export interface NextGameweekPreview {` line through that function's closing `}`, right before the `// "Standings" = ...` comment).

Replace them with:

```typescript
// FPL H2H-only. "Their team" here is the opponent's *current* squad — a
// preview, not their locked lineup for next week, since FPL's API
// genuinely doesn't expose a future gameweek's picks before its
// deadline. See
// docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
async function fetchFutureOpponent(
  league: League,
  myTeam: FantasyTeam,
  teams: FantasyTeam[],
  week: number
): Promise<FantasyTeam | null> {
  const { data, error } = await supabase
    .from("h2h_fixtures")
    .select("opponent_external_team_id")
    .eq("source_id", league.sourceId)
    .eq("external_league_id", league.externalLeagueId)
    .eq("external_team_id", myTeam.externalTeamId)
    .eq("week", week)
    .maybeSingle();

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const opponentExternalTeamId = (data as H2HFixtureDbRow | null)?.opponent_external_team_id ?? null;
  if (!opponentExternalTeamId) {
    return null;
  }

  return teams.find((team) => team.externalTeamId === opponentExternalTeamId) ?? null;
}
```

- [ ] **Step 2: Update `LeagueTeamView`**

Find the `LeagueTeamView` interface. Replace:

```typescript
  matchupPreview: Map<string, MatchupPreviewRow> | null;
  fplSheetData: Map<string, FplSheetPlayerRow> | null;
  nextGameweekPreview: NextGameweekPreview | null;
}
```

with:

```typescript
  weekState: "future" | "played";
  matchupPreview: Map<string, MatchupPreviewRow> | null;
  fplSheetData: Map<string, FplSheetPlayerRow> | null;
  projections: Map<string, number> | null;
  entryGameweekStats: Map<string, EntryGameweekStatRow> | null;
}
```

(Leave every field above `matchupPreview` — `league`, `week`, `latestWeek`, `myTeam`, `myScore`, `myRoster`, `opponentTeam`, `opponentScore`, `opponentRoster`, `standings` — unchanged.)

- [ ] **Step 3: Rewrite `fetchLeagueTeamView`**

Replace the entire `fetchLeagueTeamView` function body with:

```typescript
export async function fetchLeagueTeamView(leagueId: number, requestedWeek?: number): Promise<LeagueTeamView> {
  const league = await fetchLeagueById(leagueId);
  if (!league) {
    throw new Error(`no league found for id ${leagueId}`);
  }

  const teams = await fetchTeams(league.sourceId, league.externalLeagueId);
  const myTeam = teams.find((team) => team.isMine);
  if (!myTeam) {
    throw new Error(`no team flagged as mine in league ${leagueId} — has this league been synced yet?`);
  }

  const myWeeklyScores = await fetchWeeklyScoresForTeam(
    league.sourceId,
    league.externalLeagueId,
    myTeam.externalTeamId
  );
  const latestWeek = myWeeklyScores.reduce((max, score) => Math.max(max, score.week), 0);

  // Next-gameweek preview is FPL H2H-only (see fetchFutureOpponent's own
  // comment) — every other league format/source stays capped at
  // latestWeek, same as before this feature existed.
  const maxReachableWeek =
    league.sourceId === "fpl" && league.format === "head_to_head" ? latestWeek + 1 : latestWeek;
  const week = Math.min(Math.max(requestedWeek ?? latestWeek, 1), Math.max(maxReachableWeek, 1));
  const weekState: "future" | "played" = week > latestWeek ? "future" : "played";

  const myScore = myWeeklyScores.find((score) => score.week === week) ?? null;

  let opponentTeam: FantasyTeam | null = null;
  let opponentScore: WeeklyScoreRow | null = null;

  if (weekState === "played" && league.format === "head_to_head" && myScore?.opponentExternalTeamId) {
    opponentTeam = teams.find((team) => team.externalTeamId === myScore.opponentExternalTeamId) ?? null;
    if (opponentTeam) {
      const opponentWeeklyScores = await fetchWeeklyScoresForTeam(
        league.sourceId,
        league.externalLeagueId,
        opponentTeam.externalTeamId
      );
      opponentScore = opponentWeeklyScores.find((score) => score.week === week) ?? null;
    }
  } else if (weekState === "future" && league.format === "head_to_head") {
    opponentTeam = await fetchFutureOpponent(league, myTeam, teams, week);
  }

  // A future week has no locked lineup yet (FPL 404s it until the
  // deadline passes) — both rosters preview the most recent *played*
  // week's squad instead.
  const rosterWeek = weekState === "future" ? latestWeek : week;
  let myRoster = await fetchRoster(league.sourceId, league.externalLeagueId, myTeam.externalTeamId, rosterWeek);
  let opponentRoster: RosterPlayerRow[] = opponentTeam
    ? await fetchRoster(league.sourceId, league.externalLeagueId, opponentTeam.externalTeamId, rosterWeek)
    : [];

  const rosterPlayerIds = [
    ...new Set([...myRoster, ...opponentRoster].map((player) => player.playerExternalId)),
  ];
  const playerValues = await fetchPlayerValues(league.sourceId, league.externalLeagueId, rosterPlayerIds);
  const withPlayerValue = (roster: RosterPlayerRow[]): RosterPlayerRow[] =>
    roster.map((player) => ({
      ...player,
      playerValue: playerValues.get(player.playerExternalId) ?? null,
    }));
  myRoster = withPlayerValue(myRoster);
  opponentRoster = withPlayerValue(opponentRoster);

  const standings = await fetchStandings(league.sourceId, league.externalLeagueId, teams);
  const teamStrengths = await fetchTeamStrength(
    league.sourceId,
    league.externalLeagueId,
    standings.map((row) => row.team.externalTeamId)
  );
  const standingsWithStrength: StandingsRow[] = standings.map((row) => ({
    ...row,
    strength: teamStrengths.get(row.team.externalTeamId) ?? null,
  }));

  // Matchup prep (rest-of-week projected score, win probability, weak
  // spots, tough fixtures, opponent scouting) only makes sense for the
  // actual current, in-progress week's head-to-head matchup — a genuinely
  // past week is settled history, and a future week has no in-progress
  // score to project the "rest of" yet. See
  // docs/superpowers/specs/2026-09-10-matchup-prep-design.md.
  const isCurrentPlayedWeek = weekState === "played" && week === latestWeek && opponentTeam !== null;

  const matchupPreview = isCurrentPlayedWeek
    ? await fetchMatchupPreview(
        league.sourceId,
        league.externalLeagueId,
        [myTeam.externalTeamId, opponentTeam!.externalTeamId],
        week
      )
    : null;

  // Position (for sorting) and next-fixture data apply to ANY FPL week,
  // played or future — not just the current one, unlike matchupPreview
  // above. See
  // docs/superpowers/specs/2026-09-11-unified-gameweek-matchup-design.md.
  const fplSheetData =
    league.sourceId === "fpl" && rosterPlayerIds.length > 0 ? await fetchFplSheetData(rosterPlayerIds) : null;

  const projections =
    weekState === "future"
      ? await fetchPlayerProjections(league.sourceId, league.sportId, week, rosterPlayerIds)
      : null;

  const entryGameweekStats =
    weekState === "played" && league.sourceId === "fpl" && league.format === "head_to_head"
      ? await fetchEntryGameweekStats(
          league.sourceId,
          league.externalLeagueId,
          opponentTeam ? [myTeam.externalTeamId, opponentTeam.externalTeamId] : [myTeam.externalTeamId],
          week
        )
      : null;

  return {
    league,
    week,
    latestWeek,
    weekState,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings: standingsWithStrength,
    matchupPreview,
    fplSheetData,
    projections,
    entryGameweekStats,
  };
}
```

`fetchEntryGameweekStats` is now called from within this same file (it isn't imported by `page.tsx` — it only reaches `page.tsx` via the `LeagueTeamView.entryGameweekStats` field). Remove the `export` keyword that was added to it as a temporary measure in Task 6, Step 2.

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully. If it fails because `page.tsx` still imports `NextGameweekPreviewCard`/`type NextGameweekPreviewPlayerRow` or destructures `nextGameweekPreview` from `view`, that's expected — Task 9 fixes `page.tsx`. For this task, temporarily confirm compilation of `leagues.ts` in isolation by checking `npx tsc --noEmit` output mentions only `page.tsx`/`NextGameweekPreviewCard.tsx` as the remaining error sources, not `leagues.ts` itself. Do not modify `page.tsx` or delete any component files in this task — that's Tasks 9 and 10.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/leagues.ts
git commit -m "Rewrite fetchLeagueTeamView around a single weekState branch

Replaces the separate fetchNextGameweekPreview side-path with one
future/played branch covering opponent lookup, roster week, and which
enrichment queries (matchupPreview, fplSheetData, projections,
entryGameweekStats) apply to which state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(This commit will leave `apps/web` failing `npm run build` until Tasks 9–10 update `page.tsx` and delete the old components — that's expected and is resolved within this same plan, not left broken at the end.)

---

## Task 8: `GameweekMatchupCard` component

**Files:**
- Create: `apps/web/components/ui/GameweekMatchupCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Card from "./Card";
import SectionHeader from "./SectionHeader";
import Avatar from "./Avatar";
import Badge from "./Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "./Table";
import type { TeamStrengthRow } from "@/lib/leagues";

export interface WeakSpot {
  playerName: string;
  tradeValue: number;
}

export interface ToughFixture {
  playerName: string;
  difficultyScore: number;
}

export interface GameweekMatchupPlayerRow {
  playerExternalId: string;
  playerName: string;
  position: "GKP" | "DEF" | "MID" | "FWD" | null;
  isStarter: boolean;
  points: number | null;
  projectedPoints: number | null;
  nextFixture: string | null;
  consistency: number | null;
  tradeValue: number | null;
  impactPercent: number | null;
}

export interface GameweekMatchupTeamSummary {
  teamName: string;
  score: number | null;
  eventTransfers: number | null;
  eventTransfersCost: number | null;
  pointsOnBench: number | null;
  teamValue: number | null;
  overallRank: number | null;
  activeChip: string | null;
}

export interface GameweekMatchupInsights {
  weakSpots: WeakSpot[];
  toughFixtures: ToughFixture[];
  opponentScouting: TeamStrengthRow | null;
}

const POSITION_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

function positionRank(position: GameweekMatchupPlayerRow["position"]): number {
  return position != null ? POSITION_ORDER[position] ?? 4 : 4;
}

function sortRoster(roster: GameweekMatchupPlayerRow[]): GameweekMatchupPlayerRow[] {
  return [...roster].sort((a, b) => {
    if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
    const positionDiff = positionRank(a.position) - positionRank(b.position);
    if (positionDiff !== 0) return positionDiff;
    const aValue = a.points ?? a.projectedPoints ?? 0;
    const bValue = b.points ?? b.projectedPoints ?? 0;
    return bValue - aValue;
  });
}

const CHIP_LABELS: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

function formatChip(activeChip: string | null): string {
  if (!activeChip) return "—";
  return CHIP_LABELS[activeChip] ?? activeChip;
}

function formatNumber(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits);
}

function formatTransfers(summary: GameweekMatchupTeamSummary): string {
  if (summary.eventTransfers == null) return "—";
  const cost = summary.eventTransfersCost ?? 0;
  return cost > 0 ? `${summary.eventTransfers} (-${cost})` : `${summary.eventTransfers}`;
}

function formatRank(rank: number | null): string {
  return rank == null ? "—" : rank.toLocaleString();
}

function TeamHeader({
  summary,
  weekState,
  week,
}: {
  summary: GameweekMatchupTeamSummary;
  weekState: "future" | "played";
  week: number;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex items-center gap-2">
        <Avatar name={summary.teamName} />
        <h3 className="text-lg font-semibold text-ink-primary">{summary.teamName}</h3>
      </div>
      {weekState === "played" && (
        <span className="text-xl font-bold text-ink-primary">{formatNumber(summary.score)}</span>
      )}
    </div>
  );
}

function TeamStatsRow({ summary, weekState }: { summary: GameweekMatchupTeamSummary; weekState: "future" | "played" }) {
  if (weekState === "future") {
    return null;
  }
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm sm:grid-cols-4">
      <dt className="text-ink-muted">Transfers</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatTransfers(summary)}</dd>
      <dt className="text-ink-muted">Chip</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatChip(summary.activeChip)}</dd>
      <dt className="text-ink-muted">Bench pts</dt>
      <dd className="text-right text-ink-primary sm:text-left">{formatNumber(summary.pointsOnBench, 0)}</dd>
      <dt className="text-ink-muted">Team value</dt>
      <dd className="text-right text-ink-primary sm:text-left">
        {summary.teamValue == null ? "—" : `£${summary.teamValue.toFixed(1)}m`}
      </dd>
      <dt className="text-ink-muted">Overall rank</dt>
      <dd className="col-span-3 text-right text-ink-primary sm:text-left">{formatRank(summary.overallRank)}</dd>
    </dl>
  );
}

function RosterColumn({
  summary,
  weekState,
  week,
  roster,
}: {
  summary: GameweekMatchupTeamSummary;
  weekState: "future" | "played";
  week: number;
  roster: GameweekMatchupPlayerRow[];
}) {
  const sorted = sortRoster(roster);
  return (
    <div>
      <TeamHeader summary={summary} weekState={weekState} week={week} />
      <TeamStatsRow summary={summary} weekState={weekState} />
      {weekState === "future" && (
        <p className="mt-3 text-xs text-ink-faint">
          Current squad — subject to change before the Gameweek {week} deadline.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Player</Th>
              {weekState === "played" ? (
                <>
                  <Th>Points</Th>
                  <Th title="Coefficient of variation — lower means steadier week-to-week output">Consistency</Th>
                  <Th title="avg_points / (1 + coefficient of variation) — higher is better">Trade Value</Th>
                  <Th title="This player's points as a % of the opponent's starter average that week">Impact</Th>
                </>
              ) : (
                <>
                  <Th>Proj.</Th>
                  <Th>Next fixture</Th>
                </>
              )}
            </Tr>
          </Thead>
          <Tbody>
            {sorted.map((player) => (
              <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <Td>
                  <div className="flex items-center gap-2">
                    {player.position && (
                      <Badge variant="neutral">{player.position}</Badge>
                    )}
                    {player.playerName}
                    <Badge variant={player.isStarter ? "starter" : "bench"}>
                      {player.isStarter ? "Starter" : "Bench"}
                    </Badge>
                  </div>
                </Td>
                {weekState === "played" ? (
                  <>
                    <Td>{formatNumber(player.points)}</Td>
                    <Td className="text-ink-muted">{formatNumber(player.consistency, 2)}</Td>
                    <Td className="text-ink-muted">{formatNumber(player.tradeValue, 2)}</Td>
                    <Td className="text-ink-muted">
                      {player.impactPercent == null ? "—" : `${Math.round(player.impactPercent)}%`}
                    </Td>
                  </>
                ) : (
                  <>
                    <Td>{formatNumber(player.projectedPoints)}</Td>
                    <Td>{player.nextFixture ?? "—"}</Td>
                  </>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

function formatStrengthStat(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

function InsightsFooter({ myTeamName, opponentTeamName, insights }: {
  myTeamName: string;
  opponentTeamName: string;
  insights: GameweekMatchupInsights;
}) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {myTeamName}&apos;s weak spots
          </h4>
          {insights.weakSpots.length === 0 ? (
            <p className="text-sm text-ink-faint">No standout weak spots yet — not enough consistency data.</p>
          ) : (
            <ul className="space-y-1.5">
              {insights.weakSpots.map((spot) => (
                <li key={spot.playerName} className="flex items-center justify-between text-sm">
                  <span className="text-ink-primary">{spot.playerName}</span>
                  <Badge variant="loss">value {spot.tradeValue.toFixed(2)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Scouting {opponentTeamName}
          </h4>
          {insights.opponentScouting == null ? (
            <p className="text-sm text-ink-faint">Not enough weekly history yet.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">Avg/wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.avgWeeklyPoints)}</dd>
              <dt className="text-ink-muted">Stddev</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.weeklyPointsStddev)}</dd>
              <dt className="text-ink-muted">Best wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.bestWeekPoints)}</dd>
              <dt className="text-ink-muted">Worst wk</dt>
              <dd className="text-right text-ink-primary">{formatStrengthStat(insights.opponentScouting.worstWeekPoints)}</dd>
            </dl>
          )}
        </div>
      </div>

      {insights.toughFixtures.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h4
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint"
            title="Difficulty score is the community FPL sheet's own next-6-gameweek scale — lower means an easier run. Not an official FPL metric."
          >
            Tough fixture run ahead
          </h4>
          <ul className="space-y-1.5">
            {insights.toughFixtures.map((fixture) => (
              <li key={fixture.playerName} className="flex items-center justify-between text-sm">
                <span className="text-ink-primary">{fixture.playerName}</span>
                <Badge variant="tie">difficulty {fixture.difficultyScore.toFixed(0)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function GameweekMatchupCard({
  weekState,
  week,
  result,
  winProbability,
  myTeam,
  opponentTeam,
  myRoster,
  opponentRoster,
  insights,
}: {
  weekState: "future" | "played";
  week: number;
  result: "W" | "L" | "T" | null;
  winProbability: number | null;
  myTeam: GameweekMatchupTeamSummary;
  opponentTeam: GameweekMatchupTeamSummary;
  myRoster: GameweekMatchupPlayerRow[];
  opponentRoster: GameweekMatchupPlayerRow[];
  insights: GameweekMatchupInsights | null;
}) {
  const RESULT_TONE = { W: "win", L: "loss", T: "tie" } as const;

  return (
    <Card className="mt-6">
      <SectionHeader
        title={weekState === "future" ? `Next Gameweek Preview — Week ${week}` : `Week ${week} Matchup`}
        description={
          weekState === "future"
            ? `Current squads shown below — subject to change before the Gameweek ${week} deadline.`
            : week === undefined
              ? undefined
              : "Full breakdown of this week's head-to-head matchup."
        }
        controls={
          weekState === "played" && result ? (
            <div className="flex items-center gap-3">
              <Badge variant={RESULT_TONE[result]}>{result}</Badge>
              {winProbability != null && (
                <span className="text-xs text-ink-muted">{Math.round(winProbability * 100)}% win prob.</span>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <RosterColumn summary={myTeam} weekState={weekState} week={week} roster={myRoster} />
        <RosterColumn summary={opponentTeam} weekState={weekState} week={week} roster={opponentRoster} />
      </div>

      {insights && (
        <InsightsFooter myTeamName={myTeam.teamName} opponentTeamName={opponentTeam.teamName} insights={insights} />
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully (this component isn't imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/GameweekMatchupCard.tsx
git commit -m "Add GameweekMatchupCard component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Wire `GameweekMatchupCard` into the league page, retire the old layout

**Files:**
- Modify: `apps/web/app/leagues/[leagueId]/page.tsx`

- [ ] **Step 1: Replace imports**

Find the full import block at the top of the file (from `import Link from "next/link";` through `import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";`). Replace it entirely with:

```tsx
import Link from "next/link";
import {
  fetchLeagueTeamView,
  type EntryGameweekStatRow,
  type FplSheetPlayerRow,
  type PlayerValueRow,
  type RosterPlayerRow,
  type StandingsRow,
} from "@/lib/leagues";
import SectionHeader from "@/components/ui/SectionHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import GameweekMatchupCard, {
  type GameweekMatchupInsights,
  type GameweekMatchupPlayerRow,
  type GameweekMatchupTeamSummary,
  type ToughFixture,
  type WeakSpot,
} from "@/components/ui/GameweekMatchupCard";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
```

(`Card` and `Avatar` are still used by the Standings section further down in this file — confirm this by reading the rest of the file before removing anything; do not remove imports still used elsewhere.)

- [ ] **Step 2: Replace the helper functions above the page component**

Find and delete these functions entirely (all now live inside `GameweekMatchupCard` or are replaced below): `formatPoints` — **keep this one**, it's still used by the Standings table's `formatPoints(row.strength?.avgWeeklyPoints ?? null)` calls. Delete only: `sumPoints`, `steadiness`, `computeNextGameweekRoster`, the `RosterRowView` interface, `TeamPanel`, and the `formatConsistency`/`formatTradeValue`/`playerValueTitle` trio if nothing else in the file uses them after this change (check with `grep -n "formatConsistency\|formatTradeValue\|playerValueTitle" apps/web/app/leagues/\[leagueId\]/page.tsx` after Step 1 — if only the deleted `TeamPanel` used them, delete them too).

Keep: `formatPoints`, `Result` type, `computeResult`, `computeWinProbability`, `computeWeakSpots`, `TOUGH_FIXTURE_THRESHOLD`, `computeToughFixtures`, `formatShare`, `StandingsDelta`.

Also delete the module-level `const RESULT_TONE = { W: "win", L: "loss", T: "tie" } as const;` line — its only call site was the `StatTile` result tile being deleted in Step 3 below, and `GameweekMatchupCard` defines its own copy internally (Task 8). Leaving it in `page.tsx` after Step 3 would be an unused-variable build failure.

Update `computeWeakSpots`'s and `computeToughFixtures`'s parameter types from `RosterRowView[]` to `RosterPlayerRow[]` (they only ever read `.isStarter`, `.playerValue`, `.playerName`, `.playerExternalId` — all present on `RosterPlayerRow` directly, so `RosterRowView` was already redundant with it once `playerValue` was merged in via `fetchLeagueTeamView`).

Add these new helper functions in place of the deleted ones (position anywhere above the page component, e.g. where `computeNextGameweekRoster` used to be):

```tsx
function buildMatchupRoster(
  roster: RosterPlayerRow[],
  fplSheetData: Map<string, FplSheetPlayerRow> | null,
  projections: Map<string, number> | null,
  opposingRoster: RosterPlayerRow[],
  week: number,
  weekState: "future" | "played"
): GameweekMatchupPlayerRow[] {
  const opposingStarters = opposingRoster.filter((player) => player.isStarter);
  const opposingStarterAverage =
    opposingStarters.length === 0
      ? null
      : opposingStarters.reduce((sum, player) => sum + player.points, 0) / opposingStarters.length;

  return roster.map((player) => {
    const sheetRow = fplSheetData?.get(player.playerExternalId) ?? null;
    const fixture = sheetRow?.nextFixtures.find((f) => f.gw === week) ?? null;
    return {
      playerExternalId: player.playerExternalId,
      playerName: player.playerName,
      position: (sheetRow?.position as GameweekMatchupPlayerRow["position"]) ?? null,
      isStarter: player.isStarter,
      points: weekState === "played" ? player.points : null,
      projectedPoints: weekState === "future" ? projections?.get(player.playerExternalId) ?? null : null,
      nextFixture: fixture ? `${fixture.opponent} (${fixture.isHome ? "H" : "A"})` : null,
      consistency: weekState === "played" ? player.playerValue?.coefficientOfVariation ?? null : null,
      tradeValue: weekState === "played" ? player.playerValue?.tradeValue ?? null : null,
      impactPercent:
        weekState === "played" && opposingStarterAverage != null && opposingStarterAverage > 0
          ? (player.points / opposingStarterAverage) * 100
          : null,
    };
  });
}

function buildTeamSummary(
  teamName: string,
  score: number | null,
  entryStats: EntryGameweekStatRow | null
): GameweekMatchupTeamSummary {
  return {
    teamName,
    score,
    eventTransfers: entryStats?.eventTransfers ?? null,
    eventTransfersCost: entryStats?.eventTransfersCost ?? null,
    pointsOnBench: entryStats?.pointsOnBench ?? null,
    teamValue: entryStats?.teamValue ?? null,
    overallRank: entryStats?.overallRank ?? null,
    activeChip: entryStats?.activeChip ?? null,
  };
}
```

`FplSheetPlayerRow.position` doesn't exist as a field yet — check by reading the current `FplSheetPlayerRow` interface in `apps/web/lib/leagues.ts` (added in Task 6/7's neighborhood — actually it was NOT added by any earlier task in this plan). Add it now: in `apps/web/lib/leagues.ts`, find the `FplSheetPlayerRow` interface and its `fromFplSheetPlayerRow` mapper and `fetchFplSheetData`'s `.select(...)` call — add a `position: string | null` field, `position: row.position,` in the mapper (matching the DB row's `position` column, which is `not null` per its own migration, so this could be typed as `position: string` instead of `string | null`, matching the table's real constraint — check `apps/web/lib/leagues.ts`'s existing `FplSheetPlayerDbRow` interface fields before choosing; if every other field mirrors nullability exactly from the DB schema, follow that same convention here: `position: string` on both the DB row and the app row, non-nullable, and add `position` to the `.select("...")` column list). Do this addition as part of this same step (Step 2), in `apps/web/lib/leagues.ts` — it's a small, tightly-related add to the same file this plan already modified in Tasks 6–7.

- [ ] **Step 3: Replace the page body**

Find the exported `LeagueTeamViewPage` function. Replace the destructuring block:

```tsx
  const {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings,
    matchupPreview,
    fplSheetData,
    nextGameweekPreview,
  } = view;
```

with:

```tsx
  const {
    league,
    week,
    latestWeek,
    weekState,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings,
    matchupPreview,
    fplSheetData,
    projections,
    entryGameweekStats,
  } = view;
```

Update the week-nav `SectionHeader`'s `controls` block: find the `week < latestWeek ? (...)` conditional that renders `Wk {week + 1} →` and change its condition from `week < latestWeek` to `week < latestWeek + (league.sourceId === "fpl" && league.format === "head_to_head" ? 1 : 0)` — matching `fetchLeagueTeamView`'s own `maxReachableWeek` logic exactly (only FPL H2H leagues can step one past `latestWeek`).

Also find `isCurrentWeek` (used for the little live-pulse dot next to the week pill) and change `const isCurrentWeek = week === latestWeek;` to also account for the new future step existing — leave this exactly as `week === latestWeek` (the pulse should still mark the actual live/most-recent week, not the future preview).

Delete every line from the `{opponentTeam && (` line that opens the stat-tile row (immediately after the `<SectionHeader ... />` closing tag) through the `</div>` that closes the plain `TeamPanel` grid (immediately before the `<section className="mt-10">` that starts the Standings section). That deleted region is exactly this (shown here in full so the deletion boundary is unambiguous):

```tsx
      {opponentTeam && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="My Score" value={formatPoints(myPoints)} />
          <StatTile label="Opponent Score" value={formatPoints(opponentPoints)} />
          <StatTile label="Result" value={result ?? "—"} tone={result ? RESULT_TONE[result] : "default"} />
        </div>
      )}

      {opponentTeam && myProjected != null && opponentProjected != null && winProbability != null && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="My Projected" value={myProjected.toFixed(1)} sublabel="rest of this week" />
          <StatTile label="Opponent Projected" value={opponentProjected.toFixed(1)} sublabel="rest of this week" />
          <StatTile
            label="Win Probability"
            value={`${Math.round(winProbability * 100)}%`}
            tone={winProbability >= 0.5 ? "win" : "loss"}
          />
        </div>
      )}

      {opponentTeam && matchupPreview && (
        <MatchupPrepCard
          opponentTeamName={opponentTeam.teamName}
          weakSpots={weakSpots}
          opponentStrength={opponentStrength}
          toughFixtures={toughFixtures}
        />
      )}

      {nextGameweekPreview && (
        <NextGameweekPreviewCard
          week={nextGameweekPreview.week}
          myTeamName={myTeam.teamName}
          opponentTeamName={nextGameweekPreview.opponentTeam.teamName}
          myRoster={computeNextGameweekRoster(
            nextGameweekPreview.myRoster,
            nextGameweekPreview.projections,
            nextGameweekPreview.fplSheetData,
            nextGameweekPreview.week
          )}
          opponentRoster={computeNextGameweekRoster(
            nextGameweekPreview.opponentRoster,
            nextGameweekPreview.projections,
            nextGameweekPreview.fplSheetData,
            nextGameweekPreview.week
          )}
        />
      )}

      {opponentTeam && (
        <Card className="mt-6">
          <SectionHeader title="Head-to-Head Comparison" />
          <div className="mt-4">
            <TeamCompareChart
              myTeamName={myTeam.teamName}
              opponentTeamName={opponentTeam.teamName}
              metrics={[
                { label: "Starter Points", mine: sumPoints(myRoster, true), opponent: sumPoints(opponentRoster, true) },
                { label: "Bench Points", mine: sumPoints(myRoster, false), opponent: sumPoints(opponentRoster, false) },
                { label: "Steadiness", mine: steadiness(myRoster), opponent: steadiness(opponentRoster) },
              ]}
            />
          </div>
        </Card>
      )}

      <div className={`mt-6 grid gap-6 ${opponentTeam ? "lg:grid-cols-2" : ""}`}>
        <TeamPanel teamName={myTeam.teamName} points={myPoints} roster={myRoster} />
        {opponentTeam && (
          <TeamPanel teamName={opponentTeam.teamName} points={opponentPoints} roster={opponentRoster} />
        )}
      </div>
```

Replace the deleted region with:

```tsx
      {opponentTeam ? (
        <GameweekMatchupCard
          weekState={weekState}
          week={week}
          result={weekState === "played" ? result : null}
          winProbability={weekState === "played" && week === latestWeek ? winProbability : null}
          myTeam={buildTeamSummary(myTeam.teamName, myPoints, entryGameweekStats?.get(myTeam.externalTeamId) ?? null)}
          opponentTeam={buildTeamSummary(
            opponentTeam.teamName,
            opponentPoints,
            entryGameweekStats?.get(opponentTeam.externalTeamId) ?? null
          )}
          myRoster={buildMatchupRoster(myRoster, fplSheetData, projections, opponentRoster, week, weekState)}
          opponentRoster={buildMatchupRoster(opponentRoster, fplSheetData, projections, myRoster, week, weekState)}
          insights={
            weekState === "played" && week === latestWeek && matchupPreview
              ? { weakSpots, toughFixtures, opponentScouting: opponentStrength }
              : null
          }
        />
      ) : (
        <Card className="mt-6 p-0">
          <div className="flex items-baseline justify-between px-5 pt-5">
            <div className="flex items-center gap-2">
              <Avatar name={myTeam.teamName} />
              <h3 className="text-lg font-semibold text-ink-primary">{myTeam.teamName}</h3>
            </div>
            <span className="text-xl font-bold text-ink-primary">{formatPoints(myPoints)}</span>
          </div>
          {myRoster.length === 0 ? (
            <p className="px-5 pb-5 pt-3 text-sm text-ink-faint">No roster data for this week.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Player</Th>
                    <Th>Points</Th>
                    <Th title="Coefficient of variation — lower means steadier week-to-week output">Consistency</Th>
                    <Th title="avg_points / (1 + coefficient of variation) — higher is better">Trade Value</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {myRoster.map((player) => (
                    <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                      <Td className="flex items-center gap-2">
                        {player.playerName}
                        <Badge variant={player.isStarter ? "starter" : "bench"}>
                          {player.isStarter ? "Starter" : "Bench"}
                        </Badge>
                      </Td>
                      <Td>{formatPoints(player.points)}</Td>
                      <Td className="text-ink-muted">
                        {player.playerValue?.coefficientOfVariation == null
                          ? "—"
                          : player.playerValue.coefficientOfVariation.toFixed(2)}
                      </Td>
                      <Td className="text-ink-muted">
                        {player.playerValue == null ? "—" : player.playerValue.tradeValue.toFixed(2)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </Card>
      )}
```

This deliberately keeps the classic-league / no-opponent case (e.g. `/leagues/4`) on a plain single-roster table rather than forcing it through `GameweekMatchupCard`, which is designed around a two-column comparison and has no sensible single-team rendering — `GameweekMatchupCard` is FPL-H2H/Sleeper-H2H-matchup-only, exactly matching today's behavior where `TeamPanel` was already the sole fallback for a classic league.

Find where `weakSpots`, `toughFixtures`, and `opponentStrength` are currently computed (just above the `return (`):

```tsx
  const weakSpots = matchupPreview ? computeWeakSpots(myRoster) : [];
  const toughFixtures = computeToughFixtures(myRoster, fplSheetData);
  const opponentStrength = opponentTeam
    ? standings.find((row) => row.team.externalTeamId === opponentTeam.externalTeamId)?.strength ?? null
    : null;
```

Leave these three lines exactly as they are — `insights` above references `opponentStrength` directly, matching the variable name already in scope.

- [ ] **Step 4: Verify the classic-league page still renders**

The replacement in Step 3 keeps the exact same `!opponentTeam` fallback behavior the page already had (a single-roster table, no second column) — this step is a checkpoint, not a design decision: confirm during Task 11's live-verification pass (`/leagues/4`) that this fallback still renders correctly, since it is now reached through a different code path (`GameweekMatchupCard` vs. `TeamPanel`) even though its visual output is intentionally unchanged.

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully, no unused imports, no missing fields.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/leagues/\[leagueId\]/page.tsx apps/web/lib/leagues.ts
git commit -m "Render GameweekMatchupCard on the league page, retire the fragmented layout

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Delete the retired components

**Files:**
- Delete: `apps/web/components/ui/MatchupPrepCard.tsx`
- Delete: `apps/web/components/ui/NextGameweekPreviewCard.tsx`
- Delete: `apps/web/components/ui/TeamCompareChart.tsx`

- [ ] **Step 1: Confirm nothing still imports them**

Run: `grep -rn "MatchupPrepCard\|NextGameweekPreviewCard\|TeamCompareChart" apps/web --include="*.tsx" --include="*.ts"`
Expected: no matches outside the three files themselves (Task 9 should have already removed every import site — if this greps any remaining import, go back and fix Task 9's page.tsx changes first).

- [ ] **Step 2: Delete the files**

```bash
git rm apps/web/components/ui/MatchupPrepCard.tsx apps/web/components/ui/NextGameweekPreviewCard.tsx apps/web/components/ui/TeamCompareChart.tsx
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git commit -m "Delete MatchupPrepCard, NextGameweekPreviewCard, TeamCompareChart

Superseded by GameweekMatchupCard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Backfill `fpl_entry_gameweek_stats` and verify live

**Files:** none (data operations + manual verification only)

- [ ] **Step 1: Run the full test suites one more time**

Run: `cd services/ingestion && .venv/bin/pytest -v`
Expected: PASS (all tests)

Run: `cd apps/web && npm run build`
Expected: Compiles successfully.

- [ ] **Step 2: Backfill `fpl_entry_gameweek_stats` for the real FPL H2H league**

Same mechanism as the earlier `h2h_fixtures`/`player_projections` backfills in this project's history: write a small local script importing `FPLAdapter`, call `fetch_h2h_league_data(league_id="401057", my_entry_id="16163")` (confirm these IDs are still current via `select * from public.leagues where source_id='fpl' and format='head_to_head'` and `select external_team_id from public.fantasy_teams where source_id='fpl' and external_league_id='401057' and is_mine=true` if unsure), take `result.entry_gameweek_stats`, and write batched `insert into public.fpl_entry_gameweek_stats (source_id, external_league_id, external_team_id, week, event_transfers, event_transfers_cost, points_on_bench, bank, team_value, overall_rank, active_chip) values (...) on conflict (source_id, external_league_id, external_team_id, week) do update set event_transfers = excluded.event_transfers, event_transfers_cost = excluded.event_transfers_cost, points_on_bench = excluded.points_on_bench, bank = excluded.bank, team_value = excluded.team_value, overall_rank = excluded.overall_rank, active_chip = excluded.active_chip;` statements (`source_id`/`external_league_id` supplied as constants `'fpl'`/`'401057'`, same as `_entry_gameweek_stat_rows` does in the real sync path). Run each batch against the linked Supabase project with the Supabase MCP `execute_sql` tool.

Verify: `select count(*) from public.fpl_entry_gameweek_stats where source_id='fpl' and external_league_id='401057';` should return one row per team per already-elapsed week (e.g. ~20 teams × 3 weeks ≈ 60, for a league at week 3).

- [ ] **Step 3: Verify live in the browser**

1. Start the dev server via `preview_start` with `name: "web"` (this session has previously hit a bug where this resolves `apps/web` against the wrong directory when working from a worktree — if the dev server's rendered output doesn't reflect the code just written, verify with `ps aux | grep "next dev"` that it's actually running from the current working directory, not a stale checkout, before debugging further).
2. Navigate to the real FPL H2H league page (`/leagues/3`).
3. Confirm the current week (week 3) shows one `GameweekMatchupCard` with: positions next to every player name, players grouped GKP→DEF→MID→FWD within starters and again within bench, real points, transfers/chip/bench-points/team-value/overall-rank for both teams, Impact % per player, and the weak-spots/opponent-scouting/tough-fixtures footer.
4. Navigate to a past week (`?week=1`) and confirm it shows the same card shape (positions, sorting, points, transfers/chip/etc. for week 1 specifically) but WITHOUT the weak-spots/opponent-scouting/tough-fixtures footer (that's current-week-only).
5. Navigate to `?week=4` (`latestWeek + 1`) and confirm it shows the future-state card: no score/transfers/chip section, projected points, next fixture, positions/sorting still present, and the "current squad — subject to change" caption.
6. Confirm `Wk →` is disabled/unreachable past week 4 (no `?week=5` link rendered).
7. Navigate to the FPL classic league page (`/leagues/4`) and confirm it renders sensibly (per Task 9 Step 4's judgment call) rather than crashing or showing a broken two-column layout with an empty opponent side.
8. Navigate to a Sleeper league page and confirm it's unaffected — no future-week step available (Sleeper isn't FPL H2H), same card shape as before for its own current/past weeks (minus positions/transfers/chip/Impact, which are FPL-only fields that should render as "—" or simply not present rather than crashing).

- [ ] **Step 4: Deploy**

Since `apps/web` auto-deploys from `main` on every push, confirm the production URL (`https://reality-manager.vercel.app`, password-protected) shows the same result as Step 3 once Vercel's build finishes.
