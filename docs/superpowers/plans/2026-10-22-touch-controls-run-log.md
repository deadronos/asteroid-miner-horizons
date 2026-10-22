# Run log: touch controls and a phone layout (#194)

- **Date:** 2026-10-22
- **Issue:** [#194](https://github.com/deadronos/asteroid-miner-horizons/issues/194)
- **Branch:** `claude/issue-194-mobile-friendly-fabaea`
- **Spec:** [`2026-10-22-touch-controls-design.md`](../specs/2026-10-22-touch-controls-design.md)

## Setup

One session, implementing from the spec without a separate plan document or reviewer session: the change is
presentation-only (no sim, data or save changes), so it was built and checked in one pass and verified in the
browser at phone sizes.

## What was built

1. `src/core/gesture.ts`: `pinchStep` and `stickVector`, with `tests/gesture.test.ts`.
2. `touchControls` setting (`auto` / `on` / `off`) with validation and an Interface-tab row; `hudLayout.ts` gains
   `touchControlsShown` and a `narrow` flag on the collapse rules (fold by default, accordion on toggle), with tests.
3. `src/ui/TouchControls.ts`: stick and action strip; `Hud` owns it, watches the narrow and coarse-pointer media
   queries, publishes `--topbar-bottom`, and swaps the help text while touch controls show.
4. `src/input.ts`: per-`pointerId` tracking, tap / long-press / pinch / two-finger pan for touch, the hotkey switch
   moved into `runAction` (shared by keys and the strip), stick thrust in `thrust()`, armed-outpost taps.
5. `style.css`: touch controls and the phone layout (portrait and landscape); `viewport-fit=cover`.

## Verification

- `npm run check` green (963 tests) and `npm run build` green.
- In the browser at 375×812 (touch emulation) with synthetic touch pointer events: a tap mines / docks / moves and
  shows the tooltip; a long-press gives a move order without changing the selection; a pinch zooms and keeps
  camera follow; a two-finger drag pans and the finger left behind does nothing; the stick flies the flagship and
  clears its order; an armed Outpost disarms on a tap that misses a rock without issuing an order; the accordion
  keeps one panel open; the Research modal and the settings menu fit the screen.
- At 812×375 with touch controls forced on: the landscape layout keeps the open panel usable.
- At 1440×900 with a mouse: layout and columns are unchanged (`top: 64px`, original widths, refinery auto-folded),
  touch controls hidden, and a real mouse click still issues a move order.

## Deviations found while testing

- **Pinch dropped camera follow.** Summing the midpoint's path length crossed the pan threshold on a plain pinch,
  because fingers report one at a time and the midpoint jitters. Panning now waits for the _net_ drift.
- **An open panel stayed narrow.** The per-panel `#ship` / `#fleet` width rules outranked the class selector; the
  phone rules are scoped under `#app`.
- **The right column ran into the full-width log**; it now stops above it in portrait.
- **Landscape squashed the open panel** under a 148 px control band; short screens get a smaller stick and strip.

## Not verified

A real phone (iOS Safari / Android Chrome) was not available: safe-area insets, real multi-touch timing and
`navigator.vibrate` were checked only in emulation. That is the manual check in #123.
