# Pause-aware Continuous Audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop beam hums and the danger alarm while the game is paused in an explicit pause or menu, while keeping the alarm audible during an unfocused-window pause, so #67's "no indefinite beeping in a pause menu" holds without losing the away-from-keyboard warning.

**Architecture:** A new pure `src/pause.ts` classifies why the sim is frozen (`manual` / `menu` / `unfocused`) and maps that to a `ContinuousPolicy` (`hums`, `alarm`). `AudioEngine.updateContinuous` takes that policy and fades hums / skips the alarm accordingly. `src/main.ts` computes the pause kind once and hands the same value to both the pause banner and the audio layer.

**Tech Stack:** TypeScript, Web Audio API, Vite, vitest, oxlint/oxfmt. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-18-pause-audio-design.md` — read it with this plan; it is the design of record and the authority for every decision below.

## Global Constraints

Copied from the issue and the spec's rulings:

- **Behavioral table is fixed:**

  | Pause kind | hums | alarm |
  | --- | --- | --- |
  | running | on | on |
  | `manual` | off | off |
  | `menu` | off | off |
  | `unfocused` | off | **on** |

- **Banner strings do not change.** `manual` → `PAUSED: press P to resume`; `menu` → `PAUSED: menu open`; `unfocused` → `PAUSED: window not focused`.
- **Pause precedence does not change:** manual > menu > unfocused, each gated by its existing setting (`pauseInMenus`, `pauseUnfocused`).
- **`nextAlarm` is not reset when the alarm is suppressed.** A pause that opens while the alarm is due must sound on the first frame after resume.
- **No `src/sim/**`, save-format, or settings-shape change.** No new user-facing setting.
- **Pure rules stay pure and unit-tested.** `src/pause.ts` must not import DOM, three.js, or the AudioEngine.
- **Default parameter, not a breaking signature change:** `updateContinuous(state, view, policy = LIVE_CONTINUOUS)`.
- **Keep the full CI gate green:** `npm run format:check`, `npm run lint` (warnings fail), `npm run typecheck`, `npm test`, `npx vite build`.
- **Browser smoke test is mandatory** for final verification: the hum fade and the alarm suppression only exist in Web Audio, which no unit test observes.

Before every commit in every task, run `npm run format`, `npm run lint`, and `npm run typecheck` and confirm they pass.

## Review Focus

Failure modes the obvious assertions do **not** directly exercise, most-likely-first.

1. **The unfocused policy silences the alarm** (turning the fix into a regression of the issue's stated goal). Owning task: Task 1 — an explicit `pauseAudio('unfocused')` assertion with `alarm: true`.
2. **The banner and audio disagree** because a second code path recomputes the pause reason. Owning task: Task 2 — both call sites consume the same `kind` value.
3. **Resume leaves the mix stuck** (hums never return, or the alarm timer was pushed 1.1 s past resume). Owning task: Task 2 + Task 3 — smoke test closes the menu and re-checks `hums.size > 0` and that a due alarm fires promptly.
4. **`pauseUnfocused: false` now mutes audio anyway** when the window is unfocused. Owning task: Task 1 — `pauseKind` returns null (running) when the gate is off, so the policy stays live.
5. **A locked/suspended AudioContext path changes behavior.** Owning task: Task 2 — keep the existing early-return untouched.

---

## Task 1: Pure pause classification and audio policy

**Files:**
- Modify: `src/audio/sfx.ts` (add `ContinuousPolicy`, `LIVE_CONTINUOUS`)
- Create: `src/pause.ts`
- Test: create `tests/pause.test.ts`

**Interfaces:**
- Produces (in `src/audio/sfx.ts`):
  ```ts
  /** Which continuous layers may sound this frame. */
  export interface ContinuousPolicy {
    hums: boolean;
    alarm: boolean;
  }
  export const LIVE_CONTINUOUS: ContinuousPolicy = { hums: true, alarm: true };
  ```
- Produces (in `src/pause.ts`):
  ```ts
  export type PauseKind = 'manual' | 'menu' | 'unfocused';
  export interface PauseInput {
    manual: boolean;
    pauseInMenus: boolean;
    pauseUnfocused: boolean;
    menuOpen: boolean;
    researchOpen: boolean;
    focused: boolean;
  }
  export function pauseKind(i: PauseInput): PauseKind | null;
  export function pauseBanner(kind: PauseKind | null): string | null;
  export function pauseAudio(kind: PauseKind | null): ContinuousPolicy;
  ```
  `pauseKind` returns the highest-priority reason: `manual` if `manual`; else `menu` if
  `pauseInMenus && (menuOpen || researchOpen)`; else `unfocused` if
  `pauseUnfocused && !focused`; else null. `pauseBanner(null)` is null.
  `pauseAudio(null)` returns `LIVE_CONTINUOUS`.

- [ ] **Step 1: Write the failing test** in `tests/pause.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { LIVE_CONTINUOUS } from '../src/audio/sfx';
import { pauseAudio, pauseBanner, pauseKind, type PauseInput } from '../src/pause';

