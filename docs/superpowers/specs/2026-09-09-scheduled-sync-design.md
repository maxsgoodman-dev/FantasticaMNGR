# Scheduled Sync Design

## Goal

`fantasy_ingest.warehouse` (platform-wide teams/players catalog) and
`fantasy_ingest.sync_leagues` (league-scoped rosters/scores — what the new
`/leagues/[leagueId]` team-view UI actually reads) are both invoked by hand
today. This closes stage 2 of the pipeline (`docs/ARCHITECTURE.md`, "Scheduled
sync / polling — planned") with a fixed-interval scheduler, so the dashboard
has data without someone running a script manually. Adaptive interval
tightening (denser polling during live game windows, backing off otherwise —
ARCHITECTURE.md's longer-term vision) is explicitly out of scope for this
pass; there's no live-traffic data yet to tune those thresholds against, and
a fixed interval is what actually unblocks the UI.

## Architecture

A single GitHub Actions scheduled workflow, `.github/workflows/sync.yml`:

- **Trigger:** `schedule` with a cron expression for every 6 hours (`0 */6 * * *`), plus `workflow_dispatch` for manual runs (replacing "SSH in and run it by hand").
- **Steps, one job:**
  1. `actions/checkout`
  2. `actions/setup-python` (3.10, matching `services/ingestion/pyproject.toml`'s `requires-python`)
  3. `pip install -e services/ingestion`
  4. `python -m fantasy_ingest.warehouse`
  5. `python -m fantasy_ingest.sync_leagues`

Both scripts run in the same job, back-to-back, on the same schedule — they write to the same warehouse and there's no reason yet to tune their frequencies independently. If step 4 succeeds and step 5 fails (or vice versa), the job is marked failed overall, but whatever the successful script wrote is already committed to the warehouse (each script's own upsert logic is independent per-row, not transactional across the whole run — consistent with how `sync_all`/`sync_all_leagues` already behave when run manually).

## Config & secrets

Both scripts read their config from environment variables, exactly as documented in `services/ingestion/.env.example` today:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS — sensitive)
- `SLEEPER_USER_ID`, `SLEEPER_LEAGUE_IDS`
- `FPL_ENTRY_ID`, `FPL_H2H_LEAGUE_ID`, `FPL_CLASSIC_LEAGUE_ID`

These become GitHub Actions repository secrets (`Settings → Secrets and variables → Actions`), injected into the job via `env:`. Nothing is committed. Setting the actual values is a manual, repo-owner-only step — an agent should not type `SUPABASE_SERVICE_ROLE_KEY`'s value into a tool call even if handed it directly; `gh secret set <NAME>` (which prompts for the value rather than taking it as a visible CLI argument, or reads from a local file/stdin the user controls) or the GitHub web UI are the paths for the human to use.

## Error handling

No new error-handling logic in the Python scripts. `sync_all` and `sync_all_leagues` already isolate one adapter's/league's failure from the others (confirmed live with ESPN's `/teams`-vs-`/roster` inconsistency — see `docs/ARCHITECTURE.md` stage 1/3). `sync_leagues.main()` already treats "zero leagues configured" as a no-op success (prints a message, exits 0), so an unconfigured league doesn't fail the workflow. The workflow itself adds no retry/backoff — a script's real exit code is what fails or passes the job.

## Failure visibility

A failed run shows as a red X in the repo's Actions tab (GitHub's own default account-level "notify on workflow failure" email applies if the repo owner has that enabled — no new integration). Slack/other notification integration is explicitly out of scope for this pass.

## Testing / verification

Nothing here is unit-testable application logic (the adapters' and warehouse's own test suites already cover the Python side; this is purely a scheduling/CI concern). Verification is:

- The workflow YAML is valid (GitHub will reject an invalid workflow file at push time / show a parse error in the Actions tab).
- A manual `workflow_dispatch` run succeeds once the repo secrets are populated (this requires the repo owner to add the secrets first — cannot be verified from this sandbox, which also can't reach Supabase or the three platform APIs directly, same limitation noted throughout `docs/ARCHITECTURE.md`).
- The cron expression matches the agreed 6-hour interval.

## Explicitly out of scope

- Adaptive/tightening interval logic.
- Slack or other failure notifications.
- Running the platform-wide catalog sync (`warehouse`) and the league-scoped sync (`sync_leagues`) on independent schedules.
- Any change to the adapters, warehouse upsert logic, or `apps/web` — this is scheduling only.
