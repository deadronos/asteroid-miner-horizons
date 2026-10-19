# Renderer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five WebGL fixes from Phase 0 of the three.js audit in one PR: a `renderer.info` debug getter
(#115), disposal of per-ship GPU resources (#114), WebGL context-loss handling (#116), shader warm-up after a
system build (#118), and no double MSAA when bloom renders through its own MSAA target (#117). Umbrella: #119.

**Architecture:** Everything lives in `src/render/` plus wiring in `src/main.ts` (and one HUD method for the
context-loss banner). Each fix keeps its logic in a small exported seam that the node-env tests can drive without
WebGL, because `Renderer` itself needs a real context and cannot be constructed under Vitest.

**Tech Stack:** TypeScript, three.js r186, Vite, Vitest (node env), oxlint/oxfmt

**Design:** no separate spec. These are small fixes, and the design of record is the audit,
[`docs/threejs-best-practices-audit-2026-10-19.md`](../../threejs-best-practices-audit-2026-10-19.md) (tips 5, 30,
33, 37, 74, 94, 98 and "Recommended plan → Phase 0"), together with issues #114–#118.

## Global Constraints

- **No `src/sim`, `src/core` or `src/data` changes.** This is presentation-only work. No save-shape change, so no
  `SAVE_VERSION` bump. `docs/balance.md` must not move.
- **Layer rules:** `render/` may import `core/`, `data/`, `sim/` and `settings.ts` only. It must not import
  `session.ts`, `ui/` or `main.ts`; cross-layer wiring goes through hooks that `main.ts` sets.
- **No new dependencies.** No jsdom; tests run in Vitest's node env. Stub `document` the way
  `tests/rocks.test.ts` does when a render module needs `glowTexture`.
- **Test the pure seam.** If a fix has no testable seam, extract a small exported function rather than trying to
  construct `WebGLRenderer` in a test.
- **Do not touch** `scratch.md` or `docs/balance.md`.
- **Style:** one header comment per new module, `/** */` on exported functions and non-obvious fields, no comment
  noise. `npm run check` (format:check + lint + typecheck + tests) must be green after every task.
- Implementers do not commit, push or switch branches; the orchestrator commits each task.

## Review Focus

Most-likely mistakes first, each with the task that guards it.

1. **Disposing shared resources.** The hull geometries (`ShipView.geos`), `unitPlane`, `barPlane`, the hoisted
   flame/shield/select geometries, any shared materials, `glowTexture`, and every geometry and material from
   `fittings.ts` (`buildFittings` returns cached ones) must survive `remove` and `refit`. Disposing one breaks every
   other ship that uses it. **Task 2.**
2. **Missing a per-ship material.** All of hull (if still per ship), flame, shield, select, hpBar, beam, tip (and
   barBg, cargoBar, beamGlow if they stay per ship) must be disposed on `remove`, including the hull-change path in
   `update` that calls `remove` and rebuilds. **Task 2.**
3. **`info.render` only shows the last pass.** With `autoReset` on, every `gl.render` call resets the counters, so
   with bloom on the getter would report the present quad (1 call). Reset once per frame instead. **Task 1.**
4. **The bloom look changes.** With bloom on, the composer path must be untouched: the same target (`HalfFloatType`,
   `samples: msaa`, sRGB texture, `isXRRenderTarget`), the same passes, the same `PRESENT_SHADER`. **Task 5.**
5. **The no-bloom look changes.** The direct-to-canvas path relies on the 8-bit sRGB canvas clamping each blend;
   routing it through the half-float composer is not byte-identical. At startup on a no-bloom preset, the context
   must still get `antialias` and draw directly. **Task 5.**
6. **AA silently lost after a runtime quality change.** If the context was created without `antialias` (a bloom
   preset at startup) and the player switches to a no-bloom preset, edges must stay smooth while the AA setting is
   on. **Task 5.**
7. **Warm-up compiles nothing.** `WebGLRenderer.compile` walks `scene.traverseVisible`, and the warp hides the
   playfield (`setPlayfieldVisible(false)`). Visibility must be forced on around the synchronous `compile` part and
   restored exactly, even if it throws. The returned promise must not be left to reject unhandled. **Task 4.**
8. **Context loss reaches into the sim or loops.** The listener must call `preventDefault()`, fire the hook once,
   and live in `render/`; saving goes through the session's existing save, and `main.ts` does the wiring. **Task 3.**

---

## Task 1: Expose `renderer.info` on the debug hook (#115)

**Files:**
- Modify: `src/render/Renderer.ts`
- Modify: `src/main.ts` (the `window.__amh` debug hook)
- Test: `tests/renderPerf.test.ts` (or a new `tests/renderInfo.test.ts`)

**Build:**
- [x] Export a pure `infoSnapshot(info: THREE.WebGLInfo)` (in `Renderer.ts` or a small new `render/` module) that
      returns a fresh plain object: `{ calls, triangles, points, lines, geometries, textures, programs }`, with
      `programs` as a count (`info.programs?.length ?? 0`).
- [x] Add a `get info()` on `Renderer` returning `infoSnapshot(this.gl.info)`. Its `/** */` comment documents
      that the numbers cover the whole last frame including the bloom composer's passes.
- [x] Set `this.gl.info.autoReset = false` in the constructor and call `this.gl.info.reset()` once at the start of
      `render()`, so `info.render` counts every pass of the frame rather than only the last `gl.render` call.
- [x] In `main.ts`, add `info: () => renderer.info` to `__amh`.

**Tests:**
- [x] `infoSnapshot` copies the render and memory counters from a fake `WebGLInfo`-shaped object, counts programs,
      and returns a new object each call (mutating the source afterwards does not change an earlier snapshot).

**Done when:** `npm run check` is green and `__amh.info()` returns the seven counters.

---

## Task 2: Dispose per-ship GPU resources in `ShipView` (#114)

**Files:**
- Modify: `src/render/shipView.ts`
- Test: create `tests/shipView.test.ts`

**Build:**
- [x] Hoist the flame `ShapeGeometry`, shield `CircleGeometry` and select `RingGeometry` to module constants next
      to `unitPlane` and `barPlane`. These are shared and never disposed.
- [x] Share materials that never vary per ship: the bar background, the cargo bar and the beam glow are never
      written after creation. The hull Lambert material may be cached per hull id alongside `geos` if it is never
      mutated. Materials the update loop writes per ship (flame, shield, select, hpBar, beam, tip) stay per ship.
- [x] `remove` disposes every per-ship material and nothing shared. It must not touch `v.fittings` contents: those
      geometries and materials are cached in `fittings.ts`. `refit` keeps not disposing them.

**Tests:**
- [x] Build a `ShipView`, call `update` with a state holding a ship, then with the ship gone. Spy on `dispose`:
      every per-ship material was disposed exactly once; the shared geometries (hull, flame, shield, select,
      `unitPlane`/`barPlane`) and shared materials were not; fitting geometries/materials were not.
- [x] A refit (change the ship's slots between updates) disposes nothing.
- [x] Two ships share the hoisted geometries (same object identity).

**Done when:** `npm run check` is green and the tests above pass.

---

## Task 3: Handle WebGL context loss (#116)

**Files:**
- Create: `src/render/contextLoss.ts` (or a function in `Renderer.ts`)
- Modify: `src/render/Renderer.ts`, `src/main.ts`, `src/ui/Hud.ts` (+ `src/style.css` only if a banner class is
  needed)
- Test: create `tests/contextLoss.test.ts`

**Build:**
- [x] An exported `watchContextLoss(target: EventTarget, onLost: () => void): () => void` that listens for
      `webglcontextlost`, calls `preventDefault()`, calls `onLost` once (later events are ignored), and returns an
      unsubscribe function.
- [x] `Renderer` gains a hook field `onContextLost: () => void = () => {}` (like `labelBlockers`) and wires
      `watchContextLoss(this.canvas, () => this.onContextLost())` in the constructor.
- [x] `main.ts` sets `renderer.onContextLost` to: save through the session (`session.saveNow()`), show a banner
      "Graphics reset — reloading…" through a small new `Hud` method (reuse the existing banner styling), stop
      ticking the sim, and `location.reload()` after a short delay so the banner is readable.
- [x] Nothing in `src/sim` changes.

**Tests:**
- [x] Dispatching a cancelable `webglcontextlost` `Event` on a plain `EventTarget` marks it `defaultPrevented` and
      calls `onLost` once; a second event does not call it again; after unsubscribe, nothing fires.

**Done when:** `npm run check` is green. Manual check: `__amh.renderer.canvas.getContext('webgl2')
.getExtension('WEBGL_lose_context').loseContext()` shows the banner, saves and reloads into the same game.

---

## Task 4: Warm up shaders after a system build (#118)

**Files:**
- Modify: `src/render/Renderer.ts`
- Test: `tests/renderPerf.test.ts` (or a new file)

**Build:**
- [x] An exported helper that forces a list of objects visible, runs a callback, and restores each object's
      previous `visible` in a `finally`.
- [x] In `render()`, when `system.key` changes and after `SystemView.build`, call
      `this.gl.compileAsync(this.scene, this.cam.camera)` inside that helper with the playfield groups (system,
      rocks, outposts, ships, fx particles/debris) forced visible. Only the synchronous part needs the visibility;
      restore straight after the call returns. Swallow the promise's rejection (`.catch(() => {})`) so it is never
      unhandled.
- [x] Program parameters match: three keys `outputColorSpace` off the target (null target → `outputColorSpace`;
      an `isXRRenderTarget` sRGB target → the same sRGB), so programs compiled for the canvas are the ones the
      composer uses. Confirm, don't assume.

**Tests:**
- [x] The helper makes hidden objects visible during the callback and restores both previously hidden and
      previously visible objects afterwards, including when the callback throws.

**Done when:** `npm run check` is green. Manual check: `__amh.info().programs` does not grow on the first frame the
new system is drawn after a warp.

---

## Task 5: Avoid double MSAA when bloom is on (#117)

**Files:**
- Modify: `src/render/Renderer.ts`
- Test: `tests/renderPerf.test.ts` (or a new file)

**Build (option 2 from the issue, with a runtime fallback):**
- [x] An exported pure helper deciding the context's `antialias`: true only when the AA setting is on and the
      startup quality preset has no bloom (`QUALITY[quality].bloom === 0`). With bloom, the composer target's
      `samples` carries the AA, as today.
- [x] Keep `this.msaa` derived from the AA setting (4 or 0), unchanged.
- [x] Render path: draw directly to the canvas when bloom is off **and** the context itself has AA (or AA is off).
      If bloom is off but AA is on and the context was created without it (the preset changed at runtime), render
      through the composer with the bloom pass disabled, so edges stay antialiased until the next reload.
      `applySettings` must create the composer for that case too, and set `bloom.enabled` to match.
- [x] The bloom path is unchanged: same target, passes and `PRESENT_SHADER`. The `isXRRenderTarget` comment in
      `ensureComposer` still holds; update it to say the context is created without AA when the composer carries it.

**Tests:**
- [x] The antialias helper for each of low/medium/high × AA on/off.
- [x] A pure "use the composer?" helper for bloom on/off × context AA on/off × AA setting on/off.

**Done when:** `npm run check` is green. Visual check at low, medium and high with AA on and off: the bloom look is
unchanged, the no-bloom look at startup is unchanged, and the high preset no longer allocates a context MSAA
backbuffer (`gl.getContextAttributes().antialias === false`).
