# Procedural planet shading and atmosphere rim

- **Date:** 2026-10-19
- **Issue:** #24 — "Procedural planet shading + atmosphere rim"
- **Parent:** #28 — "Visuals: bloom, materials, mining feedback, warp FX"
- **Status:** Design of record

## Context

`SystemView` drew every planet as a `MeshLambertMaterial` sphere in one flat colour (`Planet.color`). The issue
asks for distinct planet types (rocky, banded gas giant, ice) with a fresnel atmosphere rim, generated from the
system seed so a seed always shows the same planets.

## Decisions

1. **Render-only; no sim or save change.** Kind and look are derived in `src/render/planetLook.ts` from fields
   `generateSystem` already produces from `(seed, number)`: radius, orbit, rings, name and colour. No new
   `Planet` field, no `SAVE_VERSION` bump, and `run.rng` is never touched, so balance cannot move.
2. **Kind rule.** Radius ≥ 29 (or ≥ 24 with rings) is a gas giant; otherwise orbit ≥ 1600 (outer slots) is ice
   and anything inside is rocky. Every kind appears in ordinary systems.
3. **Canvas-free noise texture, not a surface shader.** `planetPixels` fills a 256×128 equirectangular RGBA buffer
   uploaded as a `DataTexture`, so it is a pure function testable under Vitest's node environment. Noise is 3D
   value noise sampled on the unit sphere, which gives no seam at the wrap and no pinch at the poles.
   `Planet.color` keeps setting the hue; the kind sets the pattern (two-tone terrain, swirled latitude bands,
   pale shell with ridged cracks and polar caps).
4. **The spin axis lies in the screen plane, tipped 0.35 rad toward the camera.** The camera looks straight down,
   so an upright axis would show bands as concentric rings around the pole. Laying it over makes bands read as
   stripes and lets terrain roll across the disc as the planet spins.
5. **Atmosphere in two additive shells.** A front-face fresnel `rim` just above the surface brightens the limb;
   a back-face `halo` at 1.2× fades from the limb to zero at its edge, avoiding the hard ring a single
   front-face shell gives at its silhouette. Rocky and ice rims use fixed tints; gas giants tint theirs from
   their own colour.
6. **Textures are disposed explicitly.** `dispose()` frees geometry and materials by traversal, which does not
   reach `map`s; the shared `glowTexture` must survive, so planet textures are tracked in their own list.
7. **Surfaces paint progressively.** A full surface costs ~20 ms on a desktop CPU, so painting 3–5 of them in
   `build` would hitch the warp reveal. `PlanetSurface` starts filled with the flat planet colour and
   `SystemView.update` paints rows within a 3 ms per-frame budget, uploading each texture once when it finishes.
   The result does not depend on how the rows were sliced (tested).

## Cost

Per system: 3–5 textures of 128 KB, two extra draw calls per planet, and roughly 100 ms of painting spread over
the first frames after a warp.
