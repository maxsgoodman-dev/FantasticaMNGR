# Scheduled Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions scheduled workflow that runs the two existing, manually-invoked sync scripts (`fantasy_ingest.warehouse` and `fantasy_ingest.sync_leagues`) every 6 hours, closing the "Scheduled sync / polling — planned" item in `docs/ARCHITECTURE.md`.

**Architecture:** One workflow file, `.github/workflows/sync.yml`, triggered by `schedule` (cron) and `workflow_dispatch` (manual runs). Single job: checkout, set up Python 3.10, `pip install -e services/ingestion`, then run both scripts in sequence with secrets injected via `env:`. No changes to the Python scripts themselves — see `docs/superpowers/specs/2026-09-09-scheduled-sync-design.md` for the full design and what's explicitly out of scope (adaptive interval, Slack notifications, split schedules).

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `actions/setup-python@v5`), the existing `fantasy_ingest` Python package — no new dependencies.

---

### Task 1: Add the scheduled workflow

**Files:**
- Create: `.github/workflows/sync.yml`

- [x] **Step 1: Write the workflow file**

Create `.github/workflows/sync.yml`:

```yaml
name: Sync fantasy data

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/ingestion
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.10"

      - name: Install fantasy_ingest
        run: pip install -e .

      - name: Sync platform-wide teams/players catalog
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: python -m fantasy_ingest.warehouse

      - name: Sync configured leagues (rosters/scores)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SLEEPER_USER_ID: ${{ secrets.SLEEPER_USER_ID }}
          SLEEPER_LEAGUE_IDS: ${{ secrets.SLEEPER_LEAGUE_IDS }}
          FPL_ENTRY_ID: ${{ secrets.FPL_ENTRY_ID }}
          FPL_H2H_LEAGUE_ID: ${{ secrets.FPL_H2H_LEAGUE_ID }}
          FPL_CLASSIC_LEAGUE_ID: ${{ secrets.FPL_CLASSIC_LEAGUE_ID }}
        run: python -m fantasy_ingest.sync_leagues
```

Notes for the engineer implementing this:
- `defaults.run.working-directory` applies only to `run:` steps, not `uses:` steps — `actions/checkout` still checks out the whole repo at the job's root, which is what we want since `actions/setup-python` and the working-directory default both need the full checkout present.
- The two `run` steps are two separate `env:` blocks (not one shared block) because `warehouse.py` doesn't need the league-specific vars — keeping them separate documents which script actually reads which var, matching `.env.example`'s own grouping (see that file's two comment blocks).
- Every `secrets.X` reference here needs a matching repository secret or it resolves to an empty string at runtime — see Task 2's note on this before expecting a real run to succeed.

- [x] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/sync.yml'))"`
Expected: no output, exit code 0

- [x] **Step 3: Sanity-check the two entrypoints still exist and fail the way this plan assumes**

This confirms the exact module paths used in the workflow are correct and that `sync_leagues` really does exit 0 with no configured leagues (so an org that hasn't set the league secrets yet doesn't get a failing scheduled run) — run from a scratch venv so it matches what the Actions runner will do:

```bash
cd services/ingestion
python3 -m venv /tmp/sync-workflow-check
source /tmp/sync-workflow-check/bin/activate
pip install -e . -q
python -m fantasy_ingest.warehouse; echo "warehouse exit: $?"
python -m fantasy_ingest.sync_leagues; echo "sync_leagues exit: $?"
deactivate
rm -rf /tmp/sync-workflow-check
cd ../..
```

Expected:
- `python -m fantasy_ingest.warehouse` exits non-zero (currently a `KeyError: 'SUPABASE_URL'` traceback — that's the existing behavior of `_client()` in `warehouse.py`, not something this plan changes) — this is fine to see locally with no env vars set; it's exactly why the workflow step supplies `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` via `secrets:`.
- `python -m fantasy_ingest.sync_leagues` prints `sync_leagues: no leagues configured — see .env.example` and exits 0.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/sync.yml
git commit -m "Add scheduled GitHub Actions workflow for warehouse + league sync"
```

---

### Task 2: Document the required secrets and update ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [x] **Step 1: Update the "Scheduled sync / polling" section**

In `docs/ARCHITECTURE.md`, find this heading (currently marked **planned**):

```markdown
## 2. Scheduled sync / polling — **planned**

A scheduler that polls each connected source on an interval, tightening the
interval during live games (e.g. Sunday NFL windows, active PL matchdays) and
backing off between them. Not built yet. `fantasy_ingest.warehouse.sync_all`
(stage 3) does the actual fetch-and-upsert work already — running it on a
schedule is the remaining piece, not a rewrite. Right now it's invoked
manually (`python -m fantasy_ingest.warehouse`).
```

Replace it with:

```markdown
## 2. Scheduled sync / polling — **built** (fixed interval)

`.github/workflows/sync.yml` runs `fantasy_ingest.warehouse` (platform-wide
teams/players catalog) and `fantasy_ingest.sync_leagues` (league-scoped
rosters/scores) on a fixed 6-hour cron schedule, plus `workflow_dispatch` for
manual runs — replacing the old "invoke it by hand" flow. The adaptive
version of this (tightening the interval during live game windows, backing
off otherwise) is still open; see
`docs/superpowers/specs/2026-09-09-scheduled-sync-design.md` for why fixed
interval shipped first.

**Required repository secrets** (`Settings → Secrets and variables →
Actions`), matching `services/ingestion/.env.example`: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SLEEPER_USER_ID`, `SLEEPER_LEAGUE_IDS`,
`FPL_ENTRY_ID`, `FPL_H2H_LEAGUE_ID`, `FPL_CLASSIC_LEAGUE_ID`. Until these are
set, the scheduled run fails at the `warehouse` step (missing
`SUPABASE_URL`) — set them via the GitHub UI or `gh secret set <NAME>`
(which prompts for the value rather than taking it as a plain CLI argument).
```

- [x] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "Document scheduled sync as built; note required GitHub Actions secrets"
```

---

### Task 3: Manual verification (repo owner, after secrets are set)

**Files:** none — this task is a runbook, not code, since it needs real secret values this plan's executor should not handle directly (see the design spec's Config & secrets section).

- [x] **Step 1: Repo owner sets the 7 secrets listed in Task 2**, via the GitHub UI (`Settings → Secrets and variables → Actions → New repository secret`) or `gh secret set <NAME>` run locally by the repo owner (each prompts for the value on stdin rather than taking it as a visible argument).

- [x] **Step 2: Trigger a manual run**

Run: `gh workflow run sync.yml --ref main`
Expected: queues a run; `gh run list --workflow=sync.yml` shows it, and `gh run watch` (or the repo's Actions tab) shows both `warehouse` and `sync_leagues` steps completing.

- [x] **Step 3: Confirm the cron will fire on schedule**

Run: `gh workflow view sync.yml`
Expected: output includes the workflow's `schedule` trigger; GitHub Actions cron runs are evaluated in UTC and can be delayed under load, so the first scheduled (non-manual) run may land later than exactly 6 hours after this check — that's a GitHub Actions platform characteristic, not a bug in this workflow.
