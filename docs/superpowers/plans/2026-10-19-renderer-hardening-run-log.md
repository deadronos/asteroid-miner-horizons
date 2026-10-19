# Renderer hardening — run log

- **Date:** 2026-10-19
- **Issues:** #114, #115, #116, #117, #118 (umbrella #119), from Phase 0 of the three.js audit
- **Branch:** `perf/renderer-hardening`
- **Design:** [`../../threejs-best-practices-audit-2026-10-19.md`](../../threejs-best-practices-audit-2026-10-19.md) (no
  separate spec; these are small fixes)
- **Plan:** [`2026-10-19-renderer-hardening.md`](2026-10-19-renderer-hardening.md)

## Setup

Claude Code orchestrated. It committed the audit, wrote the plan, then dispatched one implementer subagent (Haiku)
per task and a separate read-only reviewer subagent (Opus) that had not written the code. Fix rounds went back to
the original implementer through SendMessage so it kept its context. A fresh Opus reviewer re-reviewed fix rounds
that changed behaviour. The orchestrator re-ran `npm run check`, read every diff and committed each task.

For the browser checks, the orchestrator ran the branch (`npm run dev`) and a worktree of the pre-change commit
(`d09484d`) side by side, and drove both through Chrome DevTools. For the screenshot comparisons, an init script
froze time: `Math.random` returned 0.5, `performance.now` and the `requestAnimationFrame` timestamp returned 0,
and storage was cleared so every run started the same seed at sim time 0. Two captures of the same build differed
in 0 pixels, so any difference between builds is real.

## Deviation from the plan

- **Task 1 and Task 5 put their pure helpers in their own modules** (`render/renderInfo.ts`, `render/aa.ts`), so
  the node tests do not have to import `Renderer.ts` (which pulls in the canvas-built `glowTexture`).
- **Task 3 added `Hud.showNotice` and a `.paused.gfx-reset` style rule** to raise the banner above the menu and
  the warp flash. The plan only asked for a HUD method.
- **Task 4 forces only `system.group` visible, not the whole playfield.** The plan and the issue assumed
  `WebGLRenderer.compile` walks only visible objects. In r186 it gathers lights with `traverseVisible`, but finds
  materials with a full `traverse`. The only thing hidden by the warp that changes a program key is the star's
  `PointLight`, which lives in `system.group`.
- **Re-review skipped for four trivial fix rounds:** Task 1 (comments only), Task 2 (test assertions only), Task 3
  round 3 (a CSS class rename) and Task 5 (a comment and a parameter rename). The orchestrator verified those
  rounds by reading the diff and running `npm run check`. Every round that changed behaviour got a fresh reviewer.

## Sessions

