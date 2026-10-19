# Renderer follow-ups — run log

- **Date:** 2026-10-19
- **Issues:** #121 (warm the bloom composer's shaders), #122 (reload-loop guard on repeated context loss). Both are
  follow-ups from [`2026-10-19-renderer-hardening-run-log.md`](2026-10-19-renderer-hardening-run-log.md).
- **Branch:** `fix/renderer-followups`
- **Plan:** [`2026-10-19-renderer-followups.md`](2026-10-19-renderer-followups.md) (no separate spec)

## Setup

Same model as the hardening run:
- Claude Code orchestrated: it wrote the plan, dispatched one Haiku implementer per task, and used a separate Opus
  reviewer that had not written the code.
- Fix rounds went back to the same implementer. A fresh Opus reviewer re-reviewed every fix round that changed
  behaviour.
- The orchestrator re-ran `npm run check`, read each diff and committed.

For the browser checks, this branch and a worktree of `main` at `7c40c80` ran side by side in Chrome DevTools.
- **Program counts:** an init script wrapped `requestAnimationFrame` to record `gl.info.programs.length` before
  and after every frame, plus the frame's duration.
- **Screenshots:** the frozen-time harness from the hardening run (fixed `Math.random`, zero
  `performance.now`/rAF timestamps).

## Deviation from the plan

- **Task 1 hides the scene during the warm render.** The plan did not ask for this. The orchestrator's first
  measurement found 33 programs where `main` has 30. At constructor time no system exists, so there is no
  PointLight, and the warm render's RenderPass compiled light-less scene variants that real frames never use.
  With `scene.visible = false` during the warm render, only the composer's own pass programs are built. The
  scene's programs stay with the #118 warm-up.
- **Task 2 touches `src/sim/save.ts`:** `safeStorage` gained an optional `'sessionStorage'` area. This was
  planned as the one allowed `src/sim` change, because the issue asks for the shared guard to be used with
  `sessionStorage`. Existing callers are unchanged, and a test pins the default.
- **Re-review skipped for two trivial fix rounds:** Task 1 had none. Task 2 round 3 changed a JSDoc line and merged
  two CSS blocks. The orchestrator verified that round by reading the diff and running `npm run check`.

## Sessions

| Task | Implementer rounds | Review rounds | Extra verification | Commit |
| --- | --- | --- | --- | --- |
| 1 Bloom composer warm-up (#121) | 2 | 2 | browser: programs per frame, screenshot diff | `5834b84` |
| 2 Reload-loop guard (#122) | 3 | 2 | browser: three forced losses, notice, menu | `8877a40` |

## Verification

- After every task: `npm run check` was green and the full diff was read. The suite grew from 643 to 677 tests.
  `npm run build` passes.
- **#121, programs compiled per frame** (`main` → this branch):

  | Case | Before | After |
  | --- | --- | --- |
  | Cold start, high | frame 0 compiles 30 programs, 81.6 ms | 9 compiled before frame 0; frame 0 compiles 21, 39.9 ms |
  | Cold start, medium (fixed seed) | frame 0 compiles 30, 57.3 ms | 9 before frame 0; frame 0 compiles 21, 39.5 ms |
  | Runtime low → high | first bloom frame compiles 9, 28.2 ms | 9 compile inside the settings change (31.6 ms, menu open); no frame compiles; worst frame 1.8 ms |

  - The total program count is the same as `main` (30), so the warm-up builds no unused variants.
  - Frame 0 on a cold start still compiles the scene's own programs. That is #118's warm-up and is out of scope.
- **#121, no wrong-look frame:** the warm render never touches the canvas. `composer.renderToScreen = false` makes
  every pass draw into a target. Frozen-time screenshots of a cold high start and of a low → high switch are
  pixel-identical to `main` (0 pixels differ). Intermediate frames were not captured; that rests on the code and
  two reviews.
- **#122, in Chrome with `WEBGL_lose_context.loseContext()`:**
  - The first and second losses showed "Graphics reset — reloading…" and reloaded, and the timestamps survived the
    reload in `sessionStorage`.
  - The third loss within 60 s showed the persistent notice and did not reload, even after 2.5 s.
  - The Reload button is the hit target, while the banner text is click-through. Clicking it reloaded into the
    saved game.
  - With the notice up, the ⚙ menu opens and a quality change saves through `SettingsStore` with no console errors.
    The 560 px notice no longer overlaps the side panels.

## Review notes

### Task 1 (#121)

- **Design (orchestrator, before dispatch):** an off-screen composer render rather than `compileAsync`. three keys
  programs on the current target's colour space and tone mapping, and the bloom passes draw into plain (non-XR)
  targets, so compiling against the canvas would build variants they never use. The reviewers confirmed that the
  off-screen final pass draws into an `isXRRenderTarget` sRGB target, which keys the same as the canvas.
- **Found in the browser (orchestrator, accepted):** wasted light-less scene variants. Fixed by hiding the scene
  during the warm render.
- **Accepted (minor):** the sticky `contextLost` field in `Renderer` duplicated three's own state and would be wrong
  after a restore. Replaced by `gl.getContext().isContextLost()`.
- **Accepted (nits):**
  - a pure `claimWarm` helper, so the check-and-record is tested instead of copied into tests;
  - an accurate comment on when `'present'` is reached (only after `'bloom'` has covered it in every current path);
  - import order.
- **Rejected (nit):** move the warm-up after `backdrop.configure`. Hiding the scene made the ordering irrelevant.
- **Rejected (low):** wrap `warmComposer` in try/catch. three logs shader errors rather than throwing, and a real
  throw would be a bug that should surface. This matches the #118 decision.
- **Corrected rationale:** a re-reviewer noted that `numPointLights` is in the key of every non-raw material, not
  just lit ones. The pass programs are unaffected only because each full-screen quad renders as its own light-free
  scene.

### Task 2 (#122)

- **Accepted (minor):** the whole actionable banner took clicks at z-index 50 and could cover the ⚙ menu's
  controls. The orchestrator also saw it overlap the ship panel. Now only the button takes pointer events, and the
  notice has a max-width so it wraps.
- **Accepted (minor):** the storage fallback (missing store, throwing read, throwing write) lived untested in
  `main.ts`. It is now `recordLoss(store, now)` in `src/reloadGuard.ts`, with tests for each case and a round trip.
- **Accepted (nits):**
  - `role="alert"` on the actionable notice;
  - a test pinning `safeStorage()`'s default area;
  - a stale JSDoc line;
  - two CSS blocks merged into one.
- **Rejected (nit):** move focus to the Reload button. It could steal focus from an open menu; `role="alert"`
  announces the notice instead.
- **Rejected (nit):** the duplicated `/** */` on `Hud.frame`. It is pre-existing and unrelated, so it stays out of
  this diff.
- **Not done, by design:** the issue's optional "drop to low quality on the second loss". The notice suggests it
  instead of changing the player's preset silently.
- **Behaviour to know:** auto-reload resumes 60 s after the second-most-recent loss. If the clock goes backwards,
  stored timestamps look like future ones and are ignored, which allows a reload.

## Follow-ups

- The scene's own programs still compile on the cold-start frame 0 (about 21 programs, ~40 ms). Warming them before
  the first frame would need the system built in the constructor.
- #123 (manual HiDPI/mobile verification) is still open.
