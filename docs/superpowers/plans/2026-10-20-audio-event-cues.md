# Audio Event Cues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give research purchases, achievement unlocks, contract completions/failures, outpost deployments and ship losses their own short, rate-limited cues for issue #168, keyed on explicit event identities the sim stamps on log lines.

**Architecture:** `LogEntry` gains an optional `event` identity (extending the existing `achievement?` pattern); a pure cue table and a pure `cueBatch(log)` grouping rule live in `sfx.ts`; `AudioEngine.consumeLog` plays one voice per distinct identity in the ~0.1 s log batch through the existing `RateLimiter`. Six new ZzFX presets and three reverb-send rows join the existing tables.

**Tech Stack:** TypeScript, Web Audio API (ZzFX synthesis), Vite, Vitest, oxlint/oxfmt. No new dependency and no audio files.

**Spec:** `docs/superpowers/specs/2026-10-20-audio-event-cues-design.md` — read it with this plan; it is the design of record and the authority for every decision below.

## Global Constraints

Copied from the spec's rulings:

- **Exact cue table, pinned by tests:** gains `research 0.5`, `achievement 0.7`, `contractDone 0.6`, `contractFail 0.45`, `outpost 0.55`, `shipLoss 0.7`; `MIN_GAP` rows `research 0.15`, `achievement 0.5`, `contractDone 0.3`, `contractFail 0.3`, `outpost 0.3`, `loss 0.4`; reverb sends `achievement 0.22`, `contractDone 0.22`, `loss 0.32` (research/outpost/contractFail stay dry).
- **One `SoundId` per cue key**, all six new and distinct (`shipLoss` → `loss`). `cutoff: CENTER_CUTOFF`, `pan: 0`, `rate: 1` on every cue voice.
- **Bursts collapse per identity:** `cueBatch` returns each distinct `CueKey` once per log batch; three ship losses in one tick sound once. Warn-level lines still produce exactly one `uiDeny`.
- **No sim behaviour change.** Only a new optional field on two existing log pushes per site; `run.rng` and `docs/balance.md` must come out unchanged.
- **Warp already sounds** via the existing `out.fx { t: 'warp' }` — no `warpArrive` identity. Contract _acceptance_ stays silent.
- **No save-format, settings or `src/ui/**` change.** `out` is transient; no `SAVE_VERSION` bump, no HUD change (achievement toasts already render).
- **Pause policy untouched.** Continuous-layer gating (`pauseAudio`, `hums`, `alarm`) keeps behaving as today; cues are one-shots.
- **Keep the full CI gate green:** `npm run check` (format:check, lint, typecheck, tests) before every commit; `npx vite build` before the final one.

## Review Focus

Failure modes the obvious assertions do **not** directly exercise, most-likely-first.

1. **The deny buzz regresses** (batch dedupe drops the warn check, or the engine stop playing it). Owning tasks: Task 2 (a batch with a warn line plus cues yields `deny: true`) + Task 3 (`consumeLog` keeps the `ui('uiDeny')` branch).
2. **Achievements stay silent** because a keyer reads `l.event` but achievement lines only carry `achievement`. Owning tasks: Task 2 (batch test with an achievement-only entry) + Task 1 (achievement stamping site left untouched).
3. **Only one of the two destruction branches is stamped** (flagship rebuild line vs drone removal line). Owning task: Task 1 kills both hulls in one test.
4. **A burst stacks into noise** because the engine iterates the raw log instead of `cueBatch`'s distinct keys, or `cueBatch` is not a set. Owning tasks: Task 2 (three-loss batch test) + Task 3 (engine consumes the `cues` array).
5. **A preset is unusable** (clipped, > 2 s, inaudible) or a `MIN_GAP` row is missing so a cue machine-guns. Owning task: Task 2 — the `PRESETS` render loop picks the new ids up automatically; `MIN_GAP` and `CUES` are `Record`-typed so a missing row is a compile error, and one gap test pins the pacing.

---

## Task 1: Stamp explicit event identities in the sim

**Files:**

- Modify: `src/sim/types.ts` (`LogEvent`, `LogEntry.event`)
- Modify: `src/sim/handlers.ts:82-92` (`buyPerk`), `src/sim/handlers.ts:334-352` (`deployOutpost`)
- Modify: `src/sim/contracts.ts:98-119` (complete + failed)
- Modify: `src/sim/ships.ts:141-155` (both destruction branches)
- Test: `tests/commands.test.ts`, `tests/automation.test.ts`, `tests/contracts.test.ts`, `tests/sim.test.ts`

**Interfaces:**

