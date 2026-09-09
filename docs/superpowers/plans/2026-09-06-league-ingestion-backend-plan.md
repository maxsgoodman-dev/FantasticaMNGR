# League Ingestion Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest league-scoped rosters and already-computed fantasy points from Sleeper (2 head-to-head NFL leagues) and FPL (1 head-to-head + 1 classic soccer league) into new Supabase tables, so a later UI plan can build the team-view dashboard on top of real data.

**Architecture:** New Supabase tables (`leagues`, `fantasy_teams`, `weekly_scores`, `roster_players`) keyed by natural external IDs (source + external league/team id), not surrogate FKs — this avoids ever needing to read back an auto-generated ID from an upsert, matching how the existing `players`/`teams` tables already work (`players.team` is a plain string, not a FK lookup). `SleeperAdapter` and `FPLAdapter` each gain new league-scoped fetch methods (`fetch_league_data`, `fetch_h2h_league_data`, `fetch_classic_league_data`) that call each platform's public league/entry endpoints and return a new `LeagueSyncResult` dataclass. A new `sync_league_data`/`sync_all_leagues` pair in `warehouse.py` upserts those results, isolating one league's failure from the rest (same principle as the existing `sync_all`). A new `league_config.py` reads league IDs from environment variables and builds the sync jobs.

**Tech Stack:** Python (`services/ingestion`, existing `httpx`-based adapters), Supabase/Postgres (via the Supabase MCP tools — `apply_migration`/`execute_sql`, which work from this sandbox even though direct HTTP to the project's own host does not), `pytest` + `httpx.MockTransport` for tests (no live network calls, matching every existing adapter test in this package).

**Note on scope vs. the design spec:** [docs/superpowers/specs/2026-09-06-league-team-view-design.md](../specs/2026-09-06-league-team-view-design.md) described `weekly_scores`/`roster_players` referencing `fantasy_teams` via a bigint `team_id` FK. This plan uses natural keys (`source_id`, `external_league_id`, `external_team_id`) instead — same relationships, but avoids a real problem the surrogate-key design would hit: every write here goes through Supabase's PostgREST upsert with `return=minimal` (same as the existing `sync_adapter`), which never hands back the generated ID of a row it just inserted or matched. Natural keys sidestep that entirely, and it's exactly the pattern `players`/`teams` already use (`unique(source_id, external_id)`, no generated-ID round-trip needed).

---

### Task 1: Supabase schema — new league tables

**Files:**
- Create: `supabase/migrations/0001_league_tables.sql`
- (Live change) Applied to the `reality-manager` Supabase project (id `wsmegxfnmkhaailxhuih`) via the Supabase MCP `apply_migration` tool.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0001_league_tables.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool `apply_migration` with `project_id: "wsmegxfnmkhaailxhuih"`, `name: "league_tables"`, and `query` set to the exact SQL above.

- [ ] **Step 3: Verify**

Use the Supabase MCP tool `list_tables` with `project_id: "wsmegxfnmkhaailxhuih"`, `schemas: ["public"]`, `verbose: true`. Confirm all four new tables appear with `rls_enabled: true` and the columns/FKs above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_league_tables.sql
git commit -m "Add league-scoped warehouse tables (leagues, fantasy_teams, weekly_scores, roster_players)"
```

---

### Task 2: League data models

**Files:**
- Create: `services/ingestion/fantasy_ingest/league_models.py`
- Test: `services/ingestion/tests/test_league_models.py`

- [ ] **Step 1: Write the failing test**

Create `services/ingestion/tests/test_league_models.py`:

```python
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore


def test_fantasy_team_fields():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    assert team.external_id == "1"
    assert team.name == "Team Alpha"
    assert team.owner_name == "Max"
    assert team.is_mine is True


def test_weekly_score_fields():
    score = WeeklyScore(team_external_id="1", week=3, points=87.5, opponent_external_id="2")
    assert score.team_external_id == "1"
    assert score.week == 3
    assert score.points == 87.5
    assert score.opponent_external_id == "2"


def test_weekly_score_opponent_defaults_to_none():
    score = WeeklyScore(team_external_id="1", week=3, points=87.5)
    assert score.opponent_external_id is None


def test_roster_entry_fields():
    entry = RosterEntry(
        team_external_id="1",
        week=3,
        player_external_id="101",
        player_name="Patrick Mahomes",
        is_starter=True,
        points=24.0,
    )
    assert entry.team_external_id == "1"
    assert entry.player_name == "Patrick Mahomes"
    assert entry.is_starter is True
    assert entry.points == 24.0


def test_league_sync_result_bundles_the_three_lists():
    team = FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)
    score = WeeklyScore(team_external_id="1", week=1, points=10.0)
    entry = RosterEntry(
        team_external_id="1", week=1, player_external_id="101", player_name="P", is_starter=True, points=5.0
    )

    result = LeagueSyncResult(teams=[team], weekly_scores=[score], roster_players=[entry])

    assert result.teams == [team]
    assert result.weekly_scores == [score]
    assert result.roster_players == [entry]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && pytest tests/test_league_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fantasy_ingest.league_models'`

- [ ] **Step 3: Write the implementation**

Create `services/ingestion/fantasy_ingest/league_models.py`:

```python
from dataclasses import dataclass, field


@dataclass
class FantasyTeam:
    external_id: str
    name: str
    owner_name: str
    is_mine: bool


@dataclass
class WeeklyScore:
    team_external_id: str
    week: int
    points: float
    opponent_external_id: str | None = None


@dataclass
class RosterEntry:
    team_external_id: str
    week: int
    player_external_id: str
    player_name: str
    is_starter: bool
    points: float


@dataclass
class LeagueSyncResult:
    teams: list[FantasyTeam] = field(default_factory=list)
    weekly_scores: list[WeeklyScore] = field(default_factory=list)
    roster_players: list[RosterEntry] = field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ingestion && pytest tests/test_league_models.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/league_models.py services/ingestion/tests/test_league_models.py
git commit -m "Add league_models dataclasses for league-scoped sync results"
```

---

### Task 3: Sleeper — normalize helpers (teams, weekly matchups)

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/sleeper.py`
- Test: `services/ingestion/tests/test_sleeper_adapter.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_sleeper_adapter.py`:

```python
from fantasy_ingest.adapters.sleeper import _normalize_league_teams, _normalize_week
from fantasy_ingest.league_models import FantasyTeam, RosterEntry, WeeklyScore