| Task | Implementer rounds | Review rounds | Extra verification | Commit |
| --- | --- | --- | --- | --- |
| 1 `renderer.info` getter (#115) | 2 | 1 | browser: `__amh.info()` | `b5eb2de` |
| 2 ShipView disposal (#114) | 2 | 1 | — | `739c8e3` |
| 3 Context loss (#116) | 3 | 2 | browser: `loseContext()` | `f9ede42` |
| 4 Shader warm-up (#118) | 3 | 2 | browser: programs across a warp | `31c49a2` |
| 5 No double MSAA (#117) | 2 | 1 | browser: screenshot diff ×8 | `18fa911` |

## Verification

- After every task: `npm run check` was green and the full diff was read before committing. The suite grew from
  616 to 643 tests.
- No `src/sim`, `src/core` or `src/data` change, and no save-shape change, so `docs/balance.md` and
  `SAVE_VERSION` are untouched.
- **#115:** `__amh.info()` returns `{ calls, triangles, points, lines, geometries, textures, programs }`. On high
  it reported 60 draw calls a frame with the composer's passes included, which is what `autoReset = false` plus a
  per-frame `reset()` is for.
- **#116:** `WEBGL_lose_context.loseContext()` in the browser showed "Graphics reset — reloading…" at z-index 50
  and froze the sim (run time stayed at 7.53 s). The page then reloaded into the same seed, resuming from the
  saved time.
- **#118:** in both builds, a warp was sent and `gl.info.programs.length` was sampled every frame.
  - **Before:** 7 programs compiled on the reveal frame, about 530 ms after the warp, and the worst frame took 33 ms.
  - **After:** the new programs compile in the first two frames of the warp, behind the streaks and white-out. None
    compile at the reveal.
- **#117:** screenshots of the frozen scene, before and after, pixel-diffed with ImageMagick (`compare -metric AE`):

  | Configuration | Context `antialias` before → after | Pixels differing |
  | --- | --- | --- |
  | high, AA on | true → **false** | 0 |
  | high, AA off | false → false | 0 |
  | medium, AA on | true → **false** | 0 |
  | medium, AA off | false → false | 0 |
  | low, AA on | true → true | 0 |
  | low, AA off | false → false | 0 |
  | low → high at runtime, AA on | true → true | 0 |
  | high → low at runtime, AA on | true → **false** | 287 of 960 000 (RMSE 0.23%) |

  - **Startup:** every startup preset looks byte-identical, and the high and medium presets no longer allocate the
    context MSAA backbuffer.
  - **Runtime switch to a no-bloom preset:** this is the one intended difference. The frame renders through the
    composer's MSAA target with bloom disabled until the next reload. Only 41 pixels differ by more than 2%, all on
    edges where the two MSAA resolves differ. The result is closer to the AA look than no AA would be (965 pixels
    differ).
- **#114:** covered by unit tests only.
  - Unit tests spy on `dispose` and cover four things: removal, refit, hull change, and sharing between ships.
  - A browser check with `info.memory` cannot show this leak. `info.memory` counts only geometries that have been
    uploaded (drawn) and does not count materials. Fake ships' flame, shield and select meshes are hidden, so the
    count was flat before the fix too.

## Review notes

### Task 1 (#115)

- **Accepted (nit):** the getter comment called `geometries`/`textures`/`programs` per-frame counters; they are live
  totals. Reworded.
- **Accepted (nit):** the `renderInfo.ts` header explained why the file is separate; now a one-line "what it is".
- **Rejected (nit):** `info: () => renderer.info` duplicates `__amh.renderer.info`. The plan and the issue ask for
  the hook, and it is the convenient spelling in the console.

### Task 2 (#114)

- The reviewer confirmed that the shared materials (bar background, cargo bar, beam glow, and the per-hull Lambert)
  are never written per ship. It also confirmed that the tip's `SpriteMaterial.dispose()` leaves `glowTexture`
  alone, and that the fittings are never disposed.
- **Accepted (nit):** the removal test now also asserts that the hull material survives. The hull-change test now
  asserts all six per-ship materials are disposed, not just two.
- **Rejected (nit):** the tests reach the private `visuals` map through a cast and assume the hull mesh is
  `body.children[0]`. That is the established node-env pattern (see `rocks.test.ts`), and there is no DOM-free
  alternative.
- **Rejected (nit):** a `Visual` helper listing the per-ship parts. Six parts in one loop do not need an
  abstraction.

### Task 3 (#116)

- **Accepted (minor):** the banner (z-index 25) could be dimmed by the open menu (30) or hidden under a warp flash
  (40) that froze when the frame loop stopped. `showNotice` now raises the banner and clears the flash.
- **Accepted (minor, round 2):** the first fix named the modifier class `notice`, which already exists for ship
  panel notices and shrank the banner text. It was renamed to `gfx-reset`. The colliding name was the
  orchestrator's suggestion.
- **Rejected (minor):** a `sessionStorage` guard against reload loops. The issue asks for a minimal fix, and a
  browser that keeps losing the context blocklists WebGL, after which the renderer fails at construction, so the
  loop is bounded. Listed as a follow-up.
- **Rejected (nit):** `saveNow()` pushes a "Saved to slot" log line that is never shown. The plan names
  `saveNow`, and `out.log` is not saved.
- **Rejected (nit):** muting audio during the 1.5 s before the reload, and keeping the unsubscribe function from
  `watchContextLoss`. Neither matters for a page that is about to reload, and `Renderer` has no `dispose`.

### Task 4 (#118)

- **Accepted (minor):** the comments repeated the plan's wrong premise ("compile walks only visible objects").
  The orchestrator checked r186 (`WebGLRenderer.compile`: lights come from `traverseVisible`, materials from
  `traverse`). It narrowed the forced-visible list to `system.group`, which holds the star's `PointLight`, rewrote
  the comments and dropped the now-unneeded `FxView.visibleObjects` getter. That getter also allocated an array
  on each call, which a reviewer nit had flagged. A second reviewer confirmed that the scene has no other light in
  a group the warp hides, and nothing else visibility-dependent in the program key.
- **Accepted (nit):** import order.
- **Rejected:** wrapping `compileAsync` in try/catch. A synchronous throw from `compile` would be a real bug that
  also breaks the following render, so it should surface. The returned promise is already guarded by `.catch`.
- **Rejected (nit):** `compileAsync` keeps polling forever if the context is lost mid-poll. The #116 handler reloads
  the page.
- **Confirmed, no change:** programs compiled against the canvas have the same cache key as those used inside the
  composer's `isXRRenderTarget` sRGB target (same `outputColorSpace` and tone-mapping branch, and sample count is
  not in the key). The bloom and present passes are not warmed. Their programs are built once, the first time bloom
  is enabled, not per system.

### Task 5 (#117)

- The design was chosen by the orchestrator before dispatch. Option 2 from the issue applies: the context gets AA
  only if the startup preset has no bloom. There is also a runtime fallback through the composer with bloom
  disabled. Option 1 (always render through the composer) was ruled out because the half-float target does not
  clamp per blend the way the 8-bit canvas does, so the no-bloom look could not stay byte-identical.
- The reviewer confirmed the following:
  - The bloom path is unchanged.
  - A full-screen present quad resolves identically with or without context MSAA.
  - `EffectComposer` skips a disabled pass without swapping buffers, so PRESENT still reads the RenderPass output.
  - Every runtime transition sets `bloom.enabled` and `strength` correctly.
- **Accepted (minor):** a comment on the fallback saying it is close to, not identical with, the canvas look, and
  that the disabled bloom pass keeps its targets on purpose.
- **Accepted (nit):** `useComposer` takes a `wantAA` boolean instead of a sample count.
- **Rejected (nit):** drop the "only low with AA on gets context antialias" test because it depends on today's
  preset values. It pins the issue's intent (the high preset gets no context MSAA), and if a preset's bloom is
  retuned, the test should fail so someone revisits it.
- **Known cost:** a low-preset start with AA on that switches to high at runtime still holds both MSAA buffers
  until reload. Removing it would mean recreating the context, which the "applies after reload" rule rules out.

## Follow-ups

- A reload-loop guard for repeated context loss, if it is ever seen in the wild.
- Warm the bloom and present passes the first time bloom is enabled, if that first toggle hitches.
- Phase 1 of the audit (WebGPU spike) is out of scope here.