- Produces in `src/sim/types.ts`:
  ```ts
  /** Explicit event identities the audio layer keys on (details stay in `text`). */
  export type LogEvent =
    "research" | "contractDone" | "contractFail" | "outpost" | "shipLoss";
  ```
  plus `/** Explicit event the audio layer cues (see src/audio/sfx.ts). */ event?: LogEvent` on `LogEntry`.
- Consumes nothing new; achievement stamping (`achievements.ts`) is unchanged and stays `achievement`-keyed.

- [ ] **Step 1: Write the failing tests.**
  - `tests/commands.test.ts`, extend `it('buyPerk')`:
    ```ts
    expect(s.out.log.at(-1)).toMatchObject({
      level: "major",
      event: "research",
    });
    ```
  - `tests/automation.test.ts`, extend `it('pays, records an outpost …')`:
    ```ts
    expect(lastLog(s)).toMatchObject({ event: "outpost" });
    ```
  - `tests/contracts.test.ts`:
    - In `it('pays a multi-resource reward from a real roll into the bank')`, right before `updateContracts(state, DT)`, add `state.out.log.length = 0;` and after it:
      ```ts
      expect(state.out.log.at(-1)).toMatchObject({
        level: "major",
        event: "contractDone",
      });
      ```
    - In `it('fails the active contract when its timer runs out …')`, add:
      ```ts
      const failed = state.out.log.find((l) =>
        l.text.includes("Contract failed"),
      )!;
      expect(failed).toMatchObject({ level: "warn", event: "contractFail" });
      ```
  - `tests/sim.test.ts`, new describe (imports `damageShip, makeShip` from `../src/sim/ships`):
    ```ts
    describe("ship loss", () => {
      it("flags a drone removal and a flagship rebuild with the same identity", () => {
        const state = newGame(2);
        const drone = makeShip(state.run, state.profile, "drone", "Drone", {
          x: 200,
          z: 0,
        });
        state.run.ships.push(drone);
        state.out.log.length = 0;

        damageShip(state, drone, 9999);
        expect(state.run.ships).not.toContain(drone);
        expect(state.out.log.at(-1)).toMatchObject({
          level: "major",
          event: "shipLoss",
        });

        const flagshipShip =
          state.run.ships.find((s) => s.hullId === "prospector") ??
          state.run.ships[0]!;
        state.out.log.length = 0;
        damageShip(state, flagshipShip, 9999);
        expect(flagshipShip.respawn).toBeGreaterThan(0);
        expect(state.out.log.at(-1)).toMatchObject({
          level: "major",
          event: "shipLoss",
        });
      });
    });
    ```
    (Use the hull that is actually the flagship on this seed — check `isFlagship` if the first ship is not `prospector`.)

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/commands.test.ts tests/automation.test.ts tests/contracts.test.ts tests/sim.test.ts`
      Expected: FAIL — `event` is undefined on every stamped line.

- [ ] **Step 3: Implement.** Add `LogEvent` and the `event?` field in `types.ts` (next to `achievement?`), then stamp exactly these pushes:
  - `handlers.ts buyPerk`: `out.log.push({ level: 'major', text: ..., event: 'research' });`
  - `handlers.ts deployOutpost`: the `Outpost deployed…` info line gets `event: 'outpost'`.
  - `contracts.ts`: the `Contract complete…` major line gets `event: 'contractDone'`; the `Contract failed…` warn line gets `event: 'contractFail'`.
  - `ships.ts`: both the flagship `destroyed! Cargo lost…` line and the drone `was destroyed.` line get `event: 'shipLoss'`.
    No other log push changes.

- [ ] **Step 4: Run and see them pass.** Same five files as Step 2. Also `npx vitest run tests/achievements.test.ts` — its exact `toEqual` on the unlock entry must still pass (no `event` added there).

- [ ] **Step 5: Gate and commit.** `npm run check`. Commit:
      `Stamp explicit event identities on loss, contract, research and outpost log lines (#168)`.

**Done when:** the five tests above are green, `tests/achievements.test.ts` is untouched-green, and the diff touches only `types.ts`, the four stamp sites and their tests.

---

## Task 2: Pure cue rules — presets, gains, pacing and batch grouping

**Files:**

- Modify: `src/audio/sfx.ts` (six presets, six `MIN_GAP` rows, `CueKey`/`Cue`/`CUES`/`cueBatch`)
- Modify: `src/audio/mix.ts` (three `REVERB_SEND` rows)
- Test: `tests/audio.test.ts`, `tests/mix.test.ts`

**Interfaces:**

- Consumes from Task 1: `LogEvent` on `LogEntry` (type-only import; `sfx.ts` already imports from `../sim/types`).
- Produces in `src/audio/sfx.ts`:
  ```ts
  export type CueKey = LogEvent | "achievement";
  export interface Cue {
    id: SoundId;
    gain: number;
  }
  export const CUES: Readonly<Record<CueKey, Cue>>;
  export function cueBatch(log: readonly LogEntry[]): {
    deny: boolean;
    cues: CueKey[];
  };
  ```
- Consumes nothing new; `SoundId`, `PRESETS`, `MIN_GAP` are extended in place (both `Record`-typed, so every row must exist or the typecheck fails).

- [ ] **Step 1: Write the failing tests.**
  - `tests/mix.test.ts`, update the exact-object send test (name: `sends only the positional milestones and the event chimes`):
    ```ts
    expect(REVERB_SEND).toEqual({
      explode: 0.32,
      dock: 0.22,
      collect: 0.12,
      achievement: 0.22,
      contractDone: 0.22,
      loss: 0.32,
    });
    expect(REVERB_SEND.research).toBeUndefined();
    expect(REVERB_SEND.outpost).toBeUndefined();
    expect(REVERB_SEND.contractFail).toBeUndefined();
    expect(REVERB_SEND.alarm).toBeUndefined();
    expect(REVERB_SEND.uiClick).toBeUndefined();
    ```
  - `tests/audio.test.ts`, new describe (import `CUES`, `cueBatch`, `type CueKey` from `../src/audio/sfx` and `type LogEntry` from `../src/sim/types`):
    ```ts
    describe("event cues", () => {
      const keys = [
        "research",
        "achievement",
        "contractDone",
        "contractFail",
        "outpost",
        "shipLoss",
      ] as CueKey[];

      it("maps every cue key to its own preset at a pinned gain", () => {
        expect(Object.keys(CUES).sort()).toEqual([...keys].sort());
        const ids = keys.map((k) => CUES[k]!.id);
        expect(new Set(ids).size).toBe(keys.length);
        for (const k of keys) {
          expect(CUES[k]!.gain).toBeGreaterThan(0);
          expect(CUES[k]!.gain).toBeLessThanOrEqual(1);
        }
      });

      it("collapses a same-batch burst to one cue per identity", () => {
        expect(
          cueBatch([
            { level: "major", text: "A was destroyed.", event: "shipLoss" },
            { level: "major", text: "B was destroyed.", event: "shipLoss" },
            { level: "major", text: "C was destroyed.", event: "shipLoss" },
          ]),
        ).toEqual({ deny: false, cues: ["shipLoss"] });
      });

      it("keeps the deny flag for warn lines and gathers achievement plus event identities in order", () => {
        expect(
          cueBatch([
            { level: "info", text: "Researched Optics 1.", event: "research" },
            { level: "warn", text: "Not enough resources in the station bank" },
            {
              level: "major",
              text: "Contract complete: …",
              event: "contractDone",
            },
            {
              level: "major",
              text: "Achievement unlocked: …",
              achievement: "firstCrack",
            },
          ]),
        ).toEqual({
          deny: true,
          cues: ["research", "contractDone", "achievement"],
        });
      });

      it("paces repeating cues through MIN_GAP", () => {
        const l = new RateLimiter();
        expect(l.allow("loss", 0)).toBe(true);
        expect(l.allow("loss", 0.2)).toBe(false);
        expect(l.allow("loss", 0.5)).toBe(true);
        expect(l.allow("research", 0.5)).toBe(true);
        expect(l.allow("research", 0.55)).toBe(false);
        expect(l.allow("research", 0.7)).toBe(true);
      });
    });
    ```
  - In the voice-cap test, extend `ids` with the six new sounds:
    ```ts
    const ids: SoundId[] = [
      "crack",
      "collect",
      "dock",
      "impact",
      "explode",
      "warp",
      "uiClick",
      "uiDeny",
      "research",
      "achievement",
      "contractDone",
      "contractFail",
      "outpost",
      "loss",
    ];
    ```
  - The existing `describe('zzfx presets')` loop needs no edit — it covers the new ids from `PRESETS` automatically.

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/audio.test.ts tests/mix.test.ts`
      Expected: FAIL — `CUES`/`cueBatch` are not exported; `REVERB_SEND` misses the new rows.

- [ ] **Step 3: Implement.**
  - Extend `SoundId` with `'research' | 'achievement' | 'contractDone' | 'contractFail' | 'outpost' | 'loss'`.
  - Add the six `PRESETS` rows (ZzFX param order: `[volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter]`):
    ```ts
    // Short rising three-note arpeggio (660 → 880 → 1100) for research buys.
    research: [0.5, 0, 660, 0.01, 0.05, 0.14, 0, 1.4, 0, 0, 220, 0.06, 0.075, 0, 0, 0, 0.09, 0.7],
    // Bright fanfare: two notes up a fourth with an echo tail.
    achievement: [0.7, 0, 880, 0.01, 0.1, 0.42, 0, 1.1, 0, 0, 330, 0.09, 0.16, 0, 0, 0, 0.15, 0.8],
    // Major-key two-note "paid" chime, brighter and faster than the achievement fanfare.
    contractDone: [0.6, 0, 740, 0.01, 0.08, 0.3, 0, 1.2, 0, 0, 370, 0.09, 0.12, 0, 0, 0, 0.12, 0.75],
    // Clean falling minor pair: the opposite of "paid".
    contractFail: [0.45, 0, 440, 0.01, 0.06, 0.32, 0, 1, 0, 0, -110, 0.08],
    // Thud plus a short confirming tone: something placed.
    outpost: [0.55, 0, 130, 0.005, 0.03, 0.22, 0, 1.5, -2, 0, 260, 0.07, 0, 0.35],
    // Low mourning tone layered under the positional explosion.
    loss: [0.7, 0, 90, 0.02, 0.12, 0.55, 0, 1, -1.1, 0, 45, 0.16, 0, 0.12, 0, 0.04],
    ```
    Each with a one-line comment in the local voice. The render-loop test guards length/peaks; ear-tuning of the numbers in a later browser listen is allowed and is recorded in the run log.
  - Add the six `MIN_GAP` rows in spec order (`research 0.15 … loss 0.4`), each with no comment (the record keys are self-documenting like today's rows).
  - Add the cue rules after `RateLimiter`:
    ```ts
    export type CueKey = LogEvent | "achievement";

    /** Which preset and how loud per event identity; placement is always centre. */
    export const CUES: Readonly<Record<CueKey, Cue>> = {
      research: { id: "research", gain: 0.5 },
      achievement: { id: "achievement", gain: 0.7 },
      contractDone: { id: "contractDone", gain: 0.6 },
      contractFail: { id: "contractFail", gain: 0.45 },
      outpost: { id: "outpost", gain: 0.55 },
      shipLoss: { id: "loss", gain: 0.7 },
    };

    /** Warn lines and one cue voice per event identity found in a log batch. */
    export function cueBatch(log: readonly LogEntry[]): {
      deny: boolean;
      cues: CueKey[];
    } {
      const cues = new Set<CueKey>();
      let deny = false;
      for (const l of log) {
        if (l.level === "warn") deny = true;
        if (l.achievement) cues.add("achievement");
        if (l.event) cues.add(l.event);
      }
      return { deny, cues: [...cues] };
    }
    ```
    Import `type LogEntry, type LogEvent` from `../sim/types` alongside the existing type imports.
  - `src/audio/mix.ts`, extend the frozen `REVERB_SEND` with `achievement: 0.22, contractDone: 0.22, loss: 0.32`.

- [ ] **Step 4: Run and see them pass.** `npx vitest run tests/audio.test.ts tests/mix.test.ts`
      Expected: PASS, including the preset render loop over all fifteen ids.

- [ ] **Step 5: Gate and commit.** `npm run check`. Commit:
      `Add pure event-cue table, presets and batch grouping to the audio rules (#168)`.

**Done when:** the audio and mix tests are green; `CUES`/`cueBatch` are the only new exports in `sfx.ts`; no engine code imports them yet.

---

## Task 3: Wire the cue player into the engine

**Files:**

- Modify: `src/audio/AudioEngine.ts` (`consumeLog`, new private `playCue`)
- Modify: `README.md:150-158` (audio bullet)
- Test: none in Vitest (node has no Web Audio); Task 4 is the verification.

**Interfaces:**

- Consumes from Task 2: `CUES`, `cueBatch`, `type CueKey`.
- Keeps the public surface unchanged: `consumeLog(log: readonly LogEntry[])` still takes the raw batch from `main.ts:181`.

- [ ] **Step 1: Rewrite `consumeLog` in `src/audio/AudioEngine.ts`.**
      Replace the body (currently the single `warn` → `uiDeny` line) with:

  ```ts
  /** Rejected commands buzz, and each event identity in the batch gets one cue. Read-only. */
  consumeLog(log: readonly LogEntry[]): void {
    const batch = cueBatch(log);
    if (batch.deny) this.ui('uiDeny');
    for (const key of batch.cues) this.playCue(key);
  }

  /** Plays a cue's preset once at the table gain, dead centre. */
  private playCue(key: CueKey): void {
    const cue = CUES[key];
    this.play({ id: cue.id, gain: cue.gain, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
  }
  ```

  The existing `RateLimiter` (per-id `MIN_GAP`) and `MAX_VOICES` cap inside `play` apply unchanged. Import `CUES`, `cueBatch` and `type CueKey` from `./sfx`.

- [ ] **Step 2: Update the README audio bullet.** In the `_Audio_` settings bullet (lines 150–158), insert one sentence after the reverb sentence, before the music sentence, in the same wrapped prose: research purchases, achievements, contract completions and failures, outpost deployments and ship losses each have their own short cue, and a burst takes a single sound instead of a stack (the fleet-loss tone stays audible no matter where on screen the explosion was). Do not add a setting and do not reflow the whole bullet.

- [ ] **Step 3: Gate and commit.** `npm run check` and `npx vite build`. Commit:
      `Play rate-limited event cues for research, achievements, contracts, outposts and losses (#168)`.

**Done when:** check and build are green; `ui`, `consumeFx`, `updateContinuous`, `updateMusic` bodies are untouched; the only change in `consumeLog` is the `cueBatch` dispatch.

---

## Task 4: Browser verification and run log (controller-owned)

**Files:**

- Create: `docs/superpowers/plans/2026-10-20-audio-event-cues-run-log.md`

- [ ] **Step 1: Full gate.** Run `npm run check` and `npx vite build` on the branch head. Confirm `git diff main --stat` shows no `docs/balance.md` and no save/migration files; the sim's behaviour change is limited to the stamped field (Task 1), so `run.rng` cannot move — record that assertion instead of re-running the bot.

- [ ] **Step 2: Start the dev server and unlock audio.** Navigate to `http://localhost:5173`, start a game, click once, raise the master/effects sliders, and confirm `__amh.audio.state === 'running'`.

- [ ] **Step 3: Verify wiring and audibility.** Vitest cannot run Web Audio, so inject synthetic log batches through the debug hook — `__amh.audio.consumeLog(...)` — which exercises exactly the Task 3 path (the stamp sites are unit-covered by Task 1):
  - A batch of three `shipLoss` entries → one `loss` tone, not three (count voices via `__amh.audio.limiter.voices`).
  - Loss of a second ship within ~0.3 s of the first → silent (rate-limited); after ~0.5 s → audible again.
  - Batches for `research`, `achievement`, `contractDone`, `contractFail`, `outpost` → each plays its own colour and stays clearly distinct from `dock` and `uiDeny`; note anything that grates in the run log.
  - A warn-only batch → the `uiDeny` buzz still sounds exactly as before.
  - Musicianship pass: with the effects slider loud, listen to each of the six; if one reads wrong against the spec's words (e.g. `contractDone` and `achievement` too close), retune those literal ZzFX numbers in `sfx.ts`, re-run the render loop, and record the change in the run log.
  - Pause sanity: open the settings menu, confirm no hum/alarm sounds while paused (the #67 policy surface). A real UI-triggered research cue needs earned Horizon Data; only attempt it if the loaded game already has some, otherwise record the limitation that the injected path was what was audible.

- [ ] **Step 4: Write the run log.** Issue #168, branch, spec and plan links; the exact commands and results; every probe value above; the retune decisions; and any deviation from the plan. Commit:
      `Document and verify the audio event cues in the browser (#168)`.

**Done when:** the run log contains the three-loss single-cue result, the rate-limit readings, the six-listen notes, the deny regression check, the pause sanity note, and the full gate is green.

---

## Self-review notes

- **Spec coverage:** stamping (Task 1), cue table + presets + sends + grouping (Task 2), engine wiring + README (Task 3), browser evidence + run log (Task 4). Warp and contract-acceptance are deliberately absent per the spec's rulings.
- **No placeholders:** gains, `MIN_GAP` rows, sends, preset literals and all test bodies are pinned; the only free choice (`playCue` body) is fully spelled out.
- **Type consistency:** `LogEvent`/`LogEntry.event` (Task 1) are read by `cueBatch` (Task 2) and the engine (Task 3); `CueKey = LogEvent | 'achievement'` matches `CUES`'s six rows; the one key-vs-preset name difference — `shipLoss` is the key, `loss` the preset — agrees across tasks.
- **Review Focus:** deny regression → Task 2/3; achievement keying → Task 2 (+Task 1 leaves it intact); both destruction branches → Task 1; burst stacking → Task 2/3; preset bounds/missing rows → Task 2 (render loop + typed `Record`s).
- **Proportion:** four tasks, two of them mostly decisions pinned by the spec; the tests carry the values, the plan carries no engine transcript.
