# HUD density — run log

- **Date:** 2026-10-21
- **Issue:** [#161 — HUD density: compact mode, collapsible panels and auto-hide help](https://github.com/deadronos/asteroid-miner-horizons/issues/161)
- **Branch:** `feat/hud-density`
- **Spec:** [`../specs/2026-10-21-hud-density-design.md`](../specs/2026-10-21-hud-density-design.md)
- **Plan:** [`2026-10-21-hud-density.md`](2026-10-21-hud-density.md)
- **Setup:** Isolated worktree from `origin/main` (`04ada45`). No dependency changes. One session implemented
  both tasks; there was no separate reviewer session.

## Verification

| Area     | Verification                                                                     | Result                                         |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Helpers  | `tests/hudLayout.test.ts`: help timing, auto-collapse, toggle back to auto       | Pass                                           |
| Settings | Legacy `showHelp: false` → `off`, invalid help modes, collapse-map validation    | Pass                                           |
| Checks   | `npm run check`                                                                  | 61 files, 891 tests; format, lint, types pass  |
| Build    | `npm run build`                                                                  | Succeeds                                       |
| Balance  | Not run: no `src/sim`, `src/data` or `src/core` change, so the bot is unaffected | —                                              |
| Browser  | 1280×720 and 1024×768, default settings                                          | Shipyard, all ship slots, Accept and refinery buttons visible without scrolling |
| Browser  | 1280×720 at 140% HUD scale                                                       | Columns share the height; panels scroll inside, nothing overlaps |
| Browser  | 1280×720 with compact HUD and help pinned on                                     | Fits with room to spare                        |
| Browser  | `?` at 1024×768 in auto mode (CSS-hidden there)                                  | Shows help centred, `aria-pressed` follows     |

Screenshots (scaled to 800 px wide) are in [`2026-10-21-hud-density/`](2026-10-21-hud-density/).

## Deviations from the plan

- `toggledHelp(mode, playSec)` was dropped. The first browser pass showed that at under 1200 px CSS hides auto
  help even while `helpVisible` says it shows, so the `?` button read "pressed" and its first click stored `off`
  without visibly changing anything. The toggle now reads whether the box is actually on screen.
- The README's Interface settings line and controls table were updated for the new options.
