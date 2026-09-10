# Matchup Prep Implementation Plan

> See `docs/superpowers/specs/2026-09-10-matchup-prep-design.md` for full
> rationale, platform feasibility findings, and scope boundaries.

**Goal:** Real per-player projections (FPL + Sleeper) plus a community
FPL data sheet (fixture difficulty, xG, DefCon) feeding a current-week
matchup-prep view: projected score / win probability, roster weak-spot
flags, opponent scouting.

---

### Task 1: `player_projections` table

- [ ] Write `supabase/migrations/0007_player_projections.sql` per the
      design doc's schema (platform-wide, week-scoped, RLS public SELECT
      only).
- [ ] Apply via `mcp__supabase__apply_migration`, project id
      `wsmegxfnmkhaailxhuih`.
- [ ] Verify via `list_tables` (verbose) + anon-role RLS check.
- [ ] Commit.

### Task 2: `PlayerProjection` model + adapter interface

- [ ] Add `PlayerProjection` dataclass to `models.py`
      (`player_external_id: str`, `projected_points: float`).
- [ ] Add `fetch_projections(self, week: int) -> list[PlayerProjection]`
      to `FantasySourceAdapter` (non-abstract, default
      `raise NotImplementedError`, same pattern as `fetch_matchups`).
- [ ] Commit.

### Task 3: FPL projections

- [ ] `FPLAdapter.fetch_projections`: reuse `bootstrap-static` (already
      fetched elsewhere in this adapter), map `element["ep_next"]` →
      `projected_points` per element. No new HTTP call.
- [ ] Unit test with a hand-written bootstrap-static fixture (extend the
      existing fixture with an `ep_next` field if not already present),
      no live call — matches this file's established fetch/normalize
      split.
- [ ] Commit.

### Task 4: Sleeper projections

