# Dashboard responsive layout fix

## Context

Flagged twice during the two prior UI passes and left as an explicit
known gap both times: below the `md` breakpoint the sidebar stayed in
normal flow (pushing/cramping content) instead of collapsing, and the
team-panel two-column grid kicked in at exactly the `md` (768px)
breakpoint — the same width as a typical tablet viewport, so content
overflowed right at the boundary. Continuing dev work by closing this
gap now that the visual polish pass is settled.

## Change

- New `SidebarContext` (client) holds open/closed drawer state, provided
  once at the root layout.
- `SidebarShell` (client) wraps the sidebar's server-rendered content:
  fixed off-canvas overlay + backdrop below `md`, static in-flow panel at
  `md` and up — same pattern as `SidebarNav`, keeping `Sidebar.tsx` itself
  a server component that only fetches data.
- `MenuButton` (client, `md:hidden`) in the top bar toggles the drawer.
- Nav links close the drawer on click (`onClick={close}` threaded through
  `NavItem`), via a small `PlayersNavLink` client wrapper for the one
  static link that lives outside `SidebarNav`.
- Breakpoint tuning: the league page's stat-tile row now stacks below
  `sm` instead of always being 3-wide; the team-panel grid now goes
  2-column at `lg` (1024px) instead of `md` (768px), since two roster
  tables with badges need more than 384px each to be comfortable.
- `main` padding is responsive (`p-4` mobile, `p-10` desktop) and gets
  `overflow-x-hidden` as a safety net.

## Verification

Build passes clean. Verified in the browser at the `mobile` (375×812)
preset: drawer opens via the hamburger, closes on backdrop click or nav
link click (confirmed via DOM inspection — `translate-x-0` /
`-translate-x-full` toggling correctly, and `location.pathname`
navigating on link click), no horizontal overflow, stat tiles stack.
Desktop layout re-verified unchanged after the breakpoint edits, no
console errors on either.
