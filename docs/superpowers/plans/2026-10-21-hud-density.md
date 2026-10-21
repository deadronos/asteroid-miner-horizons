# HUD density — plan

**Goal:** Compact mode, collapsible panels, an auto-hiding help box and retuned breakpoints so the HUD fits
1024×768 and 1280×720 (#161).

**Architecture:** Settings gain `help`, `hudCompact` and `hudCollapsed`; pure helpers in `src/ui/hudLayout.ts`
decide help visibility and panel collapse; `Hud` places panels in two flex columns and applies the state each
refresh; CSS does the rest.

**Tech Stack:** TypeScript, DOM, CSS. No new dependencies.

**Spec:** [`../specs/2026-10-21-hud-density-design.md`](../specs/2026-10-21-hud-density-design.md)

## Global Constraints

- `src/sim`, `src/core` and `src/data` are untouched; no save-shape change.
- Old settings keep loading (`showHelp: false` → `help: 'off'`).
- `npm run check` green after every task; no new dependencies; do not touch `scratch.md` or `docs/balance.md`.

## Review Focus

- Collapse state that can never return to auto (Task 1).
- `DEFAULTS.hudCollapsed` shared by reference and mutated (Task 1).
- Panels inside the columns missing from `blockerRects` (Task 2).
- A collapse button that scrolls out of view with the panel body (Task 2).

## Task 1: Settings and pure helpers

**Files:** `src/settings.ts`, `src/ui/hudLayout.ts`, `src/ui/menu/form.ts`, `src/ui/menu/SettingsTabs.ts`,
`tests/settings.test.ts`, `tests/hudLayout.test.ts`

- [ ] Replace `showHelp` with `help: HelpMode`; add `hudCompact` and `hudCollapsed`, validated in `merge`.
- [ ] `helpVisible`, `toggledHelp`, `isCollapsed`, `toggledCollapse` in `hudLayout.ts`.
- [ ] Interface tab: help select and compact toggle.

**Done when:** helpers and merge are covered by tests and `npm run check` passes.

## Task 2: Columns, collapse buttons, help button

**Files:** `src/ui/Hud.ts`, `src/ui/panels/TopBar.ts`, `src/input.ts`, `src/style.css`

- [ ] Build the two columns; wrap collapsible panels in a container with a button and a scrolling body.
- [ ] `Hud.toggleHelp` shared by the `?` button and the help key; help visibility applied each refresh.
- [ ] Replace fixed offsets with column rules; add the 1279 px wide and 800 px tall breakpoints and compact rules.

**Done when:** in a browser at 1024×768 and 1280×720 the shipyard, ship slots, contract Accept buttons and
refinery buttons are reachable without scrolling a panel, HUD scale 80–140% still lays out, and `npm run check`
passes.
