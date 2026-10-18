# Distinct rock materials: ore veins, glossy ice, emissive crystal

- **Date:** 2026-10-18
- **Issue:** #20 — "Distinct rock materials: ore veins, glossy ice, emissive crystal"
- **Parent:** #28 — "Visuals: bloom, materials, mining feedback, warp FX"
- **Status:** Design of record (verified against the current tree)
- **Builds on:** #14 (rock culling / instance packing in `src/render/rocks.ts`)

## Context / problem

Every rock is drawn by `RockView` (`src/render/rocks.ts`): six `InstancedMesh`
shape pools, all sharing **one** `MeshLambertMaterial` patched with the damage
cracks shader, plus a pickups pool. Shape is picked by `r.id % VARIANTS`, so it
is uncorrelated with kind, and the only kind signal is the `instanceColor` tint
from `ROCK_TINT`. The issue asks for the three raw kinds — **ore, ice,
crystal** — to be distinguishable by **shape and shading, not only colour**,
while keeping instancing and **under ~20 draw calls**.

Constraints from the tree that shape the design:

- The scene is lit by an `AmbientLight` plus the star's `PointLight`
  (`systemView.ts`, intensity 3.2). There is no directional "sun". A material
  can therefore not rely on a fixed key light being present everywhere.
- Rocks are drawn top-down with `flatShading: true`, so facet normals are the
  natural unit of per-face shading.
