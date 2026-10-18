# Pause-aware continuous audio — Design

**Issue:** #67 (follow-up from #31 / #66) · **Branch:** `fix/pause-audio-gating`

## Problem

`AudioEngine.updateContinuous(state, renderer.view)` is called every frame from
`src/main.ts` regardless of whether the sim is frozen. `state` keeps describing the
last simulated frame, so while the game is paused:

- every ship with `beamOn && beamTargetId != null` keeps a beam hum sounding, and
- a selected ship below 25% hull (or inside the star heat zone) keeps the danger alarm
  chiming every ~1.1 s.

Sim damage is frozen while paused, so the alarm is announcing a state that is not
changing, and the hum plays for a beam that is no longer cutting.

## Decision (product ruling)

Pause reasons are **not** interchangeable. Manual pause and an open menu mean the player
is at the keyboard; an unfocused window means the player is looking elsewhere — exactly
when a danger alarm earns its keep. The chosen policy is:

| Pause kind                            | Beam hums | Danger alarm |
| ------------------------------------- | --------- | ------------ |
| running                               | audible   | audible      |
| manual pause (`P`)                    | silenced  | silenced     |
| menu open (⚙ menu or Research panel)  | silenced  | silenced     |
| window unfocused (`pauseUnfocused`)   | silenced  | **audible**  |

Rationale:

- **Explicit pause is silent.** The hum means "this laser is cutting" and the alarm means
  "the state is changing toward losing the ship". Neither is true while frozen, and the
  issue's acceptance criterion is "no indefinite beeping while the player is in a pause
  menu".
- **Unfocused keeps only the alarm.** A hum is feedback for something you are watching;
  the alarm is a warning for someone who tabbed away. This is the case #67 calls out as
  "exactly when a low-hull alarm is most useful".
- **No new setting.** The distinction is derivable from existing state; a toggle would
  add a fourth combination with no clear player story. (Ruling; cost if wrong: a small
  settings + tests addition.)

The chosen option when the controller asked the author was "Menu silent, alarm-only when
unfocused".

## Design

### One pure rule module for pause

Pause was previously implicit: `main.ts` had a private `pauseReason()` that returned a
banner string and a truthiness check. Audio needs to ask *why* the sim is paused, so the
classification moves into a pure, DOM-free module, `src/pause.ts`:

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

- `pauseKind` keeps the existing precedence (manual → menu → unfocused) and the existing
  settings gates (`pauseInMenus`, `pauseUnfocused`). The banner strings are unchanged, so
  the visible behavior of the banner does not move.
- `pauseAudio` is the table above. It returns `{ hums: true, alarm: true }` when running.

### The audio policy type lives with the audio rules

`src/audio/sfx.ts` already owns the pure rules for the continuous layer (`beamHums`,
`alarmLevel`). It gains:

```ts
/** Which continuous layers may sound this frame. */
export interface ContinuousPolicy {
  hums: boolean;
  alarm: boolean;
}

export const LIVE_CONTINUOUS: ContinuousPolicy = { hums: true, alarm: true };
```

`pause.ts` imports the type from `./audio/sfx` (type-only use of a leaf module, no cycle);
`AudioEngine` imports the type and the constant. `main.ts` is the only place that joins
"why paused" to "what may sound".

### `AudioEngine.updateContinuous` takes the policy

```ts
updateContinuous(state: GameState, view: View, policy: ContinuousPolicy = LIVE_CONTINUOUS): void
```

- `policy.hums === false` → `silenceHums()` (the existing fade-out path) and skip
  `beamHums`.
- `policy.alarm === false` → skip `updateAlarm`. `nextAlarm` is **not** reset, so if the
  alarm was already due when the menu opened, it sounds on the first frame after resume
  instead of being pushed a further 1.1 s into the future. That is the desirable
  "welcome back, you are still on fire" behavior.
- The locked/suspended-context path is unchanged: it silences hums and clears `nextAlarm`.
- The default parameter keeps the method source-compatible; only `main.ts` passes a
  policy.

### `main.ts`

`pauseReason()` is replaced by `pauseKind(...)` fed from the same inputs the old function
read. `hud.setPaused(pauseBanner(kind))` and
`audio.updateContinuous(state, renderer.view, pauseAudio(kind))` use the single computed
`kind`, so the banner and the audio can never disagree about the pause cause.

## Blast radius

- `src/pause.ts` (new), `tests/pause.test.ts` (new).
- `src/audio/sfx.ts` (add `ContinuousPolicy`, `LIVE_CONTINUOUS`).
- `src/audio/AudioEngine.ts` (policy parameter).
- `src/main.ts` (use the new pause module; pass the policy).
- `README.md` audio bullet (documents the behavior; also corrects the stale "reserved
  for when sound arrives", which #66 outgrew).
- `docs/superpowers/{specs,plans}/` + a run log.

Not touched: `src/sim/**`, save format, settings shape, DSP/presets, `beamHums` /
`alarmLevel` rules (their unit tests stay as-is).

## What can go wrong (and where it is caught)

1. **A pause kind maps to the wrong policy.** `pauseAudio` is unit-tested per kind, and
   the browser smoke test reads `audio.hums.size` / `nextAlarm` live for menu and
   unfocused. Owning task: Task 1 (tests) + Task 3 (smoke).
2. **The unfocused case silences the alarm too**, which is the whole point of the issue.
   A dedicated `pauseAudio('unfocused')` assertion pins `alarm: true`. Owning task:
   Task 1.
3. **Resume leaves a stuck hum or a stuck silence.** `silenceHums()` only clears the map
   after fading; the next unpaused frame rebuilds voices through the normal path. Smoke
   test closes the menu and re-checks `hums.size > 0`. Owning task: Task 2 + Task 3.
4. **The banner and the audio disagree** because one path still recomputes the reason.
   Task 2 rewires both call sites to the same `kind` value.
5. **`pauseUnfocused` is off, so losing focus keeps the sim running.** `pauseKind`
   returns null and the policy stays fully live — covered by a "running when gates are
   off" test. Owning task: Task 1.

## Acceptance criteria mapping (issue #67)

- _"Paused behavior is deliberate and consistent between menus and unfocused windows."_
  → the policy table, encoded in `pauseAudio` and its tests.
- _"No indefinite beeping while the player is in a pause menu."_
  → alarm suppressed for `manual` and `menu`; `nextAlarm` not advanced; verified in the
  browser smoke test.
- Decision on a hum while a paused beam is still drawn: **silenced** (hum means cutting).
- Decision on unfocused behavior: **alarm only**.
