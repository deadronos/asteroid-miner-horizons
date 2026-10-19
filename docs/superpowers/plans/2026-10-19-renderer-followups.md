# Renderer Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two follow-ups from the renderer hardening run log:
- warm the bloom composer's shaders before its first visible frame (#121);
- stop the context-loss handler from reloading forever when the GPU keeps resetting (#122).

**Architecture:**
- **#121** is a `Renderer` change. When the composer is first asked to draw bloom, render it once off screen with
  `composer.renderToScreen = false`, so every pass program is built against the target it really draws into, and
  the canvas is never touched.
- **#122** is a pure policy module at the top level (like `pause.ts`), plus wiring in `main.ts` and a persistent
  HUD notice with a Reload button.

**Tech Stack:** TypeScript, three.js r186, Vite, Vitest (node env), oxlint/oxfmt

**Design:** no separate spec. The issues are the design, with the context in
[`2026-10-19-renderer-hardening-run-log.md`](2026-10-19-renderer-hardening-run-log.md) (follow-ups) and the audit
[`docs/threejs-best-practices-audit-2026-10-19.md`](../../threejs-best-practices-audit-2026-10-19.md).

## Global Constraints

- **No game logic in `src/sim`.** The one allowed touch is the shared storage guard: `safeStorage` in
  `src/sim/save.ts` may gain an optional parameter choosing `sessionStorage`, with existing callers unchanged.
  Nothing else in `src/sim`, `src/core` or `src/data`; no save-shape change; `docs/balance.md` must not move.
- **Layer rules:** `render/` may import `core/`, `data/`, `sim/` and `settings.ts` only. Cross-layer wiring goes
  through `main.ts`.
- **Settings changes go through `SettingsStore`.** Nothing writes the settings key directly.
- **No new dependencies.** No jsdom. Tests run in Vitest's node env and test pure seams.
- **Do not touch** `scratch.md` or `docs/balance.md`.
- **Style:** one header comment per new module, `/** */` on exported functions and non-obvious fields, no comment
  noise. `npm run check` must be green after every task.
- Implementers do not commit, push or switch branches; the orchestrator commits each task.

## Review Focus

1. **The warm-up shows a frame.** The warm render must never draw to the canvas. `EffectComposer.render` sets each
   pass's `renderToScreen` from `composer.renderToScreen && isLastEnabledPass(i)`, so turning the composer's flag
   off is enough. It must be restored in a `finally`. **Task 1.**
2. **The warm-up compiles the wrong variants.** Three keys a program on the current target's colour space and tone
   mapping. Compiling the bloom materials against the canvas, for example with `compileAsync`, would build variants
   that the internal targets never use. The warm render goes through the real targets. **Task 1.**
3. **The warm-up runs at the wrong time, too often or not at all.** It must run:
   - before the first frame on a cold start at medium or high;
   - in `applySettings` on the first switch to a bloom preset;
   - again if the bloom pass was first built disabled (the #117 runtime fallback) and is later enabled.

   It must run after `resize()`, so the targets have their real size, and not on every `applySettings`. **Task 1.**
4. **A lost context breaks the warm-up.** `applySettings` can run while the context is lost (the menu still works
   behind the #116 notice). three's `render` returns early on a lost context. Make sure nothing throws. **Task 1.**
5. **The loop window counts wrongly.** It is off by one at the threshold, keeps stale timestamps forever, trusts
   junk from storage (NaN, future times, non-arrays), or grows without bound. **Task 2.**
6. **The notice cannot be clicked.** `.paused` has `pointer-events: none`, and the banner sits over the menu. The
   Reload button must be clickable and the notice must stay up. **Task 2.**
7. **Storage failure blocks the reload.** If `sessionStorage` is missing, blocked or full, the first-loss behaviour
   (save, banner, reload) must still work. **Task 2.**

---

## Task 1: Warm up the bloom composer's shaders (#121)

**Files:**
- Modify: `src/render/Renderer.ts`
- Create (optional): a small `src/render/` module for the pure helper(s), so tests need not import `Renderer.ts`
- Test: a new `tests/*.test.ts`

**Build:**
- [x] An exported helper `warmComposer(composer)` taking a minimal shape `{ renderToScreen: boolean;
      render(dt?: number): void }`. It sets `renderToScreen = false`, calls `render(0)`, and restores the previous
      value in a `finally`.
- [x] In `Renderer`, track which composer passes have been warmed: the present pass, and the present pass plus
      bloom. In `applySettings`, after `resize()`, warm when the composer is in use (`viaComposer`) and its
      currently enabled passes have not been warmed yet. Ideally this is a tiny pure predicate that the tests also
      cover.
- [x] The constructor already calls `applySettings`, so a cold start at medium or high warms before the first
      frame.
- [x] A short comment saying why the warm-up is an off-screen render and not `compileAsync`: program keys depend on
      the target's colour space.

**Tests:**
- [x] `warmComposer` renders with `renderToScreen` false, passes 0, and restores the flag, also when `render`
      throws.
- [x] The "needs warming" predicate covers:
  - no composer use;
  - the first bloom use;
  - the fallback (bloom disabled) followed by bloom enabled;
  - an already-warmed state.

**Done when:** `npm run check` is green. In the browser, measure programs compiled per frame:
- on a cold start at medium and high;
- on a runtime switch from low to high.

Before (main @ `7c40c80`):
- cold high: frame 0 compiles 30 programs in 81.6 ms
- cold medium: frame 0 compiles 28 programs in 56.4 ms
- low → high: the first bloom frame compiles 9 programs in 28.2 ms

After: the bloom programs (about 9) are compiled before the first frame, or inside the settings change, and no
visible frame compiles them. No frame shows a wrong look.

---

## Task 2: Guard against reload loops on repeated context loss (#122)

**Files:**
- Create: `src/reloadGuard.ts` (pure policy; top-level like `pause.ts`)
- Modify: `src/sim/save.ts` (`safeStorage` gains an optional storage choice; default unchanged), `src/main.ts`,
  `src/ui/Hud.ts`, `src/style.css`
- Test: create `tests/reloadGuard.test.ts`

**Build:**
- [x] Pure functions in `src/reloadGuard.ts`:
  - `parseLosses(raw: string | null): number[]`. Tolerates null, bad JSON, non-arrays and non-finite entries.
  - `decideReload(losses: readonly number[], now: number, windowMs, maxReloads)`. Returns
    `{ reload: boolean; losses: number[] }`, where `losses` keeps only the timestamps inside the window plus `now`,
    capped in length. With the defaults (`maxReloads` 2, window 60 s), the first and second losses in the window
    reload, and the third shows the notice.
- [x] `safeStorage(area = 'localStorage')` in `src/sim/save.ts` also accepts `'sessionStorage'`. Existing callers
      are unchanged.
- [x] `main.ts` `onContextLost`:
  - save as today;
  - read and decide through `safeStorage('sessionStorage')`, guarding the write against a full or blocked store;
  - then either show "Graphics reset — reloading…" and reload, or show a persistent notice: "Graphics keep
    resetting — try lowering quality or disabling anti-aliasing, then reload", with a Reload button that calls
    `location.reload()`.

  Storage failure must fall back to today's behaviour (reload).
- [x] `Hud.showNotice(text, action?)` gains an optional button. The notice takes pointer events so the button works.
      The banner stays above the menu, so the player can still open ⚙ to change quality.
- [x] Not doing the optional "drop to low on the second loss". Changing the player's preset silently is out of
      scope; the notice suggests it instead.

**Tests:**
- [x] `decideReload`:
  - first loss reloads;
  - second within the window reloads;
  - third within the window does not;
  - losses older than the window are dropped and reloading resumes;
  - future timestamps or junk are ignored;
  - the stored list stays bounded.
- [x] `parseLosses` with null, bad JSON, an object, and mixed entries.

**Done when:** `npm run check` is green. In the browser, `WEBGL_lose_context.loseContext()`:
- reloads on the first and second loss;
- shows the persistent notice with a working Reload button on the third loss within 60 s.
