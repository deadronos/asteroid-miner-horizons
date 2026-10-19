# three.js best-practices audit — 2026-10-19

An audit of `src/render` (three.js r186) against Utsubo's
[100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips).
It answers three questions: how we score against each tip, whether we use WebGPU and whether we should make it the
default with feature detection, and which tips are sound advice for this game and which are not.

## TL;DR

- **We do not use WebGPU.** We use the classic `THREE.WebGLRenderer`, an `EffectComposer` bloom chain, one
  `onBeforeCompile` patch (rocks) and one raw GLSL `ShaderMaterial` (planet atmospheres). All four are WebGL only.
- **The renderer is already in good shape for what it draws.** Rocks, pickups and debris are instanced and culled by
  hand against the camera rectangle. Particles upload only their live range. Pixel ratio and bloom are capped per
  quality preset. There are two lights and no shadows, and every texture is small and generated at runtime.
- **Making WebGPU the default is possible, but it should not happen yet.** WebGPU is a migration, not a flag. It
  means rewriting both custom shaders in TSL, replacing the post chain with `RenderPipeline`, and solving the
  sRGB-blending trick that the scene's look depends on. That trick is the main risk. Our scene is a small,
  orthographic, instanced 2.5D view, the case where the article itself (tips 6 and 9) says WebGPU gives little.
  Recommendation: fix the cheap WebGL gaps first, then run a timeboxed WebGPU spike with go/no-go criteria
  ([plan below](#recommended-plan)).
- **Real gaps found:** ship visuals leak GPU resources when a ship is removed; there is no WebGL context-loss
  handling; no shader warm-up, so the first warp into a new system can hitch; the context allocates an MSAA backbuffer
  even when bloom renders through its own MSAA target; and we have no draw-call or memory telemetry.

## What the renderer is today

| Aspect         | Current state                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer       | `THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' })` in `src/render/Renderer.ts`                                                                                                                        |
| Camera         | One `OrthographicCamera` looking straight down (`src/render/camera.ts`)                                                                                                                                                      |
| Loop           | Manual `requestAnimationFrame` in `src/main.ts`; 60 Hz fixed-step sim, render once per frame                                                                                                                                 |
| Post           | `EffectComposer` → `RenderPass` → `UnrealBloomPass` → custom `PRESENT_SHADER`, only when the quality preset sets bloom > 0                                                                                                   |
| Colour         | Composer targets are half-float, flagged `isXRRenderTarget` so the scene blends in sRGB space like the canvas does                                                                                                           |
| Custom shaders | `patchRock` (`onBeforeCompile` on `MeshPhongMaterial`, `src/render/rocks.ts`) and `atmosphereMaterial` (`ShaderMaterial`, `src/render/planetLook.ts`)                                                                        |
| Instancing     | 6 rock shape pools + pickups (`InstancedMesh`, grow ×2), debris ring buffer (`InstancedMesh`, 240)                                                                                                                           |
| Points         | 3 star layers (40k points at high quality, draw range scaled by preset), particle pool (6000, packed live range)                                                                                                             |
| Lights         | `AmbientLight` + one `PointLight` at the star; no shadows                                                                                                                                                                    |
| Textures       | All procedural: a 128² glow, a 512² nebula canvas per system, 256×128 planet `DataTexture`s painted a few rows per frame                                                                                                     |
| Assets         | None loaded; no glTF, Draco, KTX2 or loaders                                                                                                                                                                                 |
| Quality        | `QUALITY` in `src/settings.ts`: DPR cap 1 / 1.5 / 2, stars 30 / 60 / 100 %, particles 30 / 65 / 100 %, bloom off / 0.75 / 0.9                                                                                                |
| Draw calls     | Fixed part is about 20 (backdrop 4, rocks + pickups 7, fx 3, markers and hazard 3, star 3) plus belts, planets and the station. Ships are **not** instanced, about 12 or more meshes each, so the count grows with the fleet |

## WebGPU

### Are we using it?

No. Nothing imports `three/webgpu`, nothing checks `navigator.gpu`, and the render path is WebGL only.

### Can we make WebGPU the default, with feature detection?

Technically yes. `WebGPURenderer` (from `three/webgpu`) uses WebGPU where an adapter exists and falls back to its own
WebGL 2 backend everywhere else, so a single renderer covers both (tips 1, 2 and 8). Feature detection is mostly
built in. We would add explicit detection so the settings menu and stats can show which backend is running, and so
players can force WebGL:

```ts
// Sketch: resolve the preference, then let WebGPURenderer fall back on its own if init still fails.
type RenderBackend = 'auto' | 'webgpu' | 'webgl';

async function webgpuAvailable(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  try {
    return (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

const forceWebGL = pref === 'webgl' || !(await webgpuAvailable());
const gl = new WebGPURenderer({ antialias, forceWebGL, powerPreference: 'high-performance' });
await gl.init(); // or drive the loop with gl.setAnimationLoop, which awaits init itself
const backend = (gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
gl.onDeviceLost = (info) => {
  /* rebuild the renderer, or show "graphics reset" and reload */
};
```

The preference fits the existing `antialias` pattern: a setting in `src/settings.ts` that applies after a reload.
It belongs to settings, not to saves, so `SAVE_VERSION` does not change. Settings sanitising has to accept the new key.

### What the migration actually costs

The switch itself takes a few lines; most of the work is porting what sits on top of it:

| Blocker                                                                | Where                          | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onBeforeCompile` rock shader (veins, ice rim, facets, traits, cracks) | `rocks.ts` `patchRock`         | Rewrite as `MeshPhongNodeMaterial` with an `emissiveNode` / `colorNode` built in TSL. Per-instance `aDamage` / `aTrait` become `instancedBufferAttribute` nodes. `vnoise` can stay hand-written, or use `mx_noise_float` (tip 51). The `tests/rocks.test.ts` cases that stub `onBeforeCompile` and grep GLSL need rewriting.                                                                                                                                         |
| GLSL atmosphere `ShaderMaterial` (rim and halo, `#ifdef HALO`)         | `planetLook.ts`                | A small TSL `Fn` (fresnel) on a `MeshBasicNodeMaterial`. Easy.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `EffectComposer` + `UnrealBloomPass` + `ShaderPass`                    | `Renderer.ts`                  | `RenderPipeline` with `pass(scene, camera)` → the `bloom()` node → a TSL version of `PRESENT_SHADER`. The bloom parameters will need retuning; it is a different implementation.                                                                                                                                                                                                                                                                                     |
| **sRGB-space blending via `isXRRenderTarget`**                         | `Renderer.ts` `ensureComposer` | **The main risk.** The nebula, belts and haze were tuned to blend in sRGB space; in linear space they lift into grey-blue fog (see the comment in `ensureComposer`). The trick relies on a WebGLRenderer internal and has no direct equivalent in the node pipeline. Either find a node-pipeline way to keep sRGB-space blending (unproven), or retune those low-opacity layers for linear blending, which is art work that changes the look. Budget for the second. |
| Points larger than 1 px                                                | `backdrop.ts`, `particles.ts`  | WebGPU point primitives are 1 px. Sized points go through the node `PointsNodeMaterial` / `sizeNode` path, drawn as instanced quads. Check that stars (1–2.2 px) and particles (3 px) look the same on both backends, and measure the cost of 40k quads.                                                                                                                                                                                                             |
| Async init                                                             | `main.ts`, `Renderer.ts`       | Must `await init()` or move to `setAnimationLoop`, which a renderer constructed synchronously in a constructor cannot do today. Small, but it touches bootstrap order.                                                                                                                                                                                                                                                                                               |
| Bundle size                                                            | `vite.config.ts`               | `three/webgpu` brings in the node system and both backends. Expect a clearly bigger chunk (the warning limit is already raised to 900 kB for three alone). Measure with `npm run build`.                                                                                                                                                                                                                                                                             |
| Two backends to verify                                                 | everything                     | The fallback runs through the node system's WebGL 2 backend, not the classic `WebGLRenderer` we tune for today. Parity has to be checked on both WebGPU and fallback, on Chrome, Safari and Firefox.                                                                                                                                                                                                                                                                 |

### Is it worth it for this game?

Not on performance grounds today. The article's own criteria for migrating (tip 6: draw-call-heavy scenes dropping
frames, a need for compute, post-processing that stutters) do not describe us. The fixed draw-call count is small
because the expensive parts are already instanced. The scene is orthographic, unlit except for one light, and has no
shadows. The CPU work per frame is dominated by our own update loops, which WebGPU does not speed up. Tip 9 is honest
that WebGPU "isn't always faster", and for our profile the WebGL 2 fallback path could well be slower than the
classic `WebGLRenderer`.

Where WebGPU could pay off later:

- **Large fleets.** Ships are about 12 non-instanced meshes each. If fleets grow into the dozens, either instance
  ship parts (works on WebGL too, and is the better fix) or lean on WebGPU's lower per-draw cost.
- **Much bigger effects.** Compute-driven particles (tip 4) or a GPU star field would allow 100k+ particles, but only
  if a design wants that. The current 6000-particle CPU pool is cheap.
- **Future-proofing.** New three.js work (TSL, `RenderPipeline`, the Inspector) happens on the WebGPU side.
  `WebGLRenderer` is still maintained (tip 8), so this pressure is real but not urgent.

If we migrate, migrate fully: one `WebGPURenderer` with `forceWebGL` as the fallback, and all shaders in TSL. Do not
keep classic GLSL and TSL versions of the same shaders side by side; two shader languages for one look is the worst
outcome.

## Audit by tip

Status: ✅ done · ⚠️ gap worth fixing · ➖ not applicable or not worth it here.
"Sensible?" judges the tip **for this game**, not in general.

### WebGPU renderer (1–20)

| #   | Tip                                          | Status   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zero-config `three/webgpu` import            | ➖       | Not on WebGPU; see above.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | Trust the automatic WebGL 2 fallback         | ➖       | Sensible as architecture, but "trust" is too strong: it is a different backend from classic `WebGLRenderer` and needs its own visual and performance testing.                                                                                                                                                                                                                                                                                              |
| 3   | Learn TSL                                    | ➖       | Required only if we migrate; two shaders to port.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Particles via compute                        | ➖       | Overkill. 6000 particles on a packed CPU pool with ranged uploads cost almost nothing.                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | Warm up shaders with `compileAsync`          | ⚠️       | Applies to WebGL too. A new system builds new materials: the atmosphere rim and halo variants, planet Lambert with a map, and the first bloom enable. Their programs compile on the first frame they are visible. Call `compileAsync(scene, camera)` after `SystemView.build`, while the warp streaks play. Caveat: `compile` walks only visible objects, and the warp hides the playfield, so compile before hiding or toggle visibility around the call. |
| 6   | Migrate when you hit walls                   | ✅       | The right test. We have not hit one.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Know the support matrix                      | ➖       | Chrome/Edge 113+, Safari 26, Firefox (Windows first). Re-check before flipping a default.                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | `forceWebGL` for testing                     | ➖       | Becomes our "Renderer: WebGL" setting if we migrate.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | Gains only in specific scenarios             | ✅       | The most important tip in the section, and the reason for the recommendation above.                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | Node materials for customisation             | ➖       | The modern replacement for our `onBeforeCompile` string patching. Cleaner, but WebGPU-path only.                                                                                                                                                                                                                                                                                                                                                           |
| 11  | Drop `renderAsync`                           | ➖       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | Occlusion queries                            | ➖       | Pointless for a top-down orthographic view; nothing occludes anything.                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | Storage textures                             | ➖       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | Graceful feature detection                   | ⚠️       | Needed only alongside a WebGPU path; see the sketch above. Also check adapter features (`float32-filterable`, `timestamp-query`) before using them.                                                                                                                                                                                                                                                                                                        |
| 15  | Inspector / WebGPU DevTools                  | ➖       | Useful in the spike.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 16  | Keep per-frame data on GPU, `addUpdateRange` | ✅ / nit | Particles already upload only `[0, live)`. Nit: rock pools set `instanceMatrix.needsUpdate`, which uploads the whole capacity, not the `n` committed instances. A few KB per pool, so not worth more than one line.                                                                                                                                                                                                                                        |
| 17  | Compute physics                              | ➖       | Our physics is the deterministic sim and must stay on the CPU in `src/sim`.                                                                                                                                                                                                                                                                                                                                                                                |
| 18  | Compute terrain                              | ➖       | Planet surfaces are already painted incrementally under a frame budget; fine as is.                                                                                                                                                                                                                                                                                                                                                                        |
| 19  | Workgroup shared memory                      | ➖       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 20  | Indirect draws                               | ➖       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Asset optimisation (21–29)

Everything here is ➖. We load no models and no image files; every geometry and texture is generated in code. The one
transferable idea is in tip 27, mipmaps:

| #   | Tip                      | Status   | Notes                                                                                                                                                                                                                                                     |
| --- | ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26  | LOD                      | ➖       | Orthographic top-down; object size on screen comes from zoom, and culling already handles zoomed-out views. Not worth it.                                                                                                                                 |
| 27  | Right-size, keep mipmaps | ⚠️ minor | Textures are small (✅). But planet `DataTexture`s use `LinearFilter` with no mipmaps, so on the system map, where planets are a few pixels across and rotating, they can shimmer. Turn on mipmaps for the final upload when painting finishes. Cosmetic. |

### Draw calls (30–36)

| #   | Tip                       | Status     | Notes                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30  | ~100 draw calls on mobile | ⚠️         | The fixed scene is well under that. Ships push it up linearly (about 12 or more each). Nobody measures it today; see tip 94.                                                                                                                                                                                                       |
| 31  | `InstancedMesh`           | ✅         | Rocks, pickups and debris. Pools grow ×2, and only in-view instances are written.                                                                                                                                                                                                                                                  |
| 32  | `BatchedMesh`             | ➖ / later | The tool for ships if fleets grow: hulls and fittings are different geometries sharing a few materials. Per-ship colours and opacities make it fiddly; only worth it once ship counts are measured as a problem.                                                                                                                   |
| 33  | Share materials           | ⚠️         | Fittings share geometries and materials (✅). `ShipView.build` creates fresh geometries (flame, shield, select ring) and about 10 fresh materials **per ship**. The geometries are identical per hull and could be module-level like `unitPlane`; materials that never change per ship (bar background, beam) could be shared too. |
| 34  | Merge static geometry     | ➖         | The station is about 10 meshes and its ring rotates. The saving is not worth the code.                                                                                                                                                                                                                                             |
| 35  | Array textures            | ➖         | —                                                                                                                                                                                                                                                                                                                                  |
| 36  | Frustum culling           | ✅         | Better than the tip suggests. `frustumCulled = false` on instanced meshes plus a per-instance AABB cull in `cull.ts`, sized so instances don't pop. Built-in culling would test one bounding sphere for the whole pool.                                                                                                            |

### Memory (37–42)

| #   | Tip                       | Status     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 37  | Dispose all GPU resources | ⚠️ **bug** | `SystemView` disposes everything on a system change, including planet textures (✅). `Backdrop.setSystem` disposes the old nebula map (✅). `OutpostView` disposes the fill geometry it replaces (✅). But `ShipView.remove` only detaches the visual: the per-ship flame, shield and select geometries and roughly 10 per-ship materials are never disposed. Every destroyed ship, lost drone or loaded save leaks them. Small per event, but unbounded over a long session. |
| 38  | `ImageBitmap` close       | ➖         | No glTF.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 39  | Object pooling            | ✅         | Particles, debris and instance pools are all pooled; `ShipView` reuses scratch collections.                                                                                                                                                                                                                                                                                                                                                                                   |
| 40  | Cache textures            | ✅         | `glowTexture` is a shared module constant.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 41  | Dispose render targets    | ✅ / ➖    | The composer is created once and kept for the session, which is fine for a single-page game.                                                                                                                                                                                                                                                                                                                                                                                  |
| 42  | React cleanup             | ➖         | Not React.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Shaders and materials (43–52)

| #   | Tip                                  | Status   | Notes                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 43  | `mediump` on mobile                  | ➖ ✗     | **Do not apply.** `hash3` in the rock shader is `fract(sin(x) * 43758.5)`, which falls apart at `mediump`, and crack and vein noise would band. Desktop GPUs ignore the hint anyway.                                                                                                                                   |
| 44  | Minimise varyings                    | ✅       | The rock patch adds three small varyings.                                                                                                                                                                                                                                                                              |
| 45  | Replace branches with `mix` / `step` | ✅ as is | Our `uKind` branch is on a **uniform**, so every fragment in a draw takes the same path and nothing diverges. `vTrait` is constant per instance, so it is coherent too. Rewriting these as `mix` would compute all three kinds' noise and cost more. The tip is right only for genuinely divergent per-pixel branches. |
| 46  | Pack data into RGBA                  | ✅       | `aDamage` already packs damage, seed and glow into a single `vec3`.                                                                                                                                                                                                                                                    |
| 47  | Avoid dynamic loops                  | ✅       | No loops in our shaders.                                                                                                                                                                                                                                                                                               |
| 48  | Precision in large scenes            | ✅ / ➖  | Orthographic camera, near 1 / far 4000, layers well separated in Y. No z-fighting issues to solve.                                                                                                                                                                                                                     |
| 49  | Minimise transparent overdraw        | ✅       | `depthWrite: false` on additive layers. The full-screen nebula plane is one layer of overdraw; star glow sprites are large but few. Acceptable.                                                                                                                                                                        |
| 50  | Reusable TSL `Fn`                    | ➖       | TSL only.                                                                                                                                                                                                                                                                                                              |
| 51  | TSL noise                            | ➖       | TSL only; a nice simplification if we port `patchRock`.                                                                                                                                                                                                                                                                |
| 52  | Reuse shader programs                | ✅       | Deliberate: `uKind` is a uniform, not a define, so all three rock kinds share one program (see `rockMaterial`).                                                                                                                                                                                                        |

### Lighting and shadows (53–62)

| #     | Tip                      | Status | Notes                                                                         |
| ----- | ------------------------ | ------ | ----------------------------------------------------------------------------- |
| 53    | ≤ 3 dynamic lights       | ✅     | Ambient plus one point light.                                                 |
| 54–58 | Shadow costs, CSM, sizes | ➖     | No shadows, and a top-down space scene doesn't need them.                     |
| 59    | Environment maps         | ➖     | Flat-shaded Lambert and Phong with emissive accents; an env map adds nothing. |
| 60–62 | Shadow tuning            | ➖     | —                                                                             |

### React Three Fiber (63–72)

➖ throughout; we use no React. Several ideas carry over and we already follow them: mutate in the frame loop rather
than through state (63), avoid allocating in the frame loop (66, see `docs/superpowers/*per-tick-allocations*`), use
`dt` for frame-rate independence (67), toggle `visible` instead of rebuilding (71, as warp hiding does). One idea we
could borrow is **68, adaptive quality** (`PerformanceMonitor`): drop DPR or bloom automatically when frame time stays
high. That is a nice-to-have, but automatic quality changes can surprise players who chose a preset. If we ever add
it, make it opt-in.

### Post-processing (73–82)

| #   | Tip                                  | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 73  | pmndrs/postprocessing                | ➖ ✗   | Would be a new dependency (AGENTS.md: ask first) for a three-pass chain that already works, and it is WebGL only, so it is a dead end if we ever migrate.                                                                                                                                                                                                                                                                                                                             |
| 74  | `antialias: false` when post does AA | ⚠️     | **Real waste.** On the default high preset, bloom is on and `antialias` defaults to true. The context allocates an MSAA backbuffer **and** the composer target has `samples: 4`, so the canvas MSAA is spent on one full-screen present quad. At DPR 2 that is a lot of idle memory. Options: always render through the composer (then the context never needs `antialias`), or create the context with `antialias` only when the preset has no bloom (it already applies on reload). |
| 75  | Disable multisampling if unused      | ✅     | Target `samples` follows the `antialias` setting.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 76  | Tone mapping at the end              | ✅     | `PRESENT_SHADER` is our tone map: a hue-preserving roll-off, last in the chain.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 77  | Selective bloom                      | ✅     | Bloom threshold 0.96 plus the `glow` HDR boost on chosen materials give selective bloom without a second scene pass.                                                                                                                                                                                                                                                                                                                                                                  |
| 78  | AA as the last pass                  | ✅     | MSAA on the composer target instead of FXAA or SMAA; better quality for this scene.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 79  | Tune bloom, lower resolution         | ✅     | `UnrealBloomPass` already blurs a downsampled mip chain; strength is per preset.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 80  | Cap DPR at 2                         | ✅     | `pixelRatioCap` 1 / 1.5 / 2 per preset.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 81  | Merge effects                        | ✅     | Only bloom and present; nothing to merge.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 82  | Native `RenderPipeline` on WebGPU    | ➖     | The replacement for `EffectComposer` if we migrate.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Loading (83–90)

Mostly ➖ for a full-screen game with no downloaded assets:

- **83 lazy load / 86 progressive / 88 streaming / 90 Suspense**: nothing to stream; the canvas is the page.
- **84 code-split three**: three is needed on the first frame. The only candidate is the post-processing addons,
  which could be a dynamic `import()` when bloom is first enabled. They are tens of KB, so the gain is not worth the
  async ripple through `applySettings`.
- **85 preload**: Vite already emits `modulepreload` for its chunks.
- **87 Web Workers / OffscreenCanvas**: the sim runs on the main thread at 60 Hz with headroom (`npm run bench`), and
  labels, floating text and picking are DOM and main-thread code. OffscreenCanvas would split one coherent frame
  across threads for no measured gain. ✗ for now.
- **89 compression and cache headers**: a hosting concern, outside this repo.

### Development and debugging (91–100)

| #   | Tip                         | Status  | Notes                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 91  | stats-gl                    | ➖      | A dependency. `renderer.info` is free and enough for us.                                                                                                                                                                                                                                                                       |
| 92  | lil-gui                     | ➖      | A dependency. The settings menu already exposes the knobs players need.                                                                                                                                                                                                                                                        |
| 93  | Spector.js                  | ➖      | A browser extension; use it ad hoc, nothing to add to the repo.                                                                                                                                                                                                                                                                |
| 94  | Check `renderer.info`       | ⚠️      | Not exposed anywhere. Add `info` (calls, triangles, geometries, textures, programs) to the `window.__amh` debug hook. It would have caught the tip 37 leak: `memory.geometries` climbs as ships die. Cheap, and it gives tip 30 a number.                                                                                      |
| 95  | three-mesh-bvh              | ➖      | We pick analytically in world space (`input.ts` via `screenToWorld`); no raycasting at all. Better than a BVH for this view.                                                                                                                                                                                                   |
| 96  | DevTools Performance        | ✅      | The standard workflow; nothing to add.                                                                                                                                                                                                                                                                                         |
| 97  | GPU timestamp queries       | ➖      | WebGPU-path only; useful in the spike.                                                                                                                                                                                                                                                                                         |
| 98  | Context or device loss      | ⚠️      | Not handled. A GPU driver reset or a background tab on mobile leaves a black canvas while the sim keeps running. Minimum: listen for `webglcontextlost` with `preventDefault()`, show a "graphics reset, reloading" banner, autosave, and reload. Full restoration (rebuilding textures) is not worth it when saves are cheap. |
| 99  | Profile the loop            | ✅ / ➖ | `npm run bench` covers the sim; the render side is better served by DevTools than hand timers.                                                                                                                                                                                                                                 |
| 100 | `setAnimationLoop`, `Timer` | ➖ now  | Our manual rAF loop is equivalent on WebGL. It becomes required on WebGPU, because `setAnimationLoop` awaits `init()`. We use `performance.now()`, not `Clock`, so the r183 deprecation does not affect us.                                                                                                                    |

## Critique of the article

Most of the list is sound general advice. Read as a checklist for every project, these tips are wrong or need a
caveat:

1. **WebGPU is presented as the default destination (1–3)**, while its own tips 6 and 9 say migrate only on measured
   walls. The second framing is the right one. "Trust the fallback" (2) understates that the fallback is a different
   WebGL backend from the one most projects use today, with different performance and different bugs.
2. **`mediump` on mobile (43)** is risky blanket advice. Any shader using sin-hash noise (very common, including ours)
   or large coordinates breaks visibly. It should say "measure, and keep `highp` for noise and hashing".
3. **Replace branches with `mix` / `step` (45)** is only right for divergent per-pixel branches. Uniform and
   per-instance branches are effectively free, and branch-free code that evaluates every arm can be slower. Our rock
   shader is an example.
4. **The R3F section (63–72) is a tenth of a "three.js" list** and mostly React performance hygiene. It is useful for
   R3F users and noise for everyone else.
5. **Several tips recommend third-party packages (pmndrs postprocessing, stats-gl, lil-gui, r3f-perf,
   three-mesh-bvh)** where three.js built-ins (`renderer.info`, `EffectComposer`, `RenderPipeline`, the Inspector) are
   enough for many projects. Each one is a dependency to maintain.
6. **Draw-call budgets (30)** are rules of thumb from 2018-era mobile GPUs. Useful as a smell, not a target; profile.
7. **Asset tips (21–29)** are excellent for glTF-driven sites and irrelevant for procedural games. The article
   assumes a product-configurator or marketing-site context throughout.

The tips that matter most for **us** are 5 (warm-up), 33 and 37 (share and dispose), 74 (context MSAA vs post), 94
(`renderer.info`), 98 (context loss), and 6 and 9 as the gate on WebGPU.

## Recommended plan

### Phase 0: WebGL wins (small, independent PRs)

1. **Fix the `ShipView` leak (37, 33).** Dispose per-ship geometries and materials in `remove` and when refitting.
   Hoist the flame, shield and select geometries to shared module constants. Test it the way `tests/rocks.test.ts`
   tests pools: build, remove, and check that `dispose` was called, or count `renderer.info.memory` in a smoke test.
2. **Expose `renderer.info` (94)** on `window.__amh`, and optionally a dev-only line in the Stats tab.
3. **Handle WebGL context loss (98)**: a `webglcontextlost` listener, a banner, an autosave, and a reload.
4. **Stop double MSAA when bloom is on (74).** Pick one of the two options above and confirm the memory drop in
   DevTools.
5. **Warm up shaders after `SystemView.build` (5)** with `compileAsync`, minding the visibility caveat.
6. Optional: planet texture mipmaps (27); ranged instance uploads in rock pools (16).

### Phase 1: WebGPU spike (timeboxed, on a branch)

Port `atmosphereMaterial` (easy), `patchRock` and the bloom-and-present chain to TSL and `RenderPipeline` on
`WebGPURenderer`, with a `renderer: 'auto' | 'webgpu' | 'webgl'` setting mapped to `forceWebGL`, using the detection
sketch above. Go/no-go criteria:

- **Visual parity** with today's WebGL build on both the WebGPU backend and the WebGL 2 fallback, checked with
  screenshots of a belt, a crystal rock with cracks, a planet with atmosphere, and a warp. The sRGB-blending question
  must be answered here.
- **Frame time** no worse than the classic `WebGLRenderer` on the WebGL 2 fallback, and better on WebGPU, on at least
  one integrated GPU and one discrete GPU.
- **Bundle size** increase measured and accepted.
- Chrome, Safari and Firefox all run.

### Phase 2: only if Phase 1 passes

Replace `WebGLRenderer` entirely. Ship `auto` as the default, which means WebGPU when an adapter exists and the WebGL 2
backend otherwise. Keep the explicit WebGL option in settings as the escape hatch. Delete the classic GLSL paths, so
only one shader language remains.
