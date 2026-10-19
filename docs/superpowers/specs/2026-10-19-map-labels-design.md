# Station and planet labels on the zoomed-out map

- **Date:** 2026-10-19
- **Issue:** #25 — "Labels for planets and station when zoomed out"
- **Parent:** #28 — "Visuals: bloom, materials, mining feedback, warp FX"
- **Status:** Design of record

## Context

Planets have names in the generated system (`Thave I`, `Thave II`, ...) but nothing showed them. The issue asks
for labels on the station and planets that fade in past a zoom threshold, stay hidden at normal play zoom, read
on the M map, and never overlap a HUD panel.

## Decisions

1. **Render-only; no sim or save change.** Names come from `generateSystem`; the station, which has no name of
   its own, is labelled `<system> Station`. `run.rng` is untouched, so balance cannot move.
2. **A DOM overlay positioned by `worldToScreen`, not `CSS2DRenderer`.** The issue suggested `CSS2DRenderer`,
   but keeping labels off the HUD needs each label's screen rectangle before it is shown, which `CSS2DRenderer`
   computes internally. `MapLabels` follows the pickup-text overlay instead: pooled spans moved by `transform`,
   with placement in a pure `placeLabels` that Vitest covers in the node environment.
3. **Fade by view half-height.** Labels ease in between a half-height of 900 and 1300 world units. Play zoom is
   420, and the M map fits at least the 1720 planet slot (×1.08), so labels are always fully shown on the map
   (tested across systems) and absent in normal play.
4. **Placement.** Each label is centred above its body, clearing the body's radius (2× for ringed planets, the
   dock circle for the station, at least 10 px); if that spot is taken it drops below; otherwise it hides. A
   spot must lie inside the viewport and clear every HUD panel, banner and earlier label. The station is placed
   first, then planets innermost out.
5. **HUD rectangles come through `main.ts`.** `render/` may not import `ui/`, so `Hud.blockerRects()` is
   handed to the renderer as `labelBlockers`. Rectangles and label sizes are re-read four times a second, and
   only while labels are visible, so normal play pays nothing and a HUD-scale change is picked up.
6. **Hidden during the warp streaks**, like the rest of the playfield.
