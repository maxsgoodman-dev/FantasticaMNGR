# Dashboard UI redesign — dark/neon sports-dashboard theme

## Context

`apps/web` is functional but unstyled beyond bare Tailwind slate defaults —
no design system, no reusable components. The user asked for a "proper UI"
using a Figma community file ("Sports Live Dashboard UI Kit") as visual
inspiration. The file's actual dashboard frames are gated behind a Figma
login this environment can't complete (non-interactive session, no OAuth
flow available); only the cover splash frame was visible, which established
the palette direction (near-black background, neon-green accent). The
`figma` MCP connector remains unauthenticated for this session. Proceeding
on the user's explicit go-ahead ("proceed with fast fwd") using that palette
direction plus general sports-dashboard-kit conventions, without exact
frame-level fidelity.

## Scope

Restyle the existing 3 pages (dashboard/home, league team view, players
browse) with a proper component system, and add typical dashboard widgets
that don't exist today (stat tiles, sport-switcher nav, a polished
standings leaderboard) — confirmed with the user. No new backend/data-layer
work; same data sources (`lib/leagues.ts`, `lib/players.ts`) throughout.

## Design tokens

CSS custom properties added to `app/globals.css`, wired into
`tailwind.config.ts` as `colors.bg`, `colors.accent`, etc.:

- `--bg: #0a0a0a` (page background), `--bg-elevated: #141414` (cards),
  `--bg-elevated-hover: #1a1a1a`, `--border: #262626`, `--border-hover:
  #3a3a3a`
- `--accent: #9AFF3D` (neon green — primary actions, active nav state, key
  numbers), `--accent-dim: #6FCC2A` (hover/pressed)
- `--text-primary: #F5F5F5`, `--text-muted: #8A8A8A`, `--text-faint:
  #5C5C5C`
- Error/empty states keep the existing red-900/950 family, just restyled to
  sit inside the new `Card` shell instead of a bare bordered `<div>`
- Typography: `next/font/google` **Inter** (self-hosted by Next at build
  time — no external runtime dependency), replacing the default Tailwind
  sans stack

## Layout shell

- `components/Sidebar.tsx`: brand mark at top, a sport-switcher pill
  toggle (NFL / Premier League) above the grouped league links, active
  league link highlighted with the neon-green accent (left border + text
  color), "Browse all players" promoted to a normal nav item with an icon
  rather than a footer afterthought
- `app/layout.tsx`: main content area gets a slim top bar (page title,
  optional right-aligned controls) instead of a bare `<h1>` per page

## Component library — `apps/web/components/ui/`

- `Card.tsx` — base container: rounded-xl, `--border`, `--bg-elevated`,
  optional `hover` prop for interactive cards
- `StatTile.tsx` — label + large number + optional sublabel/delta, used
  for "My Score" / "Opponent Score" / "Result" in the league view
- `Badge.tsx` — small pill, `variant` prop (`neutral | accent | starter |
  bench`) for starter/bench, head-to-head/classic, "mine"
- `Table.tsx` — styled wrapper (`Table`, `Thead`, `Tbody`, `Tr`, `Th`,
  `Td`) with consistent header casing, hover-row state, zebra option
- `NavItem.tsx` — sidebar link with active-state styling
- `SectionHeader.tsx` — title + optional description, used above each
  page section

All hand-rolled Tailwind, no new npm dependencies (consistent with this
repo's existing per-subproject, minimal-tooling approach) other than
`next/font/google` for Inter, which ships with Next itself.

## Page-by-page

- **`app/page.tsx` (dashboard)**: empty-state and error-state fallbacks
  rewrapped in `Card` with `SectionHeader`, replacing the current plain
  `<div>`/`<h1>`/`<p>` markup. Redirect-to-first-league behavior on success
  is unchanged.
- **`app/leagues/[leagueId]/page.tsx`**: league name + a `Badge` for
  format (head-to-head/classic) next to the title; week navigator
  restyled as a segmented pill control; a `StatTile` row (My Score /
  Opponent Score / Result — Result computed client-side from the two
  scores, W/L/T, no new data needed); `TeamPanel` becomes a `Card` with
  its roster table using `Table` + `Badge` (starter/bench); standings
  section becomes a ranked leaderboard `Card` — rank number, `Badge` for
  "mine", using `Table`.
- **`app/players/page.tsx`**: intro copy inside a `Card`; each sport
  section becomes a `Card`-wrapped `Table` with a position `Badge` and a
  source `Badge` per row.

## Error handling

No behavior changes — every page already degrades gracefully per
`docs/ARCHITECTURE.md` (inline per-section error / `502` from the API
route). This redesign only changes how those same states are *presented*
(inside `Card` instead of a bare bordered `<div>`), not when they fire.

## Verification

This sandbox's egress proxy blocks `*.supabase.co` (see
`docs/ARCHITECTURE.md`), so live-data screens can't be rendered from here
regardless of code correctness. Verification plan:

1. `npm run build` in `apps/web` — type-checks and lints the whole app.
2. Run the dev server and view the empty-state and error-state paths in
   the browser preview (these *do* render here, since they're the
   graceful-failure branches that don't depend on a successful Supabase
   call) — confirms the new `Card`/`Badge`/`Table` components render
   correctly, responsive behavior is sane, and no console errors.
3. Populated-data screens (a real players table, a real league matchup)
   can't be visually verified from this sandbox — noted explicitly rather
   than claimed as tested. The user can verify those directly since their
   own machine has a real Supabase connection.