const running: PauseInput = {
  manual: false,
  pauseInMenus: true,
  pauseUnfocused: true,
  menuOpen: false,
  researchOpen: false,
  focused: true,
};

describe('pauseKind', () => {
  it('is null while the sim runs', () => {
    expect(pauseKind(running)).toBeNull();
  });

  it('reports a manual pause first', () => {
    expect(pauseKind({ ...running, manual: true, menuOpen: true, focused: false })).toBe('manual');
  });

  it('reports an open menu or research panel only when pauseInMenus is on', () => {
    expect(pauseKind({ ...running, menuOpen: true })).toBe('menu');
    expect(pauseKind({ ...running, researchOpen: true })).toBe('menu');
    expect(pauseKind({ ...running, menuOpen: true, pauseInMenus: false })).toBeNull();
  });

  it('reports unfocused only when pauseUnfocused is on', () => {
    expect(pauseKind({ ...running, focused: false })).toBe('unfocused');
    expect(pauseKind({ ...running, focused: false, pauseUnfocused: false })).toBeNull();
  });

  it('prefers menu over unfocused', () => {
    expect(pauseKind({ ...running, menuOpen: true, focused: false })).toBe('menu');
  });
});

describe('pauseBanner', () => {
  it('is null while running and names each pause kind', () => {
    expect(pauseBanner(null)).toBeNull();
    expect(pauseBanner('manual')).toContain('press P');
    expect(pauseBanner('menu')).toContain('menu open');
    expect(pauseBanner('unfocused')).toContain('not focused');
  });
});

