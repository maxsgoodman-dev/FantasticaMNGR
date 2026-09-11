# Next-Gameweek H2H Preview (FPL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For FPL head-to-head leagues, show who you play next gameweek and a side-by-side preview of both squads (current roster, next-week projected points, next real-world fixture) on the current-week league page.

**Architecture:** A new `h2h_fixtures` table stores the whole season's H2H schedule (already returned in full by an endpoint the FPL adapter already calls, today discarded past the current week). A new FPL adapter method surfaces `ep_next` (next-gameweek expected points, distinct from the `ep_this` the existing projections sync uses). The web app composes these plus the already-fetched roster/fixture-difficulty data into one new card, gated to FPL and to the actual current week only.

**Tech Stack:** Python (pytest, httpx) for `services/ingestion`; Supabase Postgres (RLS, PostgREST) for the warehouse; TypeScript/Next.js (App Router, `@supabase/supabase-js`) for `apps/web`. No new JS test framework — this repo verifies `apps/web` changes via `npm run build` (type-checking) plus live browser checks, not unit tests; follow that existing convention.

---

## Task 1: `H2HFixture` model

**Files:**
- Modify: `services/ingestion/fantasy_ingest/league_models.py`
- Test: `services/ingestion/tests/test_league_models.py`

- [ ] **Step 1: Write the failing tests**

Add to `services/ingestion/tests/test_league_models.py`, changing the import line and adding/replacing tests:

```python
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
```

Add these two new tests anywhere after `test_roster_entry_fields`:

```python
def test_h2h_fixture_fields():
    fixture = H2HFixture(team_external_id="1", week=4, opponent_external_id="2")
    assert fixture.team_external_id == "1"
    assert fixture.week == 4
    assert fixture.opponent_external_id == "2"


def test_h2h_fixture_opponent_defaults_to_none():
    fixture = H2HFixture(team_external_id="1", week=4)
    assert fixture.opponent_external_id is None
```

Replace `test_league_sync_result_bundles_the_three_lists` and
`test_league_sync_result_defaults_to_empty_lists` with:

```python
def test_league_sync_result_bundles_the_four_lists():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    score = WeeklyScore(team_external_id="1", week=1, points=10.0)
    entry = RosterEntry(
        team_external_id="1", week=1, player_external_id="101", player_name="P", is_starter=True, points=5.0
    )
    fixture = H2HFixture(team_external_id="1", week=2, opponent_external_id="2")

    result = LeagueSyncResult(teams=[team], weekly_scores=[score], roster_players=[entry], h2h_fixtures=[fixture])

    assert result.teams == [team]
    assert result.weekly_scores == [score]
    assert result.roster_players == [entry]
    assert result.h2h_fixtures == [fixture]


def test_league_sync_result_defaults_to_empty_lists():
    result = LeagueSyncResult()
    assert result.teams == []
    assert result.weekly_scores == []
    assert result.roster_players == []
    assert result.h2h_fixtures == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_league_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'H2HFixture'`

- [ ] **Step 3: Implement `H2HFixture` and extend `LeagueSyncResult`**

In `services/ingestion/fantasy_ingest/league_models.py`, add this dataclass after `RosterEntry` (before `LeagueSyncResult`):

```python
@dataclass
class H2HFixture:
    team_external_id: str
    week: int
    opponent_external_id: str | None = None
```

Replace the existing `LeagueSyncResult` class with:

```python
@dataclass
class LeagueSyncResult:
    teams: list[FantasyTeam] = field(default_factory=list)
    weekly_scores: list[WeeklyScore] = field(default_factory=list)
    roster_players: list[RosterEntry] = field(default_factory=list)
    h2h_fixtures: list[H2HFixture] = field(default_factory=list)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_league_models.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/league_models.py services/ingestion/tests/test_league_models.py
git commit -m "Add H2HFixture model, extend LeagueSyncResult with h2h_fixtures"
```

---

## Task 2: Normalize the full H2H schedule (past and future)

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Extend the shared fixture and write the failing tests**

In `services/ingestion/tests/test_fpl_adapter.py`, update the import line to add `H2HFixture` and `_normalize_h2h_fixtures`:

```python
from fantasy_ingest.adapters.fpl import (
    FPLAdapter,
    _current_gameweek,
    _normalize_classic_standings,
    _normalize_entry_history,
    _normalize_h2h_fixtures,
    _normalize_h2h_matches,
    _normalize_h2h_teams,
    _normalize_picks,
    _normalize_players,
    _normalize_projections,
    _normalize_teams,
)
```

Also add `H2HFixture` to the existing `from fantasy_ingest.league_models import ...` line in that same file (find it and add `H2HFixture` to the imported names, keeping the rest unchanged).

