# Audio Mix Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SFX, music and reverb layers behave as one mix for issue #167: a master limiter before the destination, a distance/zoom lowpass per positional voice, and one shared generated reverb send for explosions, docking chimes and collects.

**Architecture:** `sfx.ts` grows the spatial cutoff rule and carries it on `Voice` and `BeamHum`; a new pure `mix.ts` owns the limiter numbers, the reverb send table and the generated stereo impulse; `AudioEngine` inserts the limiter between master and destination, gives each one-shot a lowpass plus an optional post-filter send into one shared `ConvolverNode`, and keeps the existing voice cap and pause policy untouched.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest, oxlint/oxfmt. No new dependency and no audio files.

**Spec:** `docs/superpowers/specs/2026-10-20-audio-mix-chain-design.md` — read it with this plan; it is the design of record and the authority for every decision below.

## Global Constraints

Copied from the issue and the spec's rulings:

- **Exact mix values, pinned by tests:** `CENTER_CUTOFF = 18000`, `EDGE_CUTOFF = 3200`, `MIN_CUTOFF = 900`; limiter `{ threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 }`; reverb sends `explode: 0.32`, `dock: 0.22`, `collect: 0.12`; impulse `1.8 s`, decay exponent `2.6`; reverb return gain `0.9`; per-voice lowpass `Q = 0.7`.
- **The existing gain and pan rules do not change.** `spatial()[0]` and `[1]` keep their current values; the cutoff is appended as index 2.
- **The cutoff reaches every positional source.** One-shots get it on `Voice.cutoff`; beam hums get it on `BeamHum.cutoff` and use `min(freq * 6, cutoff)` on their existing filter.
- **Only explosions, docking chimes and collects send to the reverb.** Every other `SoundId`, including the alarm and UI sounds, stays dry. The wet return goes through the SFX bus, so the effects slider and mute control it.
- **No feedback path in the reverb.** Each per-voice send gain and lowpass is disconnected when its source ends.
- **The voice cap and pause policy do not change.** `MAX_VOICES = 12`, `MAX_HUMS = 4`, `RateLimiter`, `pauseAudio` and the continuous-layer gating stay as they are.
- **No new dependency, no audio assets, no fetch.** The impulse is generated in memory.
- **No `src/sim/**`, save-format or settings-shape change.** Audio stays outside the tick; `run.rng` is untouched.
- **Keep the full CI gate green:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npx vite build`.
- **Browser verification is mandatory** for the mix graph: Vitest runs in the node environment and has no Web Audio. The evidence goes in the run log.

Before every commit in every task, run `npm run check` and confirm it passes.

## Review Focus

Failure modes the obvious assertions do **not** directly exercise, most-likely-first.

1. **Distant sounds are quieter but still bright** (the cutoff is computed but never carried to `Voice`/`BeamHum`, or `AudioEngine` ignores it). Owning tasks: Task 1 (carry) + Task 3 (apply) + Task 4 (live filter probe).
2. **The cutoff guts near sounds** (a wrong constant or exponent makes the centre dull) or changes gain/pan. Owning task: Task 1 — centre is `CENTER_CUTOFF`, every value is clamped, and the existing gain/pan assertions stay unchanged.
3. **The limiter exists but is not in the signal path**, or its settings differ from `mix.ts`. Owning task: Task 3 (wiring) + Task 4 (live settings and offline peak render).
4. **The reverb never gets an impulse, or a send leaks after its voice ends.** Owning tasks: Task 2 (impulse) + Task 3 (buffer + per-voice disconnect) + Task 4 (live impulse and wet-tail probe).
5. **Every sound is sent to the reverb**, turning UI clicks and alarms to mud, or the wet path bypasses the SFX volume. Owning task: Task 2 (send table) + Task 3 (return into `sfx`).
6. **The voice cap or pause policy regresses.** Owning tasks: Task 1–3 leave them untouched; Task 4 repeats the pause probe and `npm run check` runs the existing tests.

---

## Task 1: Spatial cutoff on voices and beam hums

**Files:**
- Modify: `src/audio/sfx.ts`
- Test: `tests/audio.test.ts`

**Interfaces:**
- Produces in `src/audio/sfx.ts`:
  ```ts
  /** Lowpass cutoff (Hz) at the screen centre: effectively open. */
  export const CENTER_CUTOFF = 18000;
  /** Lowpass cutoff (Hz) at the screen edge and beyond: audibly darker. */
  export const EDGE_CUTOFF = 3200;
  /** Cutoff floor when the camera is zoomed far out. */
  export const MIN_CUTOFF = 900;

  export function spatial(pos: Vec2, view: View): [number, number, number];
  ```
  The third tuple element is the lowpass cutoff. The gain and pan expressions are byte-identical to today.
- `Voice` gains `cutoff: number` (Hz). `BeamHum` gains `cutoff: number` (Hz).
- `voiceFor` sets the cutoff from `spatial()` for positional fx and `CENTER_CUTOFF` for warp/hazard.
- `beamHums` copies the cutoff from `spatial()`.

**Cutoff rule** (inside `spatial`, after the existing `zoom` is computed):
```ts
const cutoff = Math.max(
  MIN_CUTOFF,
  Math.min(CENTER_CUTOFF, CENTER_CUTOFF * (EDGE_CUTOFF / CENTER_CUTOFF) ** Math.min(1, r) * zoom ** 1.5),
);
return [place * zoom, Math.max(-1, Math.min(1, dx)) * PAN_WIDTH, cutoff];
```

- [ ] **Step 1: Write the failing tests** in `tests/audio.test.ts`.

  Add `CENTER_CUTOFF`, `EDGE_CUTOFF` and `MIN_CUTOFF` to the import from `../src/audio/sfx`. Add these tests inside `describe('spatial mixing')`:
  ```ts
  it('dulls sources toward the edge and when zoomed out', () => {
    expect(spatial({ x: 0, z: 0 }, view)[2]).toBe(CENTER_CUTOFF);
    expect(spatial({ x: 800, z: 0 }, view)[2]).toBeCloseTo(EDGE_CUTOFF);
    const mid = spatial({ x: 400, z: 0 }, view)[2];
    expect(mid).toBeLessThan(CENTER_CUTOFF);
    expect(mid).toBeGreaterThan(EDGE_CUTOFF);
    const zoomed = spatial({ x: 0, z: 0 }, { ...view, halfW: 3200, halfH: 1600 })[2];
    expect(zoomed).toBeCloseTo(CENTER_CUTOFF * Math.sqrt(420 / 1600) ** 1.5, 0);
    expect(spatial({ x: 1e9, z: 0 }, { ...view, halfW: 160000, halfH: 80000 })[2]).toBe(MIN_CUTOFF);
  });

  it('carries the cutoff onto positional voices but keeps stings open', () => {
    const streak = new Streak();
    const near = voiceFor({ t: 'crack', pos: { x: 0, z: 0 }, kind: 'ore', radius: 10 }, view, streak, 0)!;
    const far = voiceFor({ t: 'crack', pos: { x: 760, z: 0 }, kind: 'ore', radius: 10 }, view, streak, 0)!;
    expect(near.cutoff).toBe(CENTER_CUTOFF);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(voiceFor({ t: 'warp' }, view, streak, 0)!.cutoff).toBe(CENTER_CUTOFF);
    expect(voiceFor({ t: 'hazard', kind: 'flare', phase: 'warn' }, view, streak, 0)!.cutoff).toBe(CENTER_CUTOFF);
  });
  ```
  Update the exact-object assertions in `describe('hazard sounds')` to include `cutoff: CENTER_CUTOFF`:
  ```ts
  expect(hz(kind, 'warn')).toEqual({ id: 'alarm', gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
  ...
  expect(hz('flare', 'start')).toEqual({ id: 'impact', gain: 0.9, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
  ```
  Add this test inside `describe('beam hums')`:
  ```ts
  it('dulls a beam hum toward the edge too', () => {
    const state = beamState(8);
    const centre = addBeam(state, 'drone', { x: 0, z: 0 });
    const side = addBeam(state, 'drone', { x: -700, z: 0 });
    const hums = beamHums(state.run, state.profile, view);
    expect(hums.find((h) => h.shipId === centre.id)!.cutoff).toBe(CENTER_CUTOFF);
    expect(hums.find((h) => h.shipId === side.id)!.cutoff).toBeLessThan(CENTER_CUTOFF);
  });
  ```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/audio.test.ts`.
  Expected: FAIL — `CENTER_CUTOFF` / `EDGE_CUTOFF` / `MIN_CUTOFF` are not exported, and the new `cutoff` fields are `undefined`.

- [ ] **Step 3: Implement in `src/audio/sfx.ts`.**
  - Add the three constants beside `EDGE_GAIN` / `PAN_WIDTH`, each with the JSDoc above.
  - Change `spatial`'s return type to `[number, number, number]`, compute `cutoff` with the rule above, and extend its JSDoc: "Returns [gain, pan, cutoff]".
  - Add `/** Lowpass cutoff (Hz) for this voice. */ cutoff: number;` to `Voice` and `/** Lowpass cutoff (Hz) for this hum's filter. */ cutoff: number;` to `BeamHum`.
  - In `voiceFor`, return `cutoff: CENTER_CUTOFF` from the non-positional warp/hazard branches; destructure the third value in the positional branch (`const [g, pan, cutoff] = spatial(fx.pos, view);`) and add `cutoff` to every positional return.
  - In `beamHums`, destructure `const [gain, pan, cutoff] = spatial(...)` and push `cutoff` onto the hum.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/audio.test.ts`.
  Expected: PASS, including the unchanged gain/pan tests.

- [ ] **Step 5: Gate and commit.** Run `npm run check`. Commit:
  `Carry a distance/zoom lowpass cutoff on every positional voice (#167)`.

**Done when:** `tests/audio.test.ts` is green, the existing `spatial()[0]`/`[1]` expectations are unchanged, and every `Voice` / `BeamHum` literal in `src/` now supplies a cutoff (the typecheck proves it).

---

## Task 2: Pure mix rules and the generated reverb impulse

**Files:**
- Create: `src/audio/mix.ts`
- Test: create `tests/mix.test.ts`

**Interfaces:**
- Produces in `src/audio/mix.ts`:
  ```ts
  export interface LimiterSettings {
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  }

  export const LIMITER: LimiterSettings;
  export const REVERB_SECONDS = 1.8;
  export const REVERB_DECAY = 2.6;
  export const REVERB_RETURN = 0.9;
  export const REVERB_SEND: Readonly<Partial<Record<SoundId, number>>>;

  export function reverbImpulse(
    sampleRate: number,
    seconds?: number,
    decay?: number,
    rand?: () => number,
  ): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
  ```
  `LIMITER` is frozen `{ threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 }`.
  `REVERB_SEND` is frozen `{ explode: 0.32, dock: 0.22, collect: 0.12 }`; every other id is
  absent (so a lookup yields `undefined`, not a zero entry).
  `reverbImpulse` defaults to `REVERB_SECONDS` / `REVERB_DECAY` / `Math.random`, builds two
  decorrelated channels of `floor(sampleRate * seconds)` samples, and multiplies sample `i`
  by `(1 - i / length) ** decay`.

- [ ] **Step 1: Write the failing tests** in `tests/mix.test.ts`.

  ```ts
  import { describe, expect, it } from 'vitest';
  import {
    LIMITER,
    REVERB_DECAY,
    REVERB_SECONDS,
    REVERB_SEND,
    reverbImpulse,
  } from '../src/audio/mix';

  /** Deterministic LCG so impulse assertions replay exactly. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  describe('limiter settings', () => {
    it('is a hard-knee limiter below full scale', () => {
      expect(LIMITER).toEqual({ threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
    });
  });

  describe('reverb send table', () => {
    it('sends only explosions, docking chimes and collects', () => {
      expect(REVERB_SEND).toEqual({ explode: 0.32, dock: 0.22, collect: 0.12 });
      expect(REVERB_SEND.alarm).toBeUndefined();
      expect(REVERB_SEND.crack).toBeUndefined();
      expect(REVERB_SEND.uiClick).toBeUndefined();
    });
  });

  describe('generated reverb impulse', () => {
    it('is stereo, finite, bounded and decays toward silence', () => {
      const [left, right] = reverbImpulse(8000, 1, REVERB_DECAY, seeded(7));
      expect(left).toHaveLength(8000);
      expect(right).toHaveLength(8000);
      let early = 0;
      let late = 0;
      for (let i = 0; i < left.length; i++) {
        expect(Number.isFinite(left[i]!)).toBe(true);
        expect(Number.isFinite(right[i]!)).toBe(true);
        expect(Math.abs(left[i]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(right[i]!)).toBeLessThanOrEqual(1);
        if (i < left.length / 4) early += Math.abs(left[i]!);
        else if (i > (left.length * 3) / 4) late += Math.abs(left[i]!);
      }
      expect(early).toBeGreaterThan(late * 10);
      expect(left[0]).not.toBe(right[0]);
    });

    it('replays identically for the same injected RNG', () => {
      const a = reverbImpulse(8000, 0.5, REVERB_DECAY, seeded(11));
      const b = reverbImpulse(8000, 0.5, REVERB_DECAY, seeded(11));
      expect(Array.from(a[0])).toEqual(Array.from(b[0]));
      expect(Array.from(a[1])).toEqual(Array.from(b[1]));
    });

    it('uses the 1.8 s default length', () => {
      expect(reverbImpulse(1000)[0]).toHaveLength(Math.floor(1000 * REVERB_SECONDS));
    });
  });
  ```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/mix.test.ts`.
  Expected: FAIL — cannot resolve `../src/audio/mix`.

- [ ] **Step 3: Implement `src/audio/mix.ts`.** Header comment: the mix rules shared by
  the engine (limiter numbers, per-sound reverb send, generated impulse), kept pure so they
  are testable without Web Audio. Import `type { SoundId } from './sfx'` (type-only).
  Use `Object.freeze` for `LIMITER` and `REVERB_SEND`. Implement `reverbImpulse` with two
  `new Float32Array(length)` channels, one `rand()` call per channel per sample, and the
  `(1 - t) ** decay` envelope. Return the tuple typed as
  `[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]`.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/mix.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Gate and commit.** Run `npm run check`. Commit:
  `Add pure limiter, reverb-send and impulse rules for the mix chain (#167)`.

**Done when:** `tests/mix.test.ts` is green and `src/audio/mix.ts` imports nothing but the
`SoundId` type.

---

## Task 3: Wire the limiter, per-voice lowpass and shared reverb into the engine

**Files:**
- Modify: `src/audio/AudioEngine.ts`
- Modify: `README.md` (audio bullet)
- Test: none in Vitest (no Web Audio in node); Task 4 is the verification.

**Interfaces:**
- Consumes from Task 1: `CENTER_CUTOFF`, `Voice.cutoff`, `BeamHum.cutoff`.
- Consumes from Task 2: `LIMITER`, `REVERB_DECAY`, `REVERB_RETURN`, `REVERB_SECONDS`,
  `REVERB_SEND`, `reverbImpulse`.
- Keeps public methods unchanged: `state`, `play`, `ui`, `consumeFx`, `updateContinuous`,
  `updateMusic`, `consumeLog`.

- [ ] **Step 1: Build the master graph in `start()`.**
  Keep the existing `master`, `sfx`, `music` gains and their connections. Add fields
  `private masterLimiter: DynamicsCompressorNode | null = null;` and
  `private reverb: ConvolverNode | null = null;`.
  After the three gains exist:
  ```ts
  const limiter = this.ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  this.masterLimiter = limiter;

  const reverb = this.ctx.createConvolver();
  reverb.buffer = this.impulseBuffer(this.ctx);
  const reverbReturn = this.ctx.createGain();
  reverbReturn.gain.value = REVERB_RETURN;
  reverb.connect(reverbReturn).connect(this.sfx);
  this.reverb = reverb;

  this.sfx.connect(this.master);
  this.music.connect(this.master);
  this.master.connect(limiter).connect(this.ctx.destination);
  ```
  Add the private helper:
  ```ts
  /** Builds the shared stereo reverb impulse once per AudioContext. */
  private impulseBuffer(ctx: AudioContext): AudioBuffer {
    const [left, right] = reverbImpulse(ctx.sampleRate);
    const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
  }
  ```
  Remove the old `this.master.connect(this.ctx.destination)` line.

- [ ] **Step 2: Add the per-voice lowpass and send in `play()`.**
  After the panner is created, create the filter and use the chain
  `src → gain → pan → filter → sfx`:
  ```ts
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = v.cutoff;
  filter.Q.value = 0.7;
  ```
  Then, after `src.connect(gain).connect(pan).connect(filter).connect(sfx);`:
  ```ts
  const send = REVERB_SEND[v.id] ?? 0;
  let wet: GainNode | null = null;
  if (send > 0 && this.reverb) {
    wet = ctx.createGain();
    wet.gain.value = send;
    filter.connect(wet).connect(this.reverb);
  }
  ```
  In the `ended` listener, release the rate limiter and disconnect `src`, `gain`, `pan`,
  `filter` and (`wet?.disconnect()`).

- [ ] **Step 3: Supply `cutoff` at the three hand-built call sites.**
  - `ui(id)` → `this.play({ id, gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });`
  - `updateAlarm` → `this.play({ id: 'alarm', gain: 0.35 + 0.5 * level, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });`
  - `makeHumVoice(ctx, sfx, freq, pan, cutoff)` takes the extra parameter, sets
    `filter.frequency.value = Math.min(freq * 6, cutoff)`, and is called with `hum.cutoff`.
  - In `updateContinuous`, ramp the hum filter with
    `voice.filter.frequency.setTargetAtTime(Math.min(hum.freq * 6, hum.cutoff), now, HUM_ATTACK);`.
  Import `CENTER_CUTOFF` from `./sfx` and the Task 2 values from `./mix`. Update the module
  header comment to mention the master limiter, per-voice lowpass and shared reverb.

- [ ] **Step 4: Update the README audio bullet.** Replace lines 147–154 with a bullet that
  keeps the existing positioning/music/pause text but states: sounds get **quieter and
  darker** with distance or zoom; a **master limiter** stops a busy fleet from clipping;
  explosions, docking chimes and collects share **one generated reverb**, with no audio
  files. Keep it to the same bullet and do not add a setting.

- [ ] **Step 5: Gate and commit.** Run `npm run check` and `npx vite build`. Commit:
  `Wire the limiter, distance lowpass and shared reverb into the mixer (#167)`.

**Done when:** `npm run check` and `npx vite build` pass, no public method signature
changed, and the only new graph nodes are the limiter, convolver, return gain, and the
per-voice filter/send.

---

## Task 4: Browser verification and run log (controller-owned)

**Files:**
- Create: `docs/superpowers/plans/2026-10-20-audio-mix-chain-run-log.md`

- [ ] **Step 1: Full gate.** Run `npm run check` and `npx vite build` on the branch head.

- [ ] **Step 2: Start the dev server and unlock audio in a real browser.** Navigate to
  `http://localhost:5173`, click once, and confirm `__amh.audio.state === 'running'`.

- [ ] **Step 3: Verify the live graph and the audible rules.**
  - `__amh.audio.masterLimiter` is a `DynamicsCompressorNode` whose threshold/knee/ratio/
    attack/release equal `LIMITER`.
  - `__amh.audio.reverb.buffer` exists, has 2 channels and duration ≈ 1.8 s.
  - Tap the convolver with an `AnalyserNode`, play an explosion through
    `__amh.audio.play`, and observe non-zero wet energy after the dry transient.
  - Wrap `audio.ctx.createBiquadFilter` on the instance, play a near and a far crack
    built with `spatial`, and confirm each per-voice filter is `lowpass` with the lower
    cutoff on the far voice.
  - Import `/src/audio/mix.ts` in the page and render a deliberately hot 12-voice mix in
    an `OfflineAudioContext` twice: once with `LIMITER` applied and once without. Report
    both peak amplitudes; the limited render must be ≤ 1.0 and the control must exceed it.
  - Set ships mining and assert `__amh.audio.hums.size <= 4`, then call
    `updateContinuous(..., { hums: false, alarm: false })` and assert `hums.size === 0`
    (pause policy still holds). Confirm no console errors.

- [ ] **Step 4: Write the run log** with the issue/branch/spec/plan links, the exact
  commands and results, every probe value above, the offline-render peaks, and any
  deviation. Commit:
  `Document and verify the audio mix chain in the browser (#167)`.

**Done when:** the run log contains the limiter settings, impulse duration, near/far
filter cutoffs, both offline peaks, the hum cap/pause result, and the full gate is green.

---

## Self-review notes

- **Spec coverage:** limiter (Tasks 2–3 + Task 4 peak), distance/zoom lowpass (Tasks 1,
  3, 4), shared reverb (Tasks 2–4), voice cap and pause policy (Global Constraints + Task
  4), no assets/dependencies (Task 2), README (Task 3).
- **No placeholders:** every constant, signature and table entry is literal above.
- **Type consistency:** `spatial` returns a 3-tuple in Task 1; `Voice.cutoff` and
  `BeamHum.cutoff` are the names Task 3 reads; `LIMITER`, `REVERB_SEND`, `REVERB_SECONDS`,
  `REVERB_DECAY`, `REVERB_RETURN` and `reverbImpulse` are defined once in Task 2 and
  imported by name in Task 3.
- **Proportion:** three small code tasks and one verification task; the tests carry the
  exact values, the plan does not replay the engine's bodies.
