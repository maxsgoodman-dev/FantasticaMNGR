# FPL Manager Season History Ingestion — Implementation Plan

See design doc:
`docs/superpowers/specs/2026-09-11-fpl-manager-season-history-design.md`.

## Steps

### 1. Adapter method + tests (TDD, commit 1)

1. Add fixture + failing tests to
   `services/ingestion/tests/test_fpl_adapter.py`:
   - `test_normalize_entry_history_maps_past_seasons` — hand-written
     fixture matching the real shape (`current`, `past`, `chips` keys),
     asserts the returned list of dicts has the right keys/values for 2+
     seasons, in order.
   - `test_normalize_entry_history_returns_empty_list_when_no_past_seasons`
     — fixture with `"past": []`, asserts `[]` back (valid case, not an
     error).
   - `test_normalize_entry_history_casts_rank_percentage_to_number` — the
     fixture's `rank_percentage` is a string (`"36"`, matching FPL's real
     encoding); assert the normalized value is numeric, not a string.
   - `test_fetch_entry_history_calls_the_right_url_and_returns_normalized_rows`
     — `httpx.MockTransport`-based, matching every other
     `fetch_*`-level test in this file, asserts the URL path
     (`/entry/{id}/history/`) and that the returned rows match
     `_normalize_entry_history`'s output for that fixture.
2. Run `pytest tests/test_fpl_adapter.py -v` — confirm the new tests fail
   (function/method doesn't exist yet).
3. Implement `_normalize_entry_history` and
   `FPLAdapter.fetch_entry_history` in
   `services/ingestion/fantasy_ingest/adapters/fpl.py` per the design
   doc's snippet (add `ENTRY_HISTORY_URL` alongside the other URL
   constants at the top of the file).
4. Run `pytest tests/test_fpl_adapter.py -v` — confirm all pass, including
   pre-existing tests (no regression).
5. Commit: adapter method + tests.

### 2. Migration (commit 2)

1. Check `supabase/migrations/` for the actual next available number at
   commit time (likely `0006_...sql`, but confirm — concurrent work may
   have landed `0006` already; if so use the next free number and don't
   worry about renumbering, per the task's own instruction that whoever
   merges will handle collisions).
2. Write
   `supabase/migrations/000N_fpl_manager_season_history.sql` with the
   table + RLS policy from the design doc, plus a short header comment
   (matching `0005`'s style) pointing at the design doc.
3. Apply via `mcp__supabase__apply_migration` against the `reality-manager`
   project (id discovered via `mcp__supabase__list_projects` —
   confirmed this session: `wsmegxfnmkhaailxhuih`).
4. Verify the table exists and RLS is on:
   `select * from public.fpl_manager_season_history limit 1;` (expect 0
   rows, no error) and check `pg_tables`/`pg_policies` if useful.
5. Commit: migration file.

### 3. Backfill script + run (commit 3)

1. Write a local, uncommitted script (same precedent as the
   `fpl_player_season_stats` backfill — no new committed Python sync
   module) that:
   - Queries `select distinct external_team_id from public.fantasy_teams
     where source_id = 'fpl';` via `mcp__supabase__execute_sql` to get the
     125 known entry_ids (confirmed count this session).
   - Instantiates one `FPLAdapter()` (one shared `httpx.Client`,
     reused across all 125 calls — no reason to reconnect per entry).
   - Sequentially calls `fetch_entry_history(entry_id)` per entry_id,
     wrapped in try/except; on success, extend a `rows` list with each
     season dict + that `entry_id`; on failure, append
     `{"entry_id": entry_id, "error": str(error)}` to a `failures` list
     and continue (per the design doc's isolation approach). If a 429 is
     hit, sleep briefly and retry once before recording a failure.
   - Prints a summary: entries succeeded / failed (with reasons), total
     rows collected.
   - Batches the collected rows (~100-200 per batch, matching the
     precedent's batch-size reasoning) into
     `insert into public.fpl_manager_season_history (entry_id,
     season_name, total_points, rank, rank_percentage) values (...), ...
     on conflict (entry_id, season_name) do update set
     total_points = excluded.total_points, rank = excluded.rank,
     rank_percentage = excluded.rank_percentage, updated_at = now();` run
     through `mcp__supabase__execute_sql`.
2. Run it. Record the actual outcome (succeeded/failed counts, reasons,
   total row count) — these numbers go directly into the final report,
   not fabricated in advance.
3. Do not commit the script itself (matching the `fpl_player_season_stats`
   precedent: "a local, uncommitted script" — the backfill is a one-time
   operation, not a standing tool); commit only a short note of what was
   run and its outcome, e.g. as an addendum in the design doc or the
   commit message body, matching how the precedent's completion doc
   (`2026-09-10-fpl-planner-warehouse-merge-COMPLETE.md`) recorded its
   own outcome — check that file's format and follow it here too if a
   `*-COMPLETE.md` pattern is expected.
4. Commit: whatever backfill record artifact this produces (verification
   notes / COMPLETE doc), no Python script.

### 4. Full verification pass

1. Fresh venv: `cd services/ingestion && python3 -m venv .venv &&
   source .venv/bin/activate && pip install -e . pytest && pytest` — must
   be 100% green, record before/after test counts.
2. Spot-check 2-3 real entry_ids: pick e.g. entry `1` (already fetched
   this session) plus 2 more from the 125 known entries, `curl` their
   `/history/` endpoint directly, compare `past` rows to what's in the
   warehouse table for that `entry_id`.
3. RLS check: `set role anon; select * from
   public.fpl_manager_season_history limit 3;` via `execute_sql` —
   expect real rows, not a permission error.

### 5. Final report

Per the task's report format: branch name, adapter method signature,
test count before/after, table row count + succeeded/failed entry
counts (with failure reasons if any), 2-3 verified sample rows, RLS
result, and explicit judgment calls (column types for `rank`/
`rank_percentage`, dict-vs-dataclass return shape, zero-past-seasons
handling, chips excluded).