- Bloom is driven by HDR colour and `RockView.glow` (`selfGlow`, issue #21);
  only crystal is meant to feed bloom today.
- The damage cracks (`vDamage`, orange emissive) must keep working on **all**
  kinds — it is combat/mining feedback.

## Decisions

1. **Kind owns the shape family, not `id % 6`.** Each kind gets its own two of
   the six shape pools (2 shapes × 3 kinds = 6). *Why:* acceptance criterion 1
   ("recognisable by shape"); a rock's silhouette then hints its kind. Recorded
   as a deviation from the issue's literal parenthetical "one InstancedMesh per
   material × shape" only in that shapes are partitioned by kind, so the count
   stays at **6** instead of the 18 a naive 3 materials × 6 shared shapes would
   give — leaving headroom under the ~20 cap.
2. **One material per kind (3 materials, 6 meshes).** *Why:* each kind needs
   different uniforms (shininess, vein/gloss/emissive weights) and a different
   shading branch; three `MeshPhongMaterial`s share one `onBeforeCompile`
   patch, so there is still a single shader program. Not 18 meshes (see 1).
3. **`MeshLambertMaterial` → `MeshPhongMaterial` for rocks.** *Why:* Lambert
   has no specular term at all, so "higher specular" ice is impossible;
   Phong gives a real highlight from the star point light. Switching all three
   keeps one material class and one patch. `flatShading` is kept.
4. **Ice translucency is faked with a fresnel rim glow, not alpha.** *Why:*
   per-instance transparency needs depth sorting and changes blending; a
   `fresnel · normal` rim reads as glossy translucent ice from a top-down
   camera at zero draw-call cost and no sort bug.
5. **Ore veins are object-space ridged noise in the fragment shader, not baked
   vertex colours.** *Why:* geometries are shared per pool, so baked vertex
   colours would be identical on every rock of a shape and only sampled at
   `IcosahedronGeometry` vertices (12–42 points — far too coarse for "veins").
   Object-space noise gives fine veins that spin with the instance, at no extra
   draw call. (This is the one place the literal issue wording "vertex-colour
   veins" is relaxed in favour of finer, non-repeating veins.)
6. **Crystal emissive facets keyed off the flat facet normal.** *Why:*
   `flatShading` already gives one normal per face; hashing it makes whole
   facets glow as units (a crystal look) rather than a soft cloud.
7. **Keep the damage-crack shader and `aDamage` attribute on every kind.**
   `aDamage = (damage, seed, selfGlow)`; `.z` stays the "wants bloom" flag.
8. **`rockGeometry` gains an optional `style` argument, default `'rock'`.**
   *Why:* `debris.ts` calls `rockGeometry(4242)`; the default keeps debris and
   any other caller byte-identical, so the change stays inside the rock path.

## Shape families

`rockGeometry(seed, style)`, all deterministic from `seed`:

| Style | Kind | detail | per-vertex scale | reads as |
| --- | --- | --- | --- | --- |
| `rock` | ore | 1 | `0.72 + rng*0.5` (unchanged) | chunky, lumpy rock |
| `gem` | ice | 0 | `0.90 + rng*0.14` | smooth, rounded, low-poly gem |
| `shard` | crystal | 0 | `0.55 + rng*rng*0.6` | sharp, spiky shard |

The shared vertex de-duplication (round-to-3-decimals key) is kept for every
style so flat-shaded meshes stay closed. `shard`'s `rng*rng` biases most
vertices inward and throws a few out, which is what makes points.

**Extent budget:** max radius per style is `rock` 1.22, `gem` 1.04, `shard`
1.15 — all at or below the current `rock` max, so the existing `ROCK_BOUND`
(1.3, which already covers 1.22 × 1.035 shudder) still covers culling. A test
pins this, so a future geometry tweak that outgrows the bound fails loudly
instead of rocks popping at the screen edge.

## Shading (per kind)

All three materials run the same fragment additions; a `uniform float uKind`
selects the branch (uniform branch, not per-instance, so one program). Common
inputs already exist: `vObj` (object-space position), `vDamage`, `vNormal`
(view space, flat), `vViewPosition` (view space, from Phong), `uTime`,
`uGlow`.

- **ore (`uKind` 0) — metallic veins.** Ridged object-space noise
  (`1 - |2n-1|`) forms vein lines; veins shift `diffuseColor` toward a warm
  metal and add a faint emissive so they read even in shadow. Material
  `specular` is warm and low-shininess.
- **ice (`uKind` 1) — glossy + fake translucency.** High `shininess`, pale
  cyan `specular` for a tight star highlight, plus a fresnel rim
  (`pow(1-|dot(N,V)|, 3)`) added as emissive, gently boosted by `uGlow`.
- **crystal (`uKind` 2) — emissive facets.** Facet hash from the flat normal
  gates an object-space noise mask; the result is added as emissive violet,
  scaled by `uGlow` so it blooms under a quality preset with bloom on and
  stays legible when off. A slow `uTime` pulse keeps it alive.

The existing orange damage-crack block runs for every kind, unchanged.

## Draw calls

Rock path stays at **6 shape meshes + 1 pickups mesh = 7**, independent of the
number of rocks (unchanged from today). The issue's ~20 budget is about the
whole scene; this change adds zero draws. Verified at runtime from
`renderer.gl.info.render.calls` in the browser (Task 4) and pinned in a unit
test as `RockView.group.children.length === 7` (6 pools + pickups) regardless
of rock count.

## Non-goals

- No change to `src/sim/**`, gameplay, save format, or rock generation.
- No new light, no change to the global lighting (would touch ships/planets).
- No real transparency/sorting for ice (see decision 4).
- No new dependency; no change to `Particles`, `Debris`, `ShipView`, bloom
  settings, or quality presets.
- Not #24 (procedural planet shading) or #48 (rock traits) — visuals only.

## Verification strategy

1. **Unit (vitest, no WebGL):** style→shape geometry differences and extents;
   `rockStyleOf` / `rockShapeIndex` mapping; pool count and material classes;
   a rock of kind K lands in one of K's two pools after `update`.
2. **Browser smoke (Playwright, not CI):** load the dev server, use the
   `window.__amh` debug hook to place one rock of each kind near the player,
   screenshot, and assert no WebGL/shader compile errors in the console.
   A GLSL compile error is a *runtime* failure that no unit test can catch, so
   this step is mandatory, not optional.
3. **Runtime draw calls:** read `renderer.gl.info.render.calls` in the same
   browser pass and report it against the ~20 budget.
4. **Full gate:** `format:check`, `lint`, `typecheck`, `test`, `vite build`.