ROSTERS_FIXTURE = [
    {"roster_id": 1, "owner_id": "u1", "metadata": {"team_name": "Dynasty Warriors"}},
    {"roster_id": 2, "owner_id": "u2", "metadata": {}},
]

USERS_FIXTURE = [
    {"user_id": "u1", "display_name": "MaxG"},
    {"user_id": "u2", "display_name": "RivalPlayer"},
]

MATCHUPS_FIXTURE_WEEK_1 = [
    {
        "roster_id": 1,
        "matchup_id": 100,
        "points": 112.5,
        "starters": ["4046"],
        "players": ["4046", "6786"],
        "players_points": {"4046": 24.0, "6786": 8.0},
    },
    {
        "roster_id": 2,
        "matchup_id": 100,
        "points": 98.0,
        "starters": ["9999"],
        "players": ["9999"],
        "players_points": {"9999": 15.0},
    },
]

BYE_WEEK_FIXTURE = [
    {
        "roster_id": 3,
        "matchup_id": None,
        "points": 50.0,
        "starters": [],
        "players": [],
        "players_points": {},
    },
]

NAMES_BY_ID = {"4046": "Patrick Mahomes", "6786": "Justin Jefferson", "9999": "Old Retired Guy"}


def test_normalize_league_teams():
    teams = _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")

    assert teams == [
        FantasyTeam(external_id="1", name="Dynasty Warriors", owner_name="MaxG", is_mine=True),
        FantasyTeam(external_id="2", name="RivalPlayer", owner_name="RivalPlayer", is_mine=False),
    ]


def test_normalize_league_teams_falls_back_to_display_name_when_no_team_name():
    teams = _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")

    assert teams[1].name == "RivalPlayer"


def test_normalize_week_pairs_opponents_and_computes_scores():
    scores, roster_entries = _normalize_week(MATCHUPS_FIXTURE_WEEK_1, week=1, names_by_id=NAMES_BY_ID)

    assert WeeklyScore(team_external_id="1", week=1, points=112.5, opponent_external_id="2") in scores
    assert WeeklyScore(team_external_id="2", week=1, points=98.0, opponent_external_id="1") in scores
    assert RosterEntry(
        team_external_id="1",
        week=1,
        player_external_id="4046",
        player_name="Patrick Mahomes",
        is_starter=True,
        points=24.0,
    ) in roster_entries
    assert RosterEntry(
        team_external_id="1",
        week=1,
        player_external_id="6786",
        player_name="Justin Jefferson",
        is_starter=False,
        points=8.0,
    ) in roster_entries


def test_normalize_week_handles_bye_week_with_no_matchup_id():
    scores, roster_entries = _normalize_week(BYE_WEEK_FIXTURE, week=1, names_by_id=NAMES_BY_ID)

    assert scores == [WeeklyScore(team_external_id="3", week=1, points=50.0, opponent_external_id=None)]
    assert roster_entries == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_sleeper_adapter.py -v -k "league_teams or normalize_week"`
Expected: FAIL with `ImportError: cannot import name '_normalize_league_teams'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/adapters/sleeper.py`, add the import and two functions (place after `_normalize_players`, before `class SleeperAdapter`):

```python
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore
```

```python
def _normalize_league_teams(rosters_json: list[dict], users_json: list[dict], my_user_id: str) -> list[FantasyTeam]:
    users_by_id = {user["user_id"]: user for user in users_json}
    teams = []
    for roster in rosters_json:
        owner_id = roster.get("owner_id")
        user = users_by_id.get(owner_id, {})
        display_name = user.get("display_name", "Unknown")
        team_name = (roster.get("metadata") or {}).get("team_name") or display_name
        teams.append(
            FantasyTeam(
                external_id=str(roster["roster_id"]),
                name=team_name,
                owner_name=display_name,
                is_mine=(owner_id == my_user_id),
            )
        )
    return teams


def _normalize_week(
    matchups_json: list[dict], week: int, names_by_id: dict[str, str]
) -> tuple[list[WeeklyScore], list[RosterEntry]]:
    # Sleeper groups two opposing rosters under a shared matchup_id; a
    # team on bye that week has matchup_id: null and no opponent.
    grouped: dict[int, list[dict]] = {}
    solo: list[dict] = []
    for entry in matchups_json:
        matchup_id = entry.get("matchup_id")
        if matchup_id is None:
            solo.append(entry)
        else:
            grouped.setdefault(matchup_id, []).append(entry)

    scores: list[WeeklyScore] = []
    roster_entries: list[RosterEntry] = []
    for group in list(grouped.values()) + [[entry] for entry in solo]:
        for entry in group:
            opponent = next((other for other in group if other is not entry), None)
            roster_id = str(entry["roster_id"])
            scores.append(
                WeeklyScore(
                    team_external_id=roster_id,
                    week=week,
                    points=float(entry.get("points") or 0.0),
                    opponent_external_id=str(opponent["roster_id"]) if opponent else None,
                )
            )
            starters = set(entry.get("starters") or [])
            players_points = entry.get("players_points") or {}
            for player_id in entry.get("players") or []:
                roster_entries.append(
                    RosterEntry(
                        team_external_id=roster_id,
                        week=week,
                        player_external_id=str(player_id),
                        player_name=names_by_id.get(str(player_id), "Unknown"),
                        is_starter=player_id in starters,
                        points=float(players_points.get(player_id, 0.0)),
                    )
                )
    return scores, roster_entries
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_sleeper_adapter.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/sleeper.py services/ingestion/tests/test_sleeper_adapter.py
git commit -m "Add Sleeper league team/matchup normalize helpers"
```

---

### Task 4: Sleeper — `fetch_league_data()`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/sleeper.py`
- Test: `services/ingestion/tests/test_sleeper_adapter.py`

- [ ] **Step 1: Write the failing test**

Add `import httpx` to the top of `services/ingestion/tests/test_sleeper_adapter.py` (not yet imported there — the existing tests in that file only exercise pure normalize functions, no `httpx.MockTransport`).

Append to `services/ingestion/tests/test_sleeper_adapter.py`:

