# Dashboard polish upgrade — real-software-product craft level

## Context

The first redesign pass (see `2026-09-09-dashboard-ui-redesign-design.md`)
established the dark/neon-green identity and a basic component system, but
reads as flat/generic compared to real product UI. The user supplied three
Dribbble reference PDFs (rendered to images via `poppler`, since the initial
`pdftoppm` binary wasn't installed in this environment) for a target polish
level:

- **Live Sports Dashboard** (Shiby Ghosh) — dark navy, layered/elevated
  cards, W/D/L colored form pills, position-change arrows, live badges,
  crest-rich rows, pill sport-switcher tabs.
- **Golf Analytics Dashboard** (Nasir Uddin) — light-mode SaaS, icon nav
  with filled-pill active state, avatar-tagged athlete list, a radar chart
  comparing "last month vs this month" across stat axes.
- **BOLTLIVE** (Rizky Dwi Hidayat) — deep navy/charcoal, icon+count nav
  tabs, league-grouped match rows with live pulse indicators, tight
  data-dense layout.

Direction confirmed with the user: keep the existing dark/neon-green
identity (already shipped, matches the original Figma brief); raise
*execution* to this polish level rather than adopting any one reference's
palette wholesale.

**Radar chart note:** the user approved "build it" on a proposal that
mentioned a radar chart for the consistency data. Per the `dataviz` skill's
form-selection guidance, a radar/spider chart isn't an endorsed default
form — two- or three-axis radars are known to distort magnitude via area
and are sensitive to axis order. The job here is "tell two series (My Team
vs Opponent) apart across a few metrics," whose skill-endorsed default form
is a grouped bar. Substituting a small grouped/dual bar comparison for the
literal radar — same underlying idea (head-to-head stat comparison),
better-executed form.

## Scope

Visual/craft upgrade only, no new backend queries. One exception: standings
week-over-week point deltas reuse data `fetchStandings` already fetches
(all weekly_scores rows for the league) but currently discards down to one
row per team — capturing one more row per team is using already-fetched
data more fully, not a new data source.

No fake/non-functional UI: skipped a decorative top-bar search box and
notification/settings icons that would do nothing when clicked, since half-
finished-looking chrome reads as broken, not polished.

## Design tokens (additions to existing palette)

- Elevation: `--shadow-card` / `--shadow-card-hover` (soft black box-shadow
  at low opacity — real depth instead of a flat 1px border)
- Status colors (distinct from the single accent, for W/L/T semantics):
  `--status-win: var(--accent)`, `--status-loss: #FF5C5C`,
  `--status-tie: #FFC24B`
- Second categorical series color for two-team comparisons (team-compare
  chart, opponent avatar chips): `--series-opponent: #4EA1FF` (blue —
  chosen for safe, standard blue/green separation under all common CVD
  types, consistent with the `dataviz` skill's categorical palette
  structure; not re-deriving our whole palette from its generic default
  since we already have a validated brand direction)

## Component additions/changes — `apps/web/components/ui/`

- `Card.tsx`: add real box-shadow (`--shadow-card`), optional `interactive`
  prop for hover-lift (translateY + `--shadow-card-hover`)
- `Avatar.tsx` (new): circular colored-initials chip. Background color
  picked deterministically from a small fixed set (not random) by a hash
  of the name, so the same name always gets the same color across a
  session. Used for team/owner identity, not per-player roster rows (24
  avatars in a roster table would be clutter the references don't actually
  show — they use avatars for team/owner-level identity and athlete
  *lists*, not exhaustive stat tables)
- `TeamCompareChart.tsx` (new): small SVG grouped-bar chart, My Team
  (accent green) vs Opponent (`--series-opponent` blue), three metrics
  computed from already-fetched roster data: Starter Points (sum of
  starter points), Bench Points (sum of bench points), Steadiness (0–100,
  derived from average coefficient-of-variation across roster players who
  have consistency data — `100 - min(CV, 1) * 100`, so lower variance =
  higher steadiness; axis omitted if no roster player has consistency data
  yet). Direct value labels on every bar (no hover layer needed for 6
  static marks); native SVG `<title>` per bar for a lightweight tooltip.
  Renders only for head-to-head matchups with an opponent.
- `Badge.tsx`: add `win`/`loss`/`tie` variants using the new status colors

## Layout changes

- New slim global top bar in `app/layout.tsx` (above the sidebar+main
  split): brand mark (moved out of the sidebar), current date, and a
  static user `Avatar` — real "logged into a real app" chrome without
  fake interactive controls
- Sidebar (`components/Sidebar.tsx` / `SidebarNav.tsx`): active nav item
  becomes a full-width filled pill (stronger active state, matching the
  golf reference's list highlighting) instead of just a left border +
  10%-opacity tint
- Week navigator: small pulsing dot on the "Week N" badge when N is the
  latest synced week (real signal — reuses the existing `latestWeek`
  comparison already in the page, not decorative)

## Page changes

- **League view**: `TeamCompareChart` inserted between the stat-tile row
  and the team panels (head-to-head only); `TeamPanel` header gets an
  `Avatar` next to the team name; standings rows get an owner `Avatar` and
  a colored week-over-week point delta (▲/▼ + diff, green/red/gray)
- **Players page**: `Avatar` added to each player row (uses only existing
  name data)
- All `Card` usages benefit automatically from the new shadow/elevation

## Verification

Same constraint as before: this sandbox can reach the live Supabase
warehouse (confirmed working in the prior round, contrary to the original
`docs/ARCHITECTURE.md` egress note), so I'll verify visually in the
browser preview with real data — build, dev server, screenshots of the
league view (both head-to-head and classic), players page, and the new
top bar/sidebar, plus a console-error check. The `TeamCompareChart` is a
static SVG; no chart-library dependency added.