describe('pauseAudio', () => {
  it('leaves both layers live while running', () => {
    expect(pauseAudio(null)).toEqual(LIVE_CONTINUOUS);
  });

  it('silences hums and the alarm for explicit pauses', () => {
    expect(pauseAudio('manual')).toEqual({ hums: false, alarm: false });
    expect(pauseAudio('menu')).toEqual({ hums: false, alarm: false });
  });

  it('keeps only the alarm while the window is unfocused', () => {
    expect(pauseAudio('unfocused')).toEqual({ hums: false, alarm: true });
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/pause.test.ts`.
  Expected: FAIL — cannot resolve `../src/pause`, and `LIVE_CONTINUOUS` is not exported.

- [ ] **Step 3: Implement.** Add the two exports to `src/audio/sfx.ts` near the other
  continuous-layer declarations. Create `src/pause.ts` with a file-header comment
  explaining that it is the single source of truth for "why frozen" and "what may sound",
  plus the types/functions above. Keep the banner strings byte-identical to the strings
  `src/main.ts` currently returns:
  `'PAUSED: press P to resume'`, `'PAUSED: menu open'`, `'PAUSED: window not focused'`.
  Import `ContinuousPolicy` (and `LIVE_CONTINUOUS`) from `./audio/sfx` using `import type`
  for the type where possible.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/pause.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Gate and commit.** Run `npm run format`, `npm run lint`,
  `npm run typecheck`, `npx vitest run tests/pause.test.ts`. Commit:
  `Add a pure pause-kind and continuous-audio policy rule (#67)`.

**Done when:** `tests/pause.test.ts` is green, no other test changed, and `src/pause.ts`
imports nothing from `three`, `./audio/AudioEngine`, or the DOM.

---

## Task 2: Pass the policy through the engine and the loop

**Files:**
- Modify: `src/audio/AudioEngine.ts` (`updateContinuous` takes a policy)
- Modify: `src/main.ts` (compute `pauseKind` once; wire banner + audio)
- Test: `tests/audio.test.ts` is **not** extended (no Web Audio in node); Task 3's browser
  smoke test is the verification for this task.

**Interfaces:**
- Consumes: `ContinuousPolicy`, `LIVE_CONTINUOUS` from Task 1.
- Produces: `AudioEngine.updateContinuous(state: GameState, view: View, policy?: ContinuousPolicy): void`.

- [ ] **Step 1: Update `AudioEngine.updateContinuous`.**

```ts
  /**
   * Continuous layer: a looping hum per active mining beam and a repeating alarm
   * while the selected ship is in danger. `policy` selects which layers may sound
   * this frame (see `pauseAudio`). Called every frame; read-only on `state`.
   */
  updateContinuous(state: GameState, view: View, policy: ContinuousPolicy = LIVE_CONTINUOUS): void {
    const { ctx, sfx } = this;
    // Locked or suspended: never start a voice, just fade out whatever is left.
    if (!ctx || !sfx || ctx.state !== 'running') {
      this.silenceHums();
      this.nextAlarm = 0;
      return;
    }
    const now = ctx.currentTime;
    if (policy.hums) {
      const hums = beamHums(state.run, state.profile, view);
      // ...existing hum create/update block, unchanged...
      // (release dropped voices first, then ramp/create each hum)
    } else {
      this.silenceHums();
    }
    // Suppressed alarm: leave nextAlarm alone so a due alarm fires right after resume.
    if (policy.alarm) this.updateAlarm(state, now);
  }
```

  The hum block body is the current code exactly (release dropped voices, create up to
  `MAX_HUMS`, ramp gain/freq/filter/pan). Import `type ContinuousPolicy`,
  `LIVE_CONTINUOUS` from `./sfx`. Update the file-header comment that says the method "is
  called every frame" to mention the policy.

- [ ] **Step 2: Rewire `src/main.ts`.**
  - Import `{ pauseAudio, pauseBanner, pauseKind }` from `./pause`.
  - Delete the private `pauseReason()` function.
  - In `frame()`, replace `const paused = pauseReason();` with:

```ts
    const s = settings.value;
    const paused = pauseKind({
      manual: manualPause,
      pauseInMenus: s.pauseInMenus,
      pauseUnfocused: s.pauseUnfocused,
      menuOpen: hud.menu.open,
      researchOpen: hud.researchOpen,
      focused: document.hasFocus(),
    });
    hud.setPaused(pauseBanner(paused));
```

  - Change the continuous call to
    `audio.updateContinuous(state, renderer.view, pauseAudio(paused));`.
  - `paused` stays the same truthy/null value the `if (paused)` branch already uses, so
    the sim-freeze branch is unchanged.

- [ ] **Step 3: Typecheck and gate.** Run `npm run typecheck`, then `npm run format`,
  `npm run lint`, `npm test`. All green and still 321+ tests. Commit:
  `Gate continuous audio on the pause kind (#67)`.

**Done when:** `src/main.ts` no longer contains `pauseReason`, `grep -rn "pauseReason" src`
is empty, the banner still shows the same three strings, and every existing test passes.

---

## Task 3: Documentation and browser verification (controller)

**Files:**
- Modify: `README.md` (audio bullet)
- Create: `docs/superpowers/plans/2026-10-18-pause-audio-run-log.md`

- [ ] **Step 1: README audio bullet.** Replace
  `_Audio_: volume sliders reserved for when sound arrives.`
  with a bullet that states the sliders apply live and that beam hums go quiet while
  paused while the low-hull/overheat alarm keeps sounding only while the window is
  unfocused. Keep it to two lines.

- [ ] **Step 2: Browser smoke test (mandatory).** Start `npm run dev`, open the page,
  click once to unlock the AudioContext (check `__amh.audio.state === 'running'`).
  Force a danger state through the debug hook (selected ship `hull = 1`) and an active
  beam (set a ship's `beamOn = true` / `beamTargetId` to a live rock). Then:
  1. Running: `__amh.audio.hums.size > 0` and `nextAlarm` advances within ~2 s.
  2. Open the ⚙ menu: hums fall to 0 and `nextAlarm` stops advancing.
  3. Close it: hums return and a due alarm fires promptly.
  4. Simulate unfocus with `document.hasFocus = () => false`: hums stay 0 while
     `nextAlarm` advances (alarm alive).
  Confirm no console errors. Record the observations for the run log.

- [ ] **Step 3: Full gate.** Run `npm run check` and `npx vite build`. Commit the README
  and the run log: `Document pause-aware continuous audio and verify in the browser (#67)`.

**Done when:** the README describes the behavior, the smoke test observations are in the
run log, and `npm run check` + `npx vite build` pass on the branch head.

---

## Self-review notes

- Spec coverage: the policy table (Task 1), the `nextAlarm` ruling (Task 2), the README +
  smoke evidence (Task 3), and both issue acceptance criteria (Task 1 + Task 3).
- No placeholders: every signature and string above is literal.
- Type consistency: `ContinuousPolicy` is defined once in `src/audio/sfx.ts` and consumed
  by `src/pause.ts`, `src/audio/AudioEngine.ts`, and `src/main.ts`.