```python
def test_fetch_league_data_pulls_teams_and_every_week_so_far():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/players/nfl"):
            return httpx.Response(200, json=PLAYERS_FIXTURE)
        if path.endswith("/league/L1/users"):
            return httpx.Response(200, json=USERS_FIXTURE)
        if path.endswith("/league/L1/rosters"):
            return httpx.Response(200, json=ROSTERS_FIXTURE)
        if path.endswith("/state/nfl"):
            return httpx.Response(200, json={"week": 2})
        if path.endswith("/league/L1/matchups/1"):
            return httpx.Response(200, json=MATCHUPS_FIXTURE_WEEK_1)
        if path.endswith("/league/L1/matchups/2"):
            return httpx.Response(200, json=[])
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = SleeperAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_league_data(league_id="L1", my_user_id="u1")

    assert result.teams == _normalize_league_teams(ROSTERS_FIXTURE, USERS_FIXTURE, my_user_id="u1")
    assert len(result.weekly_scores) == 2  # both rosters, week 1 only (week 2 empty)
    assert any(score.week == 1 and score.team_external_id == "1" for score in result.weekly_scores)
    assert any(entry.player_name == "Patrick Mahomes" for entry in result.roster_players)
```

Add the needed import at the top of the test file (it already imports `httpx` and `SleeperAdapter`; add `_normalize_league_teams` to the existing `from fantasy_ingest.adapters.sleeper import (...)` block if not already present from Task 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && pytest tests/test_sleeper_adapter.py -v -k fetch_league_data`
Expected: FAIL with `AttributeError: 'SleeperAdapter' object has no attribute 'fetch_league_data'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/adapters/sleeper.py`, add URL constants near the top (after `PLAYERS_URL`):

```python
STATE_URL = "https://api.sleeper.app/v1/state/nfl"
LEAGUE_USERS_URL = "https://api.sleeper.app/v1/league/{league_id}/users"
LEAGUE_ROSTERS_URL = "https://api.sleeper.app/v1/league/{league_id}/rosters"
LEAGUE_MATCHUPS_URL = "https://api.sleeper.app/v1/league/{league_id}/matchups/{week}"
```

Add this method to `SleeperAdapter`, after `fetch_matchups`:

```python
    def fetch_league_data(self, league_id: str, my_user_id: str) -> LeagueSyncResult:
        names_by_id = {player.id: player.name for player in self.fetch_players()}

        users = self._client.get(LEAGUE_USERS_URL.format(league_id=league_id)).json()
        rosters = self._client.get(LEAGUE_ROSTERS_URL.format(league_id=league_id)).json()
        teams = _normalize_league_teams(rosters, users, my_user_id)

        current_week = self._client.get(STATE_URL).json()["week"]

        weekly_scores: list[WeeklyScore] = []
        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            matchups = self._client.get(LEAGUE_MATCHUPS_URL.format(league_id=league_id, week=week)).json()
            scores, entries = _normalize_week(matchups, week, names_by_id)
            weekly_scores.extend(scores)
            roster_players.extend(entries)

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ingestion && pytest tests/test_sleeper_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/sleeper.py services/ingestion/tests/test_sleeper_adapter.py
git commit -m "Add SleeperAdapter.fetch_league_data for league-scoped rosters/scores"
```

---

### Task 5: FPL — current-gameweek helper

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_fpl_adapter.py`:

```python
from fantasy_ingest.adapters.fpl import _current_gameweek

EVENTS_FIXTURE = [
    {"id": 1, "is_current": False, "finished": True},
    {"id": 2, "is_current": False, "finished": True},
    {"id": 3, "is_current": True, "finished": False},
    {"id": 4, "is_current": False, "finished": False},
]


def test_current_gameweek_is_the_in_progress_or_latest_finished_week():
    assert _current_gameweek({"events": EVENTS_FIXTURE}) == 3


def test_current_gameweek_raises_when_season_has_not_started():
    import pytest

    with pytest.raises(ValueError, match="no finished or current gameweek"):
        _current_gameweek({"events": [{"id": 1, "is_current": False, "finished": False}]})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v -k current_gameweek`
Expected: FAIL with `ImportError: cannot import name '_current_gameweek'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, add after `_ELEMENT_TYPE_TO_POSITION`:

```python
def _current_gameweek(bootstrap: dict) -> int:
    candidate_ids = [event["id"] for event in bootstrap["events"] if event.get("is_current") or event.get("finished")]
    if not candidate_ids:
        raise ValueError("no finished or current gameweek found in bootstrap-static events")
    return max(candidate_ids)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add FPL current-gameweek helper"
```

---

### Task 6: FPL — picks/roster normalize helper (shared by both league types)

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_fpl_adapter.py`:

```python
from fantasy_ingest.adapters.fpl import _normalize_picks
from fantasy_ingest.league_models import RosterEntry

PICKS_FIXTURE = {
    "picks": [
        {"element": 101, "position": 1, "multiplier": 1, "is_captain": False},
        {"element": 201, "position": 2, "multiplier": 2, "is_captain": True},
        {"element": 301, "position": 12, "multiplier": 0, "is_captain": False},
    ],
    "entry_history": {"points": 65, "event": 4},
}

LIVE_POINTS_FIXTURE = {101: 6, 201: 10, 301: 2}
NAMES_BY_ID_FIXTURE = {101: "Bukayo Saka", 201: "Mohamed Salah", 301: "David Raya"}


def test_normalize_picks_applies_captain_multiplier():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    assert RosterEntry(
        team_external_id="999", week=4, player_external_id="201", player_name="Mohamed Salah",
        is_starter=True, points=20.0,
    ) in entries


def test_normalize_picks_marks_bench_as_not_starter_and_zero_points():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    bench_entry = next(entry for entry in entries if entry.player_external_id == "301")
    assert bench_entry.is_starter is False
    assert bench_entry.points == 0.0


def test_normalize_picks_starting_xi_is_position_11_or_lower():
    entries = _normalize_picks(
        PICKS_FIXTURE, LIVE_POINTS_FIXTURE, NAMES_BY_ID_FIXTURE, team_external_id="999", week=4
    )

    assert len(entries) == 3
    assert sum(1 for entry in entries if entry.is_starter) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v -k normalize_picks`
Expected: FAIL with `ImportError: cannot import name '_normalize_picks'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, add the import and function:

```python
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore
```

```python
def _normalize_picks(
    picks_json: dict,
    live_points_by_id: dict[int, int],
    names_by_id: dict[int, str],
    team_external_id: str,
    week: int,
) -> list[RosterEntry]:
    entries = []
    for pick in picks_json["picks"]:
        element_id = pick["element"]
        base_points = live_points_by_id.get(element_id, 0)
        entries.append(
            RosterEntry(
                team_external_id=team_external_id,
                week=week,
                player_external_id=str(element_id),
                player_name=names_by_id.get(element_id, "Unknown"),
                is_starter=pick["position"] <= 11,
                points=float(base_points * pick["multiplier"]),
            )
        )
    return entries
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add FPL picks-to-roster normalize helper with captain multiplier"
```

---

### Task 7: FPL — classic league standings normalize + `fetch_classic_league_data()`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_fpl_adapter.py`:

```python
from fantasy_ingest.adapters.fpl import _normalize_classic_standings
from fantasy_ingest.league_models import FantasyTeam

CLASSIC_STANDINGS_PAGE_1 = {
    "standings": {
        "has_next": True,
        "results": [
            {"entry": 111, "entry_name": "Team Alpha", "player_name": "Max Goodman", "total": 987},
            {"entry": 222, "entry_name": "Team Beta", "player_name": "Someone Else", "total": 950},
        ],
    }
}

CLASSIC_STANDINGS_PAGE_2 = {
    "standings": {
        "has_next": False,
        "results": [
            {"entry": 333, "entry_name": "Team Gamma", "player_name": "A Third Person", "total": 900},
        ],
    }
}


def test_normalize_classic_standings_lists_every_entry_as_a_team():
    teams, _ = _normalize_classic_standings(
        [CLASSIC_STANDINGS_PAGE_1, CLASSIC_STANDINGS_PAGE_2], my_entry_id="111", week=4
    )

    assert teams == [
        FantasyTeam(external_id="111", name="Team Alpha", owner_name="Max Goodman", is_mine=True),
        FantasyTeam(external_id="222", name="Team Beta", owner_name="Someone Else", is_mine=False),
        FantasyTeam(external_id="333", name="Team Gamma", owner_name="A Third Person", is_mine=False),
    ]


def test_normalize_classic_standings_only_scores_entries_that_are_not_mine():
    # My own entry's weekly scores come from per-week picks instead (see
    # fetch_classic_league_data) — the standings total is season-cumulative,
    # not a real per-week number, so it must not collide with that.
    _, scores = _normalize_classic_standings(
        [CLASSIC_STANDINGS_PAGE_1, CLASSIC_STANDINGS_PAGE_2], my_entry_id="111", week=4
    )

    assert all(score.team_external_id != "111" for score in scores)
    assert any(score.team_external_id == "222" and score.points == 950.0 for score in scores)
    assert any(score.team_external_id == "333" and score.points == 900.0 for score in scores)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v -k normalize_classic_standings`
Expected: FAIL with `ImportError: cannot import name '_normalize_classic_standings'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/adapters/fpl.py`, add URL constants near the top:

```python
CLASSIC_STANDINGS_URL = "https://fantasy.premierleague.com/api/leagues-classic/{league_id}/standings/"
ENTRY_PICKS_URL = "https://fantasy.premierleague.com/api/entry/{entry_id}/event/{week}/picks/"
EVENT_LIVE_URL = "https://fantasy.premierleague.com/api/event/{week}/live/"
```

Add the normalize function (after `_normalize_picks`):

```python
def _normalize_classic_standings(
    pages: list[dict], my_entry_id: str, week: int
) -> tuple[list[FantasyTeam], list[WeeklyScore]]:
    teams = []
    scores = []
    for page in pages:
        for result in page["standings"]["results"]:
            entry_id = str(result["entry"])
            is_mine = entry_id == my_entry_id
            teams.append(
                FantasyTeam(
                    external_id=entry_id,
                    name=result["entry_name"],
                    owner_name=result["player_name"],
                    is_mine=is_mine,
                )
            )
            if not is_mine:
                scores.append(
                    WeeklyScore(team_external_id=entry_id, week=week, points=float(result["total"]))
                )
    return teams, scores
```

Add the pagination helper and `fetch_classic_league_data` method to `FPLAdapter` (after `fetch_matchups`):

```python
    def _fetch_standings_pages(self, url: str) -> list[dict]:
        pages = []
        page = 1
        while True:
            response = self._client.get(url, params={"page_standings": page})
            response.raise_for_status()
            data = response.json()
            pages.append(data)
            if not data["standings"]["has_next"]:
                break
            page += 1
        return pages

    def fetch_classic_league_data(self, league_id: str, my_entry_id: str) -> LeagueSyncResult:
        bootstrap = self._fetch_bootstrap_static()
        current_week = _current_gameweek(bootstrap)
        names_by_id = {element["id"]: f"{element['first_name']} {element['second_name']}" for element in bootstrap["elements"]}

        pages = self._fetch_standings_pages(CLASSIC_STANDINGS_URL.format(league_id=league_id))
        teams, weekly_scores = _normalize_classic_standings(pages, my_entry_id, current_week)

        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            live = self._client.get(EVENT_LIVE_URL.format(week=week)).json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}

            picks = self._client.get(ENTRY_PICKS_URL.format(entry_id=my_entry_id, week=week)).json()
            roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, my_entry_id, week))
            weekly_scores.append(
                WeeklyScore(team_external_id=my_entry_id, week=week, points=float(picks["entry_history"]["points"]))
            )

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
```

- [ ] **Step 4: Write the integration test**

Add `import httpx` to the top of `services/ingestion/tests/test_fpl_adapter.py` (not yet imported there — the existing tests in that file only exercise pure normalize functions, no `httpx.MockTransport`).

Append to `services/ingestion/tests/test_fpl_adapter.py`. `_current_gameweek` on `EVENTS_FIXTURE[:3]` (ids 1 and 2 finished, id 3 current) returns `3`, so `range(1, current_week + 1)` requests weeks 1, 2, and 3 — the handler below covers all three:

```python
def test_fetch_classic_league_data_gives_my_entry_full_weekly_history_and_others_just_a_snapshot():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": EVENTS_FIXTURE[:3]})
        if path.endswith("/leagues-classic/C1/standings/"):
            return httpx.Response(
                200,
                json={"standings": {**CLASSIC_STANDINGS_PAGE_1["standings"], "has_next": False}},
            )
        if path.endswith("/event/1/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 6}}]})
        if path.endswith("/event/2/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 7}}]})
        if path.endswith("/event/3/live/"):
            return httpx.Response(200, json={"elements": [{"id": 101, "stats": {"total_points": 9}}]})
        if path.endswith("/entry/111/event/1/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 55}}
            )
        if path.endswith("/entry/111/event/2/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 58}}
            )
        if path.endswith("/entry/111/event/3/picks/"):
            return httpx.Response(
                200, json={"picks": [{"element": 101, "position": 1, "multiplier": 1}], "entry_history": {"points": 60}}
            )
        raise AssertionError(f"unexpected request: {request.url}")

    adapter = FPLAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))

    result = adapter.fetch_classic_league_data(league_id="C1", my_entry_id="111")

    my_scores = [s for s in result.weekly_scores if s.team_external_id == "111"]
    assert {s.week for s in my_scores} == {1, 2, 3}
    other_scores = [s for s in result.weekly_scores if s.team_external_id == "222"]
    assert other_scores == [WeeklyScore(team_external_id="222", week=3, points=950.0)]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add FPL classic-league standings normalize and fetch_classic_league_data"
```

---

### Task 8: FPL — h2h standings/matches normalize + `fetch_h2h_league_data()`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/adapters/fpl.py`
- Test: `services/ingestion/tests/test_fpl_adapter.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_fpl_adapter.py`:

```python
from fantasy_ingest.adapters.fpl import _normalize_h2h_matches, _normalize_h2h_teams

H2H_STANDINGS_PAGE = {
    "standings": {
        "has_next": False,
        "results": [
            {"entry": 111, "entry_name": "Team Alpha", "player_name": "Max Goodman"},
            {"entry": 222, "entry_name": "Team Beta", "player_name": "Rival Person"},
        ],
    }
}

H2H_MATCHES_PAGE = {
    "has_next": False,
    "results": [
        {"event": 1, "entry_1_entry": 111, "entry_1_points": 65, "entry_2_entry": 222, "entry_2_points": 58},
        {"event": 2, "entry_1_entry": 111, "entry_1_points": 70, "entry_2_entry": None, "entry_2_points": 0},
    ],
}


def test_normalize_h2h_teams():
    teams = _normalize_h2h_teams([H2H_STANDINGS_PAGE], my_entry_id="111")

    assert teams == [
        FantasyTeam(external_id="111", name="Team Alpha", owner_name="Max Goodman", is_mine=True),
        FantasyTeam(external_id="222", name="Team Beta", owner_name="Rival Person", is_mine=False),
    ]


def test_normalize_h2h_matches_produces_a_score_row_per_side():
    scores = _normalize_h2h_matches([H2H_MATCHES_PAGE])

    assert WeeklyScore(team_external_id="111", week=1, points=65.0, opponent_external_id="222") in scores
    assert WeeklyScore(team_external_id="222", week=1, points=58.0, opponent_external_id="111") in scores


def test_normalize_h2h_matches_handles_a_bye_with_no_second_entry():
    scores = _normalize_h2h_matches([H2H_MATCHES_PAGE])

    week_2_scores = [s for s in scores if s.week == 2]
    assert week_2_scores == [WeeklyScore(team_external_id="111", week=2, points=70.0, opponent_external_id=None)]
```

Add `import httpx` to the top of `services/ingestion/tests/test_fpl_adapter.py` if Task 7 didn't already add it in this working copy (check the file first — it's the same file both tasks touch).

