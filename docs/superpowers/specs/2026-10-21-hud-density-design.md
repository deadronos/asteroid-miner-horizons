# HUD density — design

**Issue:** #161.

## Goal

Keep the playfield usable at 1024×768 and 1280×720 without pushing a primary action below a fold. Before this
change the left and right panels were placed with fixed `top`/`bottom` offsets and `calc(100vh - N)` heights, so
at 720 px tall the shipyard sat entirely below the fleet panel's fold and the ship panel cut off its empty slots,
while the help box covered the bottom centre of the playfield for as long as it was enabled.

## Design

### Columns instead of fixed offsets

The fleet, contracts and event log move into a left `.hud-col`; the selected ship and refinery into a right one.
Each column is an absolutely positioned flex column from the top bar's bottom edge (64 px) to the window's bottom
edge, with `pointer-events: none` so its empty middle never blocks the canvas. The upper panel sits at the top and
the lower one is pushed down with `margin-top: auto`, matching the old placement, but now they share the column's
height instead of each guessing at it: whichever panel is shorter leaves its space to the other. Panels keep
their own widths and `zoom: var(--hud-scale)`, so HUD scale still works; `blockerRects` also reads panels inside
a column so map labels keep clear of them.

### Per-panel collapse

Fleet, contracts, ship and refinery get a collapse button in their top-right corner. A collapsed panel shows only
its first heading. The panel body is a scroll container of its own, so the button never scrolls away.

The setting `hudCollapsed: Partial<Record<HudPanelId, boolean>>` stores only explicit choices. With no choice
stored a panel follows its automatic state: the refinery is collapsed while its queue is empty, every other panel
is open. Toggling a panel stores the new state, unless it equals the automatic one, in which case the stored
choice is removed, so the refinery returns to auto-collapsing once the player puts it back the way auto would.

### Compact mode

`hudCompact` (Interface → HUD) tightens panel padding, row spacing and the event log, and narrows the side panels
by 30 px. It is an opt-in preference; the breakpoints below handle the default layout.

### Help box

`showHelp: boolean` becomes `help: 'auto' | 'on' | 'off'`, defaulting to `auto`. Auto shows the help box only
while the profile's lifetime play time (`profile.stats.time`) is under three minutes, so new players see it and
returning players do not. A new `?` button in the top bar and the existing help key toggle visibility: hiding it
stores `off`, showing it stores `on` (shown until hidden again). A stored legacy `showHelp: false` loads as `off`.
Below 1200 px wide the box no longer fits between the log and the right column; in auto mode it stays hidden
there as before, but when the player asks for it it is shown centred at the bottom, over the log, rather than
silently doing nothing.

### Breakpoints

- **≤ 1279 px wide:** side panels narrow to 230 px (left) and 270 px (right).
- **≤ 800 px tall:** the event log is capped at 110 px and panel padding and heading margins shrink, so the fleet
  panel's shipyard and the ship panel's slots fit at 720 px.
- **≤ 820 px wide:** the existing narrow layout, now only setting widths since the columns handle heights.

## Boundaries and trade-offs

- No sim change: the help clock reads the existing `profile.stats.time`, so there is no save-shape change and no
  `SAVE_VERSION` bump. Settings are not versioned; `SettingsStore.merge` validates the new keys.
- A collapsed refinery hides its queue buttons. That is the requested auto-collapse; the header and its expand
  button stay visible, and expanding it once keeps it open.
- The layout is CSS; the testable logic (help visibility, toggles, collapse state) lives in pure helpers in
  `src/ui/hudLayout.ts`, following the "test the pure seam" convention.