- [ ] `SleeperAdapter.fetch_projections(week)`: new call to
      `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular`
      (season resolved the same way the rest of this adapter already
      does). Map `player_id` → `player_external_id`,
      `stats.pts_ppr` → `projected_points` (skip entries with no
      `pts_ppr`, don't coerce to 0).
- [ ] Unit test with a hand-written fixture (2-3 representative
      records), no live call.
- [ ] Commit.

### Task 5: Warehouse sync for projections

- [ ] `warehouse.py`: add `sync_projections(adapter, week, client)` —
      same upsert-via-PostgREST pattern as `sync_adapter`, targeting
      `player_projections`, `on_conflict=source_id,sport_id,week,external_player_id`.
- [ ] Wire "current week" discovery per platform (reuse
      `_current_gameweek`-equivalent logic FPL/Sleeper already have for
      league sync — platform-wide, no league id needed).
- [ ] Test with `httpx.MockTransport`, matching `sync_adapter`'s
      existing test.
- [ ] Add a step to `.github/workflows/sync.yml` alongside the existing
      `warehouse` / `sync_leagues` steps.
- [ ] Commit.

### Task 6: `fpl_sheet_player_data` table

- [ ] Write `supabase/migrations/0008_fpl_sheet_player_data.sql` per the
      design doc's schema.
- [ ] Apply via `mcp__supabase__apply_migration`, verify via
      `list_tables` + anon-role RLS check, same checklist as every prior
      migration.
- [ ] Commit.

### Task 7: Community sheet fetch + normalize

- [ ] New module `fantasy_ingest/sources/fpl_community_sheet.py`
      (not a `FantasySourceAdapter` — see design doc's rationale):
      `_fetch_csv()` GETs
      `https://docs.google.com/spreadsheets/d/1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM/gviz/tq?tqx=out:csv&sheet=Data`;
      `_normalize_rows(csv_text) -> list[dict]` parses it into rows
      matching the target table.
- [ ] Normalization gotchas to handle explicitly (write a test fixture
      row covering each): `£6.00`-style currency strings → `6.0`;
      comma-formatted large ints (transfers in/out) → plain ints; the
      duplicate column block at positions 43–47 — ignore it, source
      identity/display fields from the first occurrence only (positions
      4/6/7/25/26); `GW4`..`GW9` columns (e.g. `"SUN (A)"`) → parsed into
      `next_fixtures` jsonb (`[{gw, opponent, is_home}]`); blank
      `Chance Of Playing Next` → `NULL`, not `0`.
- [ ] Unit tests with a hand-written CSV fixture (3-4 representative
      rows: a normal player, one with a blank chance-of-playing cell, one
      with an apostrophe/accent in the name) — no live network call,
      matching every other adapter's test convention in this repo.
- [ ] Commit.

### Task 8: Warehouse sync for the community sheet

- [ ] `warehouse.py`: add `sync_fpl_sheet(client)` — fetches +
      normalizes (Task 7), upserts into `fpl_sheet_player_data` on
      `(external_player_id, data_fetched)`, same PostgREST pattern as
      everything else.
- [ ] Test with `httpx.MockTransport`.
- [ ] Add to `sync.yml` on the existing daily schedule (the source sheet
      itself only refreshes once/day at 5 AM GMT — no value in syncing
      more often).
- [ ] Commit.

### Task 9: `matchup_preview` mart view

- [ ] Write and apply the view per the design doc's exact SQL
      (`starters_missing_projection` included — don't silently zero out
      missing data).
- [ ] Verify via `execute_sql` against a real synced league once Task 5
      has run at least once (need real `player_projections` rows to
      check against, not just an empty-table smoke test).
- [ ] Commit migration.

### Task 10: `apps/web` — data layer

- [ ] `lib/leagues.ts`: add `MatchupPreviewRow` type +
      `fetchMatchupPreview(sourceId, externalLeagueId, externalTeamIds,
      week)` querying the new view, following the exact
      `fetchTeamStrength` pattern (same file, right above it).
- [ ] Add a `fetchFplSheetData(externalPlayerIds)` helper (FPL-league
      pages only) for the fixture-difficulty/xG/DefCon enrichment.
- [ ] Wire both into `fetchLeagueTeamView`, but **only fetch when
      `week === latestWeek` and `opponentTeam` exists** — no point
      querying current-week-only data for a past-week page load.

### Task 11: `apps/web` — UI

- [ ] Projected-vs-actual stat tiles + win-probability figure (logistic
      curve over projected differential — pick a reasonable steepness
      constant, document it inline as a simplification, not a fitted
      model).
- [ ] Weak-spot flags: bottom-quartile `tradeValue` among that team's
      starters (already-fetched `playerValue` per roster row — no new
      query beyond Task 10), surfaced as a `Badge` on the roster table
      row (e.g. `variant="loss"`, label "Weak spot") or a small callout
      list above the roster table — pick whichever reads cleaner once
      real data is in front of you. For FPL leagues, fold in
      `difficulty_score`/`xgi_per_90`/`xgc_per_90` from the sheet data
      where a starter has an unusually hard upcoming fixture.
- [ ] Opponent scouting: surface the opponent's `TeamStrengthRow`
      (already fetched for standings) prominently near the top of the
      matchup, not just buried in the standings table.
- [ ] Community-sheet data gets a one-line attribution credit wherever
      it surfaces (see design doc's "Attribution" note).
- [ ] Gate all of this behind `week === latestWeek && opponentTeam` —
      a past week keeps rendering exactly as it does today.
- [ ] Verify live in the browser: current week (all of it renders),
      past week (none of it renders, unchanged), FPL classic league (no
      opponent, none of it renders).

### Task 12: Fix stale `CLAUDE.md` network-egress note

- [ ] Correct the "Network egress is restricted" section — supabase.co,
      fantasy.premierleague.com, api.sleeper.app, site.api.espn.com, and
      docs.google.com's sheet-export endpoints are all directly
      reachable from this sandbox (verified via `curl` this round, and
      via the live dev server in an earlier round for Supabase
      specifically). Don't remove the section outright — future agents
      still benefit from knowing this was checked, not just assumed.
- [ ] Commit.

### Task 13: Update `docs/ARCHITECTURE.md`

- [ ] Add a short "Matchup prep" note under stage 5 (dashboard UI) or a
      new stage, describing the projections table, the community sheet
      source (with attribution), the mart view, and that it's
      Sleeper/FPL-only (ESPN has no league-scoped data).
- [ ] Commit.