Find `H2H_MATCHES_PAGE` and add a third, future-week result to its `"results"` list (this is additive — existing tests slice `["results"][0]` or filter by `.week`, so they're unaffected):

```python
H2H_MATCHES_PAGE = {
    "has_next": False,
    "results": [
        {"event": 1, "entry_1_entry": 111, "entry_1_points": 65, "entry_2_entry": 222, "entry_2_points": 58},
        {"event": 2, "entry_1_entry": 111, "entry_1_points": 70, "entry_2_entry": None, "entry_2_points": 0},
        {"event": 3, "entry_1_entry": 111, "entry_1_points": 0, "entry_2_entry": 333, "entry_2_points": 0},
    ],
}
```

Add these two new tests directly after `test_normalize_h2h_matches_excludes_weeks_after_current`:

```python
def test_normalize_h2h_fixtures_includes_every_week_past_and_future():
    fixtures = _normalize_h2h_fixtures([H2H_MATCHES_PAGE])

    assert H2HFixture(team_external_id="111", week=1, opponent_external_id="222") in fixtures
    assert H2HFixture(team_external_id="222", week=1, opponent_external_id="111") in fixtures
    assert H2HFixture(team_external_id="111", week=3, opponent_external_id="333") in fixtures
    assert H2HFixture(team_external_id="333", week=3, opponent_external_id="111") in fixtures


def test_normalize_h2h_fixtures_handles_a_bye_with_no_second_entry():
    fixtures = _normalize_h2h_fixtures([H2H_MATCHES_PAGE])

    week_2_fixtures = [f for f in fixtures if f.week == 2]
    assert week_2_fixtures == [H2HFixture(team_external_id="111", week=2, opponent_external_id=None)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_fpl_adapter.py -v -k h2h_fixtures`
Expected: FAIL — `ImportError: cannot import name '_normalize_h2h_fixtures'`

- [ ] **Step 3: Implement `_normalize_h2h_fixtures`**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, update the league_models import line to add `H2HFixture`:

```python
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
```

Add this function directly after `_normalize_h2h_matches`:

```python
def _normalize_h2h_fixtures(pages: list[dict]) -> list[H2HFixture]:
    """Every gameweek's H2H pairing for every team, past and future.

    Unlike _normalize_h2h_matches (which discards anything past
    current_week, since it's building settled *results*), this keeps
    every event the pages contain. The H2H schedule itself is fixed at
    the start of the season and known for all gameweeks regardless of
    whether they've been played — see
    docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
    """
    fixtures = []
    for page in pages:
        for match in page["results"]:
            week = match["event"]
            entry_1 = str(match["entry_1_entry"])
            entry_2 = str(match["entry_2_entry"]) if match.get("entry_2_entry") is not None else None
            fixtures.append(H2HFixture(team_external_id=entry_1, week=week, opponent_external_id=entry_2))
            if entry_2 is not None:
                fixtures.append(H2HFixture(team_external_id=entry_2, week=week, opponent_external_id=entry_1))
    return fixtures
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_fpl_adapter.py -v -k h2h_fixtures`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add _normalize_h2h_fixtures: full H2H schedule, not just past weeks"
```

---

## Task 3: Wire fixtures into `fetch_h2h_league_data`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py:313-348` (the `fetch_h2h_league_data` method)
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing test**

Add this test to `services/ingestion/tests/test_fpl_adapter.py`, directly after `test_fetch_h2h_league_data_skips_a_team_whose_picks_call_fails`:

```python
def test_fetch_h2h_league_data_includes_h2h_fixtures_for_every_week():
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
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 6}}
            )
        if path.endswith("/entry/222/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 6}}
            )
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_h2h_league_data(league_id="H1", my_entry_id="111")

    assert H2HFixture(team_external_id="111", week=3, opponent_external_id="333") in result.h2h_fixtures
    assert H2HFixture(team_external_id="111", week=1, opponent_external_id="222") in result.h2h_fixtures
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_fpl_adapter.py::test_fetch_h2h_league_data_includes_h2h_fixtures_for_every_week -v`
Expected: FAIL — `AssertionError` (h2h_fixtures is empty, since `fetch_h2h_league_data` doesn't populate it yet)

- [ ] **Step 3: Wire `_normalize_h2h_fixtures` into `fetch_h2h_league_data`**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, find this line inside `fetch_h2h_league_data` (around line 322):

```python
        matches_pages = self._fetch_matches_pages(H2H_MATCHES_URL.format(league_id=league_id))
        weekly_scores = _normalize_h2h_matches(matches_pages, current_week)
```

Add a line directly after it:

```python
        matches_pages = self._fetch_matches_pages(H2H_MATCHES_URL.format(league_id=league_id))
        weekly_scores = _normalize_h2h_matches(matches_pages, current_week)
        h2h_fixtures = _normalize_h2h_fixtures(matches_pages)
```

Find the method's final `return` statement (around line 348):

```python
        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
```

Replace it with:

```python
        return LeagueSyncResult(
            teams=teams, weekly_scores=weekly_scores, roster_players=roster_players, h2h_fixtures=h2h_fixtures
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_fpl_adapter.py::test_fetch_h2h_league_data_includes_h2h_fixtures_for_every_week -v`
Expected: PASS

- [ ] **Step 5: Run the full FPL adapter test suite**

Run: `pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests, including the pre-existing ones — this change is additive)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Wire h2h_fixtures into fetch_h2h_league_data"
```

---

## Task 4: Next-gameweek projections via `ep_next`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Add `ep_next` to the shared fixture and write the failing tests**

In `services/ingestion/tests/test_fpl_adapter.py`, add `_normalize_next_week_projections` to the adapter import block (same block edited in Task 2):

```python
from fantasy_ingest.adapters.fpl import (
    FPLAdapter,
    _current_gameweek,
    _normalize_classic_standings,
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
```

In `BOOTSTRAP_STATIC_FIXTURE`, add an `"ep_next"` key to each of the three elements (Saka, Raya, Salah), matching the existing style — the values must differ from `ep_this` so the test actually proves the right field is read:

```python
BOOTSTRAP_STATIC_FIXTURE = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS"},
        {"id": 2, "name": "Liverpool", "short_name": "LIV"},
    ],
    "elements": [
        {
            "id": 101,
            "first_name": "Bukayo",
            "second_name": "Saka",
            "team": 1,
            "element_type": 3,
            "now_cost": 100,
            "total_points": 150,
            "form": "5.5",
            "ep_this": "6.1",
            "ep_next": "6.5",
        },
        {
            "id": 102,
            "first_name": "David",
            "second_name": "Raya",
            "team": 1,
            "element_type": 1,
            "now_cost": 55,
            "total_points": 90,
            "form": "3.0",
            "ep_this": "3.4",
            "ep_next": "3.0",
        },
        {
            "id": 201,
            "first_name": "Mohamed",
            "second_name": "Salah",
            "team": 2,
            "element_type": 4,
            "now_cost": 130,
            "total_points": 200,
            "form": "7.2",
            "ep_this": "8.0",
            "ep_next": "8.5",
        },
    ],
    "events": EVENTS_FIXTURE,
}
```

Add these two new tests directly after `test_normalize_projections`:

```python
def test_normalize_next_week_projections_uses_ep_next_not_ep_this():
    projections = _normalize_next_week_projections(BOOTSTRAP_STATIC_FIXTURE)

    assert projections == [
        PlayerProjection(player_external_id="101", projected_points=6.5),
        PlayerProjection(player_external_id="102", projected_points=3.0),
        PlayerProjection(player_external_id="201", projected_points=8.5),
    ]


def test_fetch_next_week_projections_uses_ep_next():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE)

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    projections = adapter.fetch_next_week_projections()

    assert projections == _normalize_next_week_projections(BOOTSTRAP_STATIC_FIXTURE)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_fpl_adapter.py -v -k next_week_projections`
Expected: FAIL — `ImportError: cannot import name '_normalize_next_week_projections'`

- [ ] **Step 3: Implement `_normalize_next_week_projections` and `fetch_next_week_projections`**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, add this function directly after `_normalize_projections`:

```python
def _normalize_next_week_projections(raw_json: dict) -> list[PlayerProjection]:
    # ep_next — distinct from ep_this, which _normalize_projections uses
    # for the current-week sync. Both are always present on the same
    # bootstrap-static response; this is the only place ep_next is read.
    return [
        PlayerProjection(player_external_id=str(element["id"]), projected_points=float(element["ep_next"]))
        for element in raw_json["elements"]
    ]
```

Add this method to the `FPLAdapter` class, directly after `fetch_projections`:

```python
    def fetch_next_week_projections(self) -> list[PlayerProjection]:
        """Next-gameweek expected points for every player, via ep_next.

        Distinct from fetch_projections (current week, ep_this) — kept as
        its own method rather than a parameter on fetch_projections,
        since the two fields have genuinely different meanings: a
        settled current-week estimate vs. an early look at a week that
        hasn't started scoring yet. See
        docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
        """
        bootstrap = self._fetch_bootstrap_static()
        return _normalize_next_week_projections(bootstrap)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_fpl_adapter.py -v -k next_week_projections`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full FPL adapter test suite**

Run: `pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add fetch_next_week_projections using ep_next"
```

---

## Task 5: `h2h_fixtures` migration

**Files:**
- Create: `supabase/migrations/0010_h2h_fixtures.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Using the Supabase MCP tool, call `apply_migration` with:
- `project_id`: the `wsmegxfnmkhaailxhuih` project (confirm via `list_projects` if this has changed)
- `name`: `h2h_fixtures`
- `query`: the exact SQL from Step 1

- [ ] **Step 3: Verify no new lints**

Call the Supabase MCP `get_advisors` tool with `type: "security"` for the same project.
Expected: `{"lints": []}` — no new findings from this migration.

- [ ] **Step 4: Verify the table via `list_tables` or a direct query**

Call `execute_sql` with:
```sql
select count(*) from public.h2h_fixtures;
```
Expected: `[{"count": 0}]` — table exists, empty.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_h2h_fixtures.sql
git commit -m "Add h2h_fixtures table migration"
```

---

## Task 6: Persist H2H fixtures via `sync_league_data`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/warehouse.py`
- Test: `services/ingestion/tests/test_warehouse.py`

- [ ] **Step 1: Write the failing tests**

In `services/ingestion/tests/test_warehouse.py`, update the league_models import line to add `H2HFixture`:

```python
from fantasy_ingest.league_models import FantasyTeam, H2HFixture, LeagueSyncResult, RosterEntry, WeeklyScore
```

Update the three existing assertions that check `sync_league_data`'s / `sync_all_leagues`'s exact return dict, adding `"h2h_fixtures": 0` to each (these leagues don't set `h2h_fixtures`, so it defaults to `[]` → 0 rows):

In `test_sync_league_data_posts_league_teams_scores_and_roster`, change:
```python
    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1}
```
to:
```python
    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
```

In `test_sync_all_leagues_isolates_a_failing_league`, change:
```python
    assert results["sleeper:L1"] == {"teams": 1, "weekly_scores": 1, "roster_players": 1}
```
to:
```python
    assert results["sleeper:L1"] == {"teams": 1, "weekly_scores": 1, "roster_players": 1, "h2h_fixtures": 0}
```

In `test_sync_league_data_always_posts_league_row_but_skips_empty_child_tables`, change:
```python
    assert counts == {"teams": 0, "weekly_scores": 0, "roster_players": 0}
```
to:
```python
    assert counts == {"teams": 0, "weekly_scores": 0, "roster_players": 0, "h2h_fixtures": 0}
```

Add this new test directly after `test_sync_league_data_always_posts_league_row_but_skips_empty_child_tables`:

```python
def test_sync_league_data_posts_h2h_fixtures_when_present(recorded_requests):
    client = make_client(recorded_requests)
    result = LeagueSyncResult(h2h_fixtures=[H2HFixture(team_external_id="1", week=4, opponent_external_id="2")])

    counts = sync_league_data(SLEEPER_LEAGUE, result, client=client)

    assert counts["h2h_fixtures"] == 1
    paths = [request.url.path for request in recorded_requests]
    assert paths == ["/rest/v1/leagues", "/rest/v1/h2h_fixtures"]

    fixture_request = recorded_requests[1]
    assert "on_conflict=source_id,external_league_id,external_team_id,week" in str(fixture_request.url)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_warehouse.py -v -k "sync_league_data or sync_all_leagues"`
Expected: FAIL — the three modified assertions fail with a dict mismatch (missing `h2h_fixtures` key), and the new test fails with a `KeyError`.

- [ ] **Step 3: Implement `_h2h_fixture_rows` and wire it into `sync_league_data`**

In `services/ingestion/fantasy_ingest/warehouse.py`, add this function directly after `_roster_player_rows`:

```python
def _h2h_fixture_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": fixture.team_external_id,
            "week": fixture.week,
            "opponent_external_team_id": fixture.opponent_external_id,
        }
        for fixture in result.h2h_fixtures
    ]
```

Find the body of `sync_league_data`. The block that posts `roster_rows` currently ends like this, right before the `finally`:

```python
        roster_rows = _roster_player_rows(league, result)
        if roster_rows:
            response = client.post(
                "/roster_players?on_conflict=source_id,external_league_id,external_team_id,week,player_external_id",
                json=roster_rows,
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"teams": len(team_rows), "weekly_scores": len(score_rows), "roster_players": len(roster_rows)}
```

Replace it with:

```python
        roster_rows = _roster_player_rows(league, result)
        if roster_rows:
            response = client.post(
                "/roster_players?on_conflict=source_id,external_league_id,external_team_id,week,player_external_id",
                json=roster_rows,
            )
            response.raise_for_status()

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_warehouse.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/warehouse.py services/ingestion/tests/test_warehouse.py
git commit -m "Persist h2h_fixtures via sync_league_data"
```

Note: this task requires no changes to `services/ingestion/fantasy_ingest/sync_leagues.py` — that entrypoint already calls `sync_all_leagues` → `sync_league_data` per configured league, so once `fetch_h2h_league_data` (Task 3) populates `LeagueSyncResult.h2h_fixtures` and `sync_league_data` (this task) persists it, the existing `python -m fantasy_ingest.sync_leagues` / scheduled GitHub Action run already carries fixtures through automatically.

---

## Task 7: Sync next-week projections into the warehouse

**Files:**
- Modify: `services/ingestion/fantasy_ingest/warehouse.py`
- Test: `services/ingestion/tests/test_warehouse.py`

- [ ] **Step 1: Write the failing tests**

Add this fake adapter to `services/ingestion/tests/test_warehouse.py`, directly after `FakeAdapterWithProjections`:

```python
class FakeAdapterWithNextWeekProjections(FakeAdapter):
    def current_gameweek(self) -> int:
        return 3

    def fetch_next_week_projections(self) -> list[PlayerProjection]:
        return [PlayerProjection(player_external_id="101", projected_points=6.5)]
```

Add these two tests directly after `test_sync_projections_skips_empty_post_when_no_rows`:

```python
def test_sync_next_week_projections_posts_at_current_gameweek_plus_one(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_next_week_projections(FakeAdapterWithNextWeekProjections(), client=client)

    assert counts == {"projections": 1}
    assert len(recorded_requests) == 1
    request = recorded_requests[0]
    assert request.url.path.endswith("/player_projections")
    assert "on_conflict=source_id,sport_id,week,external_player_id" in str(request.url)


def test_sync_next_week_projections_rows_use_current_gameweek_plus_one(recorded_requests):
    import json

    client = make_client(recorded_requests)

    sync_next_week_projections(FakeAdapterWithNextWeekProjections(), client=client)

    row = json.loads(recorded_requests[0].content)[0]
    assert row["source_id"] == "testsource"
    assert row["sport_id"] == "testsport"
    assert row["week"] == 4
    assert row["external_player_id"] == "101"
    assert row["projected_points"] == 6.5
```

Update the `from fantasy_ingest.warehouse import (...)` block at the top of the file to add `sync_next_week_projections`:

```python
from fantasy_ingest.warehouse import (
    sync_adapter,
    sync_all,
    sync_all_leagues,
    sync_fpl_sheet,
    sync_league_data,
    sync_next_week_projections,
    sync_projections,
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_warehouse.py -v -k next_week_projections`
Expected: FAIL — `ImportError: cannot import name 'sync_next_week_projections'`

- [ ] **Step 3: Implement `sync_next_week_projections`**

In `services/ingestion/fantasy_ingest/warehouse.py`, add these two functions directly after `sync_projections`:

```python
def _next_week_projection_rows(adapter: FantasySourceAdapter, week: int) -> list[dict]:
    return [
        {
            "source_id": adapter.source,
            "sport_id": adapter.sport,
            "week": week,
            "external_player_id": projection.player_external_id,
            "projected_points": projection.projected_points,
        }
        for projection in adapter.fetch_next_week_projections()
    ]


def sync_next_week_projections(adapter: FantasySourceAdapter, client: httpx.Client | None = None) -> dict[str, int]:
    """Fetch and upsert next-gameweek projections (ep_next) at
    week = adapter.current_gameweek() + 1, into the same
    player_projections table sync_projections uses for the current week.

    FPL-only for now: fetch_next_week_projections isn't part of the
    FantasySourceAdapter interface — Sleeper/ESPN have no confirmed
    equivalent "look ahead" endpoint. See
    docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
    """
    owns_client = client is None
    client = client or _client()
    try:
        week = adapter.current_gameweek() + 1
        rows = _next_week_projection_rows(adapter, week)
        if rows:
            response = client.post(
                "/player_projections?on_conflict=source_id,sport_id,week,external_player_id", json=rows
            )
            response.raise_for_status()
    finally:
        if owns_client:
            client.close()

    return {"projections": len(rows)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_warehouse.py -v -k next_week_projections`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into `main()`**

In `services/ingestion/fantasy_ingest/warehouse.py`, find this block inside `main()`:

```python
    # Projections are FPL/Sleeper-only (ESPN has no per-player projection
    # endpoint reachable without a league-scoped call) — see
    # docs/superpowers/specs/2026-09-10-matchup-prep-design.md.
    _sync_projections_for("fpl", fpl.current_gameweek, fpl)
    _sync_projections_for("sleeper", sleeper.current_week, sleeper)
```

Add directly after it:

```python
    try:
        next_week_result = sync_next_week_projections(fpl)
        print(f"fpl-next-week-projections: {next_week_result['projections']} projections")
    except Exception as error:  # noqa: BLE001 - a bad next-week pull must not block everything else
        print(f"fpl-next-week-projections: FAILED — {error}")
```

- [ ] **Step 6: Run the full ingestion test suite**

Run: `pytest -v`
Expected: PASS (all tests — should be 76 + ~10 new tests from this plan so far)

- [ ] **Step 7: Commit**

```bash
git add services/ingestion/fantasy_ingest/warehouse.py services/ingestion/tests/test_warehouse.py
git commit -m "Add sync_next_week_projections (ep_next), wire into main()"
```

---

## Task 8: Expose `next_fixtures` on `FplSheetPlayerRow`

**Files:**
- Modify: `apps/web/lib/leagues.ts`

- [ ] **Step 1: Add the `FplNextFixture` type and extend `FplSheetPlayerRow`**

In `apps/web/lib/leagues.ts`, find the existing `FplSheetPlayerRow` interface:

```typescript
export interface FplSheetPlayerRow {
  playerExternalId: string;
  difficultyScore: number | null;
  xgiPer90: number | null;
  xgcPer90: number | null;
}
```

Replace it with:

```typescript
export interface FplNextFixture {
  gw: number;
  opponent: string;
  isHome: boolean;
}

export interface FplSheetPlayerRow {
  playerExternalId: string;
  difficultyScore: number | null;
  xgiPer90: number | null;
  xgcPer90: number | null;
  nextFixtures: FplNextFixture[];
}
```

- [ ] **Step 2: Extend `FplSheetPlayerDbRow` and `fromFplSheetPlayerRow`**

Find:

```typescript
interface FplSheetPlayerDbRow {
  external_player_id: string;
  difficulty_score: number | null;
  xgi_per_90: number | null;
  xgc_per_90: number | null;
  data_fetched: string;
}
```

Replace it with:

```typescript
interface FplSheetPlayerDbRow {
  external_player_id: string;
  difficulty_score: number | null;
  xgi_per_90: number | null;
  xgc_per_90: number | null;
  data_fetched: string;
  next_fixtures: Array<{ gw: number; opponent: string; is_home: boolean }>;
}
```

Find:

```typescript
function fromFplSheetPlayerRow(row: FplSheetPlayerDbRow): FplSheetPlayerRow {
  return {
    playerExternalId: row.external_player_id,
    difficultyScore: row.difficulty_score,
    xgiPer90: row.xgi_per_90,
    xgcPer90: row.xgc_per_90,
  };
}
```

Replace it with:

```typescript
function fromFplSheetPlayerRow(row: FplSheetPlayerDbRow): FplSheetPlayerRow {
  return {
    playerExternalId: row.external_player_id,
    difficultyScore: row.difficulty_score,
    xgiPer90: row.xgi_per_90,
    xgcPer90: row.xgc_per_90,
    nextFixtures: (row.next_fixtures ?? []).map((fixture) => ({
      gw: fixture.gw,
      opponent: fixture.opponent,
      isHome: fixture.is_home,
    })),
  };
}
```

- [ ] **Step 3: Add `next_fixtures` to the `fetchFplSheetData` select**

Find, inside `fetchFplSheetData`:

```typescript
    .select("external_player_id, difficulty_score, xgi_per_90, xgc_per_90, data_fetched")
```

Replace it with:

```typescript
    .select("external_player_id, difficulty_score, xgi_per_90, xgc_per_90, data_fetched, next_fixtures")
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully. (`MatchupPrepCard`/`computeToughFixtures` only read `.difficultyScore`, so this additive field doesn't break them.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/leagues.ts
git commit -m "Expose next_fixtures on FplSheetPlayerRow"
```

---

## Task 9: `fetchNextGameweekPreview` data layer

**Files:**
- Modify: `apps/web/lib/leagues.ts`

- [ ] **Step 1: Add `fetchPlayerProjections`, `NextGameweekPreview`, and `fetchNextGameweekPreview`**

In `apps/web/lib/leagues.ts`, find the end of `fetchFplSheetData` (it ends with the closing `}` right before the `// "Standings" = ...` comment that precedes `fetchStandings`). Insert the following new code directly between `fetchFplSheetData` and that comment:

```typescript
interface PlayerProjectionDbRow {
  external_player_id: string;
  projected_points: number;
}

async function fetchPlayerProjections(
  sourceId: string,
  sportId: string,
  week: number,
  playerExternalIds: string[]
): Promise<Map<string, number>> {
  if (playerExternalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("player_projections")
    .select("external_player_id, projected_points")
    .eq("source_id", sourceId)
    .eq("sport_id", sportId)
    .eq("week", week)
    .in("external_player_id", playerExternalIds);

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row: PlayerProjectionDbRow) => [row.external_player_id, row.projected_points])
  );
}

interface H2HFixtureDbRow {
  opponent_external_team_id: string | null;
}

export interface NextGameweekPreview {
  week: number;
  opponentTeam: FantasyTeam;
  myRoster: RosterPlayerRow[];
  opponentRoster: RosterPlayerRow[];
  projections: Map<string, number>;
  fplSheetData: Map<string, FplSheetPlayerRow>;
}

// FPL-only, and only meaningful for the actual current week (see
// fetchLeagueTeamView's isCurrentHeadToHeadWeek guard, the same gate
// Matchup Prep uses). "Their team" here is the opponent's *current*
// squad — a preview, not their locked lineup for next week, since FPL's
// API genuinely doesn't expose a future gameweek's picks before its
// deadline. See
// docs/superpowers/specs/2026-09-11-next-gameweek-preview-design.md.
async function fetchNextGameweekPreview(
  league: League,
  myTeam: FantasyTeam,
  teams: FantasyTeam[],
  myCurrentRoster: RosterPlayerRow[],
  currentWeek: number
): Promise<NextGameweekPreview | null> {
  const nextWeek = currentWeek + 1;

  const { data, error } = await supabase
    .from("h2h_fixtures")
    .select("opponent_external_team_id")
    .eq("source_id", league.sourceId)
    .eq("external_league_id", league.externalLeagueId)
    .eq("external_team_id", myTeam.externalTeamId)
    .eq("week", nextWeek)
    .maybeSingle();

  if (error) {
    throw new Error(`warehouse query failed: ${error.message}`);
  }

  const opponentExternalTeamId = (data as H2HFixtureDbRow | null)?.opponent_external_team_id ?? null;
  if (!opponentExternalTeamId) {
    return null;
  }

  const opponentTeam = teams.find((team) => team.externalTeamId === opponentExternalTeamId);
  if (!opponentTeam) {
    return null;
  }

  const opponentRoster = await fetchRoster(
    league.sourceId,
    league.externalLeagueId,
    opponentTeam.externalTeamId,
    currentWeek
  );

  const allPlayerIds = [
    ...new Set([...myCurrentRoster, ...opponentRoster].map((player) => player.playerExternalId)),
  ];

  const [projections, fplSheetData] = await Promise.all([
    fetchPlayerProjections(league.sourceId, league.sportId, nextWeek, allPlayerIds),
    fetchFplSheetData(allPlayerIds),
  ]);

  return {
    week: nextWeek,
    opponentTeam,
    myRoster: myCurrentRoster,
    opponentRoster,
    projections,
    fplSheetData,
  };
}
```

- [ ] **Step 2: Add `nextGameweekPreview` to `LeagueTeamView`**

Find:

```typescript
  matchupPreview: Map<string, MatchupPreviewRow> | null;
  fplSheetData: Map<string, FplSheetPlayerRow> | null;
}
```

Replace it with:

```typescript
  matchupPreview: Map<string, MatchupPreviewRow> | null;
  fplSheetData: Map<string, FplSheetPlayerRow> | null;
  nextGameweekPreview: NextGameweekPreview | null;
}
```

- [ ] **Step 3: Compute it in `fetchLeagueTeamView` and return it**

Find:

```typescript
  const fplSheetData =
    isCurrentHeadToHeadWeek && league.sourceId === "fpl" ? await fetchFplSheetData(rosterPlayerIds) : null;

  return {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings: standingsWithStrength,
    matchupPreview,
    fplSheetData,
```

Replace it with:

```typescript
  const fplSheetData =
    isCurrentHeadToHeadWeek && league.sourceId === "fpl" ? await fetchFplSheetData(rosterPlayerIds) : null;

  const nextGameweekPreview =
    isCurrentHeadToHeadWeek && league.sourceId === "fpl"
      ? await fetchNextGameweekPreview(league, myTeam, teams, myRoster, week)
      : null;

  return {
    league,
    week,
    latestWeek,
    myTeam,
    myScore,
    myRoster,
    opponentTeam,
    opponentScore,
    opponentRoster,
    standings: standingsWithStrength,
    matchupPreview,
    fplSheetData,
    nextGameweekPreview,
```

(Leave the line after it — the closing `};` — unchanged.)

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/leagues.ts
git commit -m "Add fetchNextGameweekPreview data layer"
```

---

## Task 10: `NextGameweekPreviewCard` component

**Files:**
- Create: `apps/web/components/ui/NextGameweekPreviewCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Card from "./Card";
import SectionHeader from "./SectionHeader";
import Avatar from "./Avatar";
import Badge from "./Badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "./Table";

export interface NextGameweekPreviewPlayerRow {
  playerExternalId: string;
  playerName: string;
  isStarter: boolean;
  projectedPoints: number | null;
  nextFixture: string | null;
}

function formatProjected(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function RosterColumn({
  teamName,
  roster,
}: {
  teamName: string;
  roster: NextGameweekPreviewPlayerRow[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Avatar name={teamName} size="sm" />
        <h4 className="text-sm font-semibold text-ink-primary">{teamName}</h4>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Player</Th>
              <Th>Proj.</Th>
              <Th>Next fixture</Th>
            </Tr>
          </Thead>
          <Tbody>
            {roster.map((player) => (
              <Tr key={player.playerExternalId} className={player.isStarter ? "" : "opacity-50"}>
                <Td className="flex items-center gap-2">
                  {player.playerName}
                  <Badge variant={player.isStarter ? "starter" : "bench"}>
                    {player.isStarter ? "Starter" : "Bench"}
                  </Badge>
                </Td>
                <Td>{formatProjected(player.projectedPoints)}</Td>
                <Td>{player.nextFixture ?? "—"}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

export default function NextGameweekPreviewCard({
  week,
  myTeamName,
  opponentTeamName,
  myRoster,
  opponentRoster,
}: {
  week: number;
  myTeamName: string;
  opponentTeamName: string;
  myRoster: NextGameweekPreviewPlayerRow[];
  opponentRoster: NextGameweekPreviewPlayerRow[];
}) {
  return (
    <Card className="mt-6">
      <SectionHeader
        title={`Next Gameweek Preview — Week ${week}`}
        description={`Current squads shown below — subject to change before the Gameweek ${week} deadline.`}
      />
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <RosterColumn teamName={myTeamName} roster={myRoster} />
        <RosterColumn teamName={opponentTeamName} roster={opponentRoster} />
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully (this component isn't imported anywhere yet, so this just checks the file itself is valid TypeScript/JSX).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/NextGameweekPreviewCard.tsx
git commit -m "Add NextGameweekPreviewCard component"
```

---

## Task 11: Wire the card into the league page

**Files:**
- Modify: `apps/web/app/leagues/[leagueId]/page.tsx`

- [ ] **Step 1: Add imports**

Find:

```tsx
import Link from "next/link";
import {
  fetchLeagueTeamView,
  type FplSheetPlayerRow,
  type PlayerValueRow,
  type RosterPlayerRow,
  type StandingsRow,
} from "@/lib/leagues";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import SectionHeader from "@/components/ui/SectionHeader";
import TeamCompareChart from "@/components/ui/TeamCompareChart";
import MatchupPrepCard, { type ToughFixture, type WeakSpot } from "@/components/ui/MatchupPrepCard";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
```

Replace it with:

```tsx
import Link from "next/link";
import {
  fetchLeagueTeamView,
  type FplSheetPlayerRow,
  type PlayerValueRow,
  type RosterPlayerRow,
  type StandingsRow,
} from "@/lib/leagues";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import SectionHeader from "@/components/ui/SectionHeader";
import TeamCompareChart from "@/components/ui/TeamCompareChart";
import MatchupPrepCard, { type ToughFixture, type WeakSpot } from "@/components/ui/MatchupPrepCard";
import NextGameweekPreviewCard, {
  type NextGameweekPreviewPlayerRow,
} from "@/components/ui/NextGameweekPreviewCard";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
```

Note: `NextGameweekPreview` (the data-layer type) is deliberately **not**
imported here — the destructured `nextGameweekPreview` value below gets
its type inferred from `view`'s return type, and nothing in this file
annotates a variable with it explicitly. Importing it anyway would be an
unused import and fail this project's lint-on-build.

- [ ] **Step 2: Add `computeNextGameweekRoster` helper**

Find `computeToughFixtures` (it ends with `return fixtures;\n}` and is followed by the `TOUGH_FIXTURE_THRESHOLD` constant's own preceding comment, then `interface RosterRowView`). Insert this new function directly after `computeToughFixtures`'s closing brace, before `interface RosterRowView`:

```tsx
function computeNextGameweekRoster(
  roster: RosterPlayerRow[],
  projections: Map<string, number>,
  fplSheetData: Map<string, FplSheetPlayerRow>,
  week: number
): NextGameweekPreviewPlayerRow[] {
  return roster.map((player) => {
    const sheetRow = fplSheetData.get(player.playerExternalId);
    const fixture = sheetRow?.nextFixtures.find((f) => f.gw === week) ?? null;
    return {
      playerExternalId: player.playerExternalId,
      playerName: player.playerName,
      isStarter: player.isStarter,
      projectedPoints: projections.get(player.playerExternalId) ?? null,
      nextFixture: fixture ? `${fixture.opponent} (${fixture.isHome ? "H" : "A"})` : null,
    };
  });
}
```

- [ ] **Step 3: Destructure `nextGameweekPreview` from the view**

Find:

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
  } = view;
```

Replace it with:

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

- [ ] **Step 4: Render the card**

Find:

```tsx
      {opponentTeam && matchupPreview && (
        <MatchupPrepCard
          opponentTeamName={opponentTeam.teamName}
          weakSpots={weakSpots}
          opponentStrength={opponentStrength}
          toughFixtures={toughFixtures}
        />
      )}
```

Replace it with:

```tsx
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
```

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npm run build`
Expected: Compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/leagues/\[leagueId\]/page.tsx
git commit -m "Render Next Gameweek Preview card on the league page"
```

---

## Task 12: Backfill real data and verify live

**Files:** none (data operations + manual verification only)

- [ ] **Step 1: Run the full test suites one more time**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: PASS (all tests)

Run: `cd apps/web && npm run build`
Expected: Compiles successfully.

- [ ] **Step 2: Backfill `h2h_fixtures` for the real FPL h2h league**

The sandbox has no `SUPABASE_SERVICE_ROLE_KEY`, so this can't run through the normal `python -m fantasy_ingest.sync_leagues` path here (that's fine — the scheduled GitHub Action will pick this up automatically going forward, since Task 6 made it flow through the existing pipeline with no new wiring). For an immediate, one-off backfill so the feature is visible before the next scheduled run:

1. Write a small local script that imports `FPLAdapter` from `fantasy_ingest.adapters.fpl`, calls `fetch_h2h_league_data(league_id="401057", my_entry_id="16163")` (the real league/entry used throughout this project's prior verification rounds — confirm these are still the right IDs via `select * from public.leagues where source_id='fpl' and format='head_to_head'` if unsure), and writes `result.h2h_fixtures` out as batched `insert into public.h2h_fixtures (...) values (...) on conflict (source_id, external_league_id, external_team_id, week) do nothing;` statements — remember `source_id` and `external_league_id` aren't on `H2HFixture` itself, so supply them as constants (`'fpl'`, `'401057'`) in the script, same as `_h2h_fixture_rows` does in the real sync path.
2. Run each generated batch file against the linked Supabase project with `supabase db query -f <file> --linked` (link first with `supabase link --project-ref wsmegxfnmkhaailxhuih` if not already linked in this session) — this project already uses this mechanism for prior backfills (see `docs/superpowers/specs/2026-09-10-fpl-planner-historical-backfill-COMPLETE.md`), and it's far cheaper than pasting SQL through the conversation via `execute_sql`.
3. Verify: `select count(*) from public.h2h_fixtures where source_id='fpl' and external_league_id='401057';` should return roughly one row per team per gameweek (e.g. ~20 teams × 38 weeks ≈ 760, though bye weeks reduce this slightly).

- [ ] **Step 3: Backfill next-week projections**

Similarly, write a small local script calling `FPLAdapter().fetch_next_week_projections()` and `FPLAdapter().current_gameweek()`, generate `insert into public.player_projections (source_id, sport_id, week, external_player_id, projected_points) values (...) on conflict (source_id, sport_id, week, external_player_id) do update set projected_points = excluded.projected_points;` batches (source_id='fpl', sport_id='premier-league', week=current_gameweek()+1), and run them the same way.

Verify: `select count(*) from public.player_projections where source_id='fpl' and week = (select max(week) from public.player_projections where source_id='fpl');` should return a count in the hundreds (one row per FPL player), matching the "current week" projections count from the existing sync.

- [ ] **Step 4: Verify live in the browser**

1. Start the dev server (`.claude/launch.json` should already have a `web` configuration from prior rounds — use `preview_start` with `name: "web"`; if it's missing, recreate it pointing at `npm --prefix apps/web run dev` on port 3000).
2. Navigate to the real FPL h2h league page (`/leagues/3` matches the id used throughout this project's prior verification, but confirm via `select id from public.leagues where source_id='fpl' and format='head_to_head';` if unsure).
3. Confirm a "Next Gameweek Preview" card appears below Matchup Prep, showing:
   - The correct next-week opponent's team name (cross-check against `select opponent_external_team_id from public.h2h_fixtures where external_team_id='16163' and week = <current+1>;`).
   - Both rosters populated with player names, Starter/Bench badges matching this week's actual lineup.
   - Non-empty projected-points values for most players (a few legitimately-unprojected players, e.g. a long-term injury, showing "—" is fine and correct).
   - Non-empty next-fixture text (e.g. "ARS (H)") for most players.
4. Navigate to a past week (`?week=1`) on the same league and confirm the card does **not** appear (the `isCurrentHeadToHeadWeek` gate).
5. Navigate to the FPL classic league page and confirm the card does not appear there either (no `h2h_fixtures` rows exist for a classic league, and `opponentTeam` is never set for one).
6. Navigate to a Sleeper league page and confirm the card does not appear (gated on `league.sourceId === "fpl"`).

- [ ] **Step 5: Deploy**

Since `apps/web` auto-deploys from `main` on every push, no separate deploy step is needed beyond the commits already made in Tasks 8–11 — just confirm the production URL (`https://reality-manager.vercel.app`, password-protected) shows the same result as Step 4 once Vercel's build finishes.