Also append this integration test for the fetch method itself (single-week league here, to keep the fixture small — `_current_gameweek` semantics are already covered by Task 5's tests):

```python
def test_fetch_h2h_league_data_pulls_teams_matches_and_every_teams_roster():
    events_one_week = [{"id": 1, "is_current": True, "finished": False}]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/bootstrap-static/"):
            return httpx.Response(200, json=BOOTSTRAP_STATIC_FIXTURE | {"events": events_one_week})
        if path.endswith("/leagues-h2h/H1/standings/"):
            return httpx.Response(200, json={"standings": {**H2H_STANDINGS_PAGE["standings"], "has_next": False}})
        if path.endswith("/leagues-h2h-matches/league/H1/"):
            return httpx.Response(200, json={**H2H_MATCHES_PAGE, "results": [H2H_MATCHES_PAGE["results"][0]]})
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

    assert {team.external_id for team in result.teams} == {"111", "222"}
    assert WeeklyScore(team_external_id="111", week=1, points=65.0, opponent_external_id="222") in result.weekly_scores
    assert {entry.team_external_id for entry in result.roster_players} == {"111", "222"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v -k "h2h_teams or h2h_matches or fetch_h2h_league_data"`
Expected: FAIL — the normalize tests with `ImportError: cannot import name '_normalize_h2h_teams'`, and `test_fetch_h2h_league_data_...` with `AttributeError: 'FPLAdapter' object has no attribute 'fetch_h2h_league_data'`

- [ ] **Step 3: Write the implementation**

Add URL constants:

```python
H2H_STANDINGS_URL = "https://fantasy.premierleague.com/api/leagues-h2h/{league_id}/standings/"
H2H_MATCHES_URL = "https://fantasy.premierleague.com/api/leagues-h2h-matches/league/{league_id}/"
```

Add the two normalize functions (after `_normalize_classic_standings`):

```python
def _normalize_h2h_teams(pages: list[dict], my_entry_id: str) -> list[FantasyTeam]:
    teams = []
    for page in pages:
        for result in page["standings"]["results"]:
            entry_id = str(result["entry"])
            teams.append(
                FantasyTeam(
                    external_id=entry_id,
                    name=result["entry_name"],
                    owner_name=result["player_name"],
                    is_mine=(entry_id == my_entry_id),
                )
            )
    return teams


def _normalize_h2h_matches(pages: list[dict]) -> list[WeeklyScore]:
    scores = []
    for page in pages:
        for match in page["results"]:
            week = match["event"]
            entry_1 = str(match["entry_1_entry"])
            scores.append(
                WeeklyScore(
                    team_external_id=entry_1,
                    week=week,
                    points=float(match["entry_1_points"]),
                    opponent_external_id=str(match["entry_2_entry"]) if match.get("entry_2_entry") is not None else None,
                )
            )
            if match.get("entry_2_entry") is not None:
                scores.append(
                    WeeklyScore(
                        team_external_id=str(match["entry_2_entry"]),
                        week=week,
                        points=float(match["entry_2_points"]),
                        opponent_external_id=entry_1,
                    )
                )
    return scores
```

Add the pagination helper and `fetch_h2h_league_data` method to `FPLAdapter`:

```python
    def _fetch_matches_pages(self, url: str) -> list[dict]:
        pages = []
        page = 1
        while True:
            response = self._client.get(url, params={"page": page})
            response.raise_for_status()
            data = response.json()
            pages.append(data)
            if not data["has_next"]:
                break
            page += 1
        return pages

    def fetch_h2h_league_data(self, league_id: str, my_entry_id: str) -> LeagueSyncResult:
        bootstrap = self._fetch_bootstrap_static()
        current_week = _current_gameweek(bootstrap)
        names_by_id = {element["id"]: f"{element['first_name']} {element['second_name']}" for element in bootstrap["elements"]}

        standings_pages = self._fetch_standings_pages(H2H_STANDINGS_URL.format(league_id=league_id))
        teams = _normalize_h2h_teams(standings_pages, my_entry_id)

        matches_pages = self._fetch_matches_pages(H2H_MATCHES_URL.format(league_id=league_id))
        weekly_scores = _normalize_h2h_matches(matches_pages)

        roster_players: list[RosterEntry] = []
        for week in range(1, current_week + 1):
            live = self._client.get(EVENT_LIVE_URL.format(week=week)).json()
            live_points_by_id = {element["id"]: element["stats"]["total_points"] for element in live["elements"]}
            for team in teams:
                picks = self._client.get(ENTRY_PICKS_URL.format(entry_id=team.external_id, week=week)).json()
                roster_players.extend(_normalize_picks(picks, live_points_by_id, names_by_id, team.external_id, week))

        return LeagueSyncResult(teams=teams, weekly_scores=weekly_scores, roster_players=roster_players)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_fpl_adapter.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/adapters/fpl.py services/ingestion/tests/test_fpl_adapter.py
git commit -m "Add FPL h2h-league normalize helpers and fetch_h2h_league_data"
```

---

### Task 9: Warehouse — `sync_league_data()` / `sync_all_leagues()`

**Files:**
- Modify: `services/ingestion/fantasy_ingest/warehouse.py`
- Test: `services/ingestion/tests/test_warehouse.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/ingestion/tests/test_warehouse.py`:

```python
from fantasy_ingest.league_models import FantasyTeam, LeagueSyncResult, RosterEntry, WeeklyScore
from fantasy_ingest.warehouse import sync_all_leagues, sync_league_data

SLEEPER_LEAGUE = {
    "source_id": "sleeper",
    "sport_id": "nfl",
    "external_league_id": "L1",
    "name": "Test Sleeper League",
    "season": "2026",
    "format": "head_to_head",
}


def make_league_sync_result() -> LeagueSyncResult:
    return LeagueSyncResult(
        teams=[FantasyTeam(external_id="1", name="Team Alpha", owner_name="Max", is_mine=True)],
        weekly_scores=[WeeklyScore(team_external_id="1", week=1, points=100.0, opponent_external_id="2")],
        roster_players=[
            RosterEntry(
                team_external_id="1", week=1, player_external_id="4046", player_name="Patrick Mahomes",
                is_starter=True, points=24.0,
            )
        ],
    )


def test_sync_league_data_posts_league_teams_scores_and_roster(recorded_requests):
    client = make_client(recorded_requests)

    counts = sync_league_data(SLEEPER_LEAGUE, make_league_sync_result(), client=client)

    assert counts == {"teams": 1, "weekly_scores": 1, "roster_players": 1}
    paths = [request.url.path for request in recorded_requests]
    assert paths == ["/leagues", "/fantasy_teams", "/weekly_scores", "/roster_players"]

    league_request = recorded_requests[0]
    assert "on_conflict=source_id,external_league_id" in str(league_request.url)


def test_sync_all_leagues_isolates_a_failing_league(recorded_requests):
    client = make_client(recorded_requests)

    def broken_fetch():
        raise RuntimeError("FPL is down")

    jobs = [
        (SLEEPER_LEAGUE, make_league_sync_result),
        ({**SLEEPER_LEAGUE, "source_id": "fpl", "external_league_id": "L2"}, broken_fetch),
    ]

    results = sync_all_leagues(jobs, client=client)

    assert results["sleeper:L1"] == {"teams": 1, "weekly_scores": 1, "roster_players": 1}
    assert "FPL is down" in results["fpl:L2"]["error"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_warehouse.py -v -k "sync_league_data or sync_all_leagues"`
Expected: FAIL with `ImportError: cannot import name 'sync_league_data'`

- [ ] **Step 3: Write the implementation**

In `services/ingestion/fantasy_ingest/warehouse.py`, add the import:

```python
from typing import Callable

from fantasy_ingest.league_models import LeagueSyncResult
```

Add the row-mapping helpers and sync functions (after `sync_all`, before `main`):

```python
def _league_row(league: dict) -> dict:
    return {
        "source_id": league["source_id"],
        "sport_id": league["sport_id"],
        "external_league_id": league["external_league_id"],
        "name": league["name"],
        "season": league["season"],
        "format": league["format"],
    }


def _fantasy_team_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": team.external_id,
            "team_name": team.name,
            "owner_name": team.owner_name,
            "is_mine": team.is_mine,
        }
        for team in result.teams
    ]


def _weekly_score_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": score.team_external_id,
            "week": score.week,
            "points": score.points,
            "opponent_external_team_id": score.opponent_external_id,
        }
        for score in result.weekly_scores
    ]


def _roster_player_rows(league: dict, result: LeagueSyncResult) -> list[dict]:
    return [
        {
            "source_id": league["source_id"],
            "external_league_id": league["external_league_id"],
            "external_team_id": entry.team_external_id,
            "week": entry.week,
            "player_external_id": entry.player_external_id,
            "player_name": entry.player_name,
            "is_starter": entry.is_starter,
            "points": entry.points,
        }
        for entry in result.roster_players
    ]


def sync_league_data(
    league: dict, result: LeagueSyncResult, client: httpx.Client | None = None
) -> dict[str, int]:
    """Upsert one league's already-fetched sync result into the warehouse.

    `league` describes the league itself (source_id, sport_id,
    external_league_id, name, season, format); `result` is what
    `fetch_league_data` / `fetch_h2h_league_data` / `fetch_classic_league_data`
    returned. Kept separate from `sync_adapter` (which syncs the platform-wide
    teams/players catalogs, untouched by this function).
    """
    owns_client = client is None
    client = client or _client()
    try:
        response = client.post("/leagues?on_conflict=source_id,external_league_id", json=[_league_row(league)])
        response.raise_for_status()

        team_rows = _fantasy_team_rows(league, result)
        if team_rows:
            response = client.post(
                "/fantasy_teams?on_conflict=source_id,external_league_id,external_team_id", json=team_rows
            )
            response.raise_for_status()

        score_rows = _weekly_score_rows(league, result)
        if score_rows:
            response = client.post(
                "/weekly_scores?on_conflict=source_id,external_league_id,external_team_id,week", json=score_rows
            )
            response.raise_for_status()

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


def sync_all_leagues(
    jobs: list[tuple[dict, Callable[[], LeagueSyncResult]]], client: httpx.Client | None = None
) -> dict[str, dict]:
    """Fetch and sync every configured league, isolating one league's failure.

    Each job is `(league, fetch_fn)` — `fetch_fn` is called here (not before),
    so a fetch-time failure is caught per-league too, same as an upsert
    failure, matching sync_all's isolation guarantee for the platform-wide
    catalogs.
    """
    owns_client = client is None
    client = client or _client()
    results: dict[str, dict] = {}
    try:
        for league, fetch_fn in jobs:
            key = f"{league['source_id']}:{league['external_league_id']}"
            try:
                result = fetch_fn()
                results[key] = sync_league_data(league, result, client=client)
            except Exception as error:  # noqa: BLE001 - deliberately broad, see sync_all's docstring
                results[key] = {"error": str(error)}
    finally:
        if owns_client:
            client.close()
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_warehouse.py -v`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/fantasy_ingest/warehouse.py services/ingestion/tests/test_warehouse.py
git commit -m "Add sync_league_data/sync_all_leagues for league-scoped warehouse writes"
```

---

### Task 10: League config — env vars → sync jobs

**Files:**
- Create: `services/ingestion/fantasy_ingest/league_config.py`
- Test: `services/ingestion/tests/test_league_config.py`
- Modify: `services/ingestion/.env.example`

- [ ] **Step 1: Write the failing tests**

Create `services/ingestion/tests/test_league_config.py`:

```python
import os

import pytest

from fantasy_ingest.league_config import build_league_sync_jobs


@pytest.fixture(autouse=True)
def clear_league_env(monkeypatch):
    for key in ["SLEEPER_USER_ID", "SLEEPER_LEAGUE_IDS", "FPL_ENTRY_ID", "FPL_H2H_LEAGUE_ID", "FPL_CLASSIC_LEAGUE_ID"]:
        monkeypatch.delenv(key, raising=False)


def test_build_league_sync_jobs_with_nothing_configured_returns_empty():
    assert build_league_sync_jobs() == []


def test_build_league_sync_jobs_builds_two_sleeper_jobs(monkeypatch):
    monkeypatch.setenv("SLEEPER_USER_ID", "u1")
    monkeypatch.setenv("SLEEPER_LEAGUE_IDS", "L1,L2")

    jobs = build_league_sync_jobs()

    assert [league["external_league_id"] for league, _ in jobs] == ["L1", "L2"]
    assert all(league["source_id"] == "sleeper" for league, _ in jobs)
    assert all(league["format"] == "head_to_head" for league, _ in jobs)
    assert all(callable(fetch_fn) for _, fetch_fn in jobs)


def test_build_league_sync_jobs_builds_fpl_h2h_and_classic(monkeypatch):
    monkeypatch.setenv("FPL_ENTRY_ID", "111")
    monkeypatch.setenv("FPL_H2H_LEAGUE_ID", "H1")
    monkeypatch.setenv("FPL_CLASSIC_LEAGUE_ID", "C1")

    jobs = build_league_sync_jobs()

    formats_by_league_id = {league["external_league_id"]: league["format"] for league, _ in jobs}
    assert formats_by_league_id == {"H1": "head_to_head", "C1": "classic"}
    assert all(league["source_id"] == "fpl" for league, _ in jobs)


def test_build_league_sync_jobs_skips_fpl_when_entry_id_missing(monkeypatch):
    monkeypatch.setenv("FPL_H2H_LEAGUE_ID", "H1")
    monkeypatch.setenv("FPL_CLASSIC_LEAGUE_ID", "C1")

    assert build_league_sync_jobs() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_league_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fantasy_ingest.league_config'`

- [ ] **Step 3: Write the implementation**

Create `services/ingestion/fantasy_ingest/league_config.py`:

```python
"""Build the league-scoped sync jobs from environment configuration.

Each job is `(league, fetch_fn)`, the shape `warehouse.sync_all_leagues`
expects. Season strings are hardcoded to the current season — bump
CURRENT_NFL_SEASON / CURRENT_FPL_SEASON here once a year; they're only a
display label, not used for any lookup.
"""

import os

from fantasy_ingest.adapters.fpl import FPLAdapter
from fantasy_ingest.adapters.sleeper import SleeperAdapter

CURRENT_NFL_SEASON = "2026"
CURRENT_FPL_SEASON = "2026-27"


def build_league_sync_jobs() -> list[tuple[dict, callable]]:
    jobs: list[tuple[dict, callable]] = []

    sleeper_user_id = os.environ.get("SLEEPER_USER_ID")
    if sleeper_user_id:
        league_ids = [x for x in os.environ.get("SLEEPER_LEAGUE_IDS", "").split(",") if x]
        adapter = SleeperAdapter()
        for league_id in league_ids:
            league = {
                "source_id": "sleeper",
                "sport_id": "nfl",
                "external_league_id": league_id,
                "name": f"Sleeper league {league_id}",
                "season": CURRENT_NFL_SEASON,
                "format": "head_to_head",
            }
            jobs.append((league, lambda a=adapter, lid=league_id: a.fetch_league_data(lid, sleeper_user_id)))

    fpl_entry_id = os.environ.get("FPL_ENTRY_ID")
    if fpl_entry_id:
        adapter = FPLAdapter()

        h2h_league_id = os.environ.get("FPL_H2H_LEAGUE_ID")
        if h2h_league_id:
            league = {
                "source_id": "fpl",
                "sport_id": "premier-league",
                "external_league_id": h2h_league_id,
                "name": f"FPL h2h league {h2h_league_id}",
                "season": CURRENT_FPL_SEASON,
                "format": "head_to_head",
            }
            jobs.append((league, lambda a=adapter, lid=h2h_league_id: a.fetch_h2h_league_data(lid, fpl_entry_id)))

        classic_league_id = os.environ.get("FPL_CLASSIC_LEAGUE_ID")
        if classic_league_id:
            league = {
                "source_id": "fpl",
                "sport_id": "premier-league",
                "external_league_id": classic_league_id,
                "name": f"FPL classic league {classic_league_id}",
                "season": CURRENT_FPL_SEASON,
                "format": "classic",
            }
            jobs.append(
                (league, lambda a=adapter, lid=classic_league_id: a.fetch_classic_league_data(lid, fpl_entry_id))
            )

    return jobs
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_league_config.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Update `.env.example`**

Append to `services/ingestion/.env.example`:

```
# League-scoped sync (fantasy_ingest.sync_leagues). Leave any of these unset
# to skip that league entirely — build_league_sync_jobs() only builds jobs
# for what's configured. Yahoo isn't here yet — it needs OAuth2 user auth,
# a separate integration from "add an adapter".
SLEEPER_USER_ID=your-sleeper-account-id
SLEEPER_LEAGUE_IDS=league-id-1,league-id-2
FPL_ENTRY_ID=your-fpl-entry-id
FPL_H2H_LEAGUE_ID=your-h2h-league-id
FPL_CLASSIC_LEAGUE_ID=your-classic-league-id
```

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/fantasy_ingest/league_config.py services/ingestion/tests/test_league_config.py services/ingestion/.env.example
git commit -m "Add league_config to build sync jobs from environment variables"
```

---

### Task 11: CLI entrypoint for league sync

**Files:**
- Create: `services/ingestion/fantasy_ingest/sync_leagues.py`

- [ ] **Step 1: Write the implementation**

Create `services/ingestion/fantasy_ingest/sync_leagues.py`:

```python
"""CLI entrypoint: sync every configured league into the warehouse.

Separate from `fantasy_ingest.warehouse`'s own `main()` (which syncs the
platform-wide teams/players catalogs) — different trigger, different data,
same manual-invocation state as the rest of this repo (no scheduler yet).
"""

from fantasy_ingest.league_config import build_league_sync_jobs
from fantasy_ingest.warehouse import sync_all_leagues


def main() -> None:
    jobs = build_league_sync_jobs()
    if not jobs:
        print("sync_leagues: no leagues configured — see .env.example")
        return

    results = sync_all_leagues(jobs)
    for key, result in results.items():
        if "error" in result:
            print(f"{key}: FAILED — {result['error']}")
        else:
            print(
                f"{key}: {result['teams']} teams, {result['weekly_scores']} weekly scores, "
                f"{result['roster_players']} roster rows"
            )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Sanity-check it imports cleanly**

Run: `cd services/ingestion && python -c "from fantasy_ingest.sync_leagues import main"`
Expected: no output, exit code 0 (no leagues configured in this sandbox, so `main()` itself isn't run here — see CLAUDE.md's network-egress note, this can only be actually invoked from a machine that can reach Sleeper/FPL)

- [ ] **Step 3: Commit**

```bash
git add services/ingestion/fantasy_ingest/sync_leagues.py
git commit -m "Add sync_leagues CLI entrypoint"
```

---

### Task 12: Update ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add a short section describing the new ingestion path**

After the existing "## 3. Shared warehouse" section (before "## 4. Analytics / mart layer"), insert:

```markdown
## 3a. League-scoped ingestion — **built** (Sleeper, FPL)

Separate from the platform-wide `teams`/`players` catalogs above: `leagues`,
`fantasy_teams`, `weekly_scores`, and `roster_players` hold Max's actual
fantasy leagues — 2 Sleeper NFL leagues (head-to-head) and 2 FPL leagues (one
~20-person head-to-head, one ~100-person classic) — with real rosters and
already-computed fantasy points, not a global player list. Yahoo (2 more NFL
leagues) is deferred: it needs OAuth2 user auth, not just an adapter.

Both platforms already compute fantasy points themselves and expose them
publicly (Sleeper's `/league/{id}/matchups/{week}`, FPL's per-gameweek entry
picks + live element points), so this ingests those numbers directly rather
than reimplementing a scoring engine from raw stats.

Keyed by natural external ids throughout (`source_id` + `external_league_id`
+ `external_team_id`, ...), not surrogate-key FKs — every write is a
PostgREST upsert via `fantasy_ingest.warehouse.sync_league_data`, same
pattern as `sync_adapter`, and upserts never hand back a generated id to
chain into a follow-up write.

`fantasy_ingest.league_config.build_league_sync_jobs()` reads league IDs
from environment variables (see `.env.example`); `fantasy_ingest.sync_leagues`
is the manual entrypoint (`python -m fantasy_ingest.sync_leagues`), separate
from `fantasy_ingest.warehouse`'s own catalog sync. See
`docs/superpowers/specs/2026-09-06-league-team-view-design.md` for the full
design, including why the FPL classic league only gets full roster detail
for Max's own entry (the other ~99 are a standings snapshot, not a full
per-entry weekly pull).
```

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "Document league-scoped ingestion in ARCHITECTURE.md"
```

---

### Task 13: Full test suite sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire ingestion test suite**

Run: `cd services/ingestion && pytest -v`
Expected: PASS — every test in `tests/`, old and new (models, all three adapters, warehouse, league_config).

- [ ] **Step 2: If anything fails, fix forward**

Do not skip or delete a failing test. Re-read the specific assertion that failed against the implementation in the same task's file, fix the implementation (not the test) unless the test itself has a bug, and re-run.

---

## What this plan does not cover (by design)

- The league team-view **UI** (reads these tables) — a separate plan.
- The `/players` richer global table — a separate plan, independent of this one.
- **Yahoo** — deferred; needs OAuth2, a different kind of integration than the adapters this plan touches.
- **Actually running a sync against real league IDs** — this sandbox's egress proxy blocks Sleeper/FPL/Supabase's own host directly (per `CLAUDE.md`), same limitation the existing `warehouse.py` sync already has. `sync_leagues.main()` needs to be run from a machine that can reach the internet, with real `SLEEPER_USER_ID`/`SLEEPER_LEAGUE_IDS`/`FPL_ENTRY_ID`/`FPL_H2H_LEAGUE_ID`/`FPL_CLASSIC_LEAGUE_ID` values in the environment.
