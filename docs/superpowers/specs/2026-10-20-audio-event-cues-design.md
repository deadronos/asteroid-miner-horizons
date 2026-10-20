# Audio event cues — Design

**Issue:** #168 (child of umbrella #154) · **Branch:** `feat/audio-event-cues`

## Problem

`AudioEngine.consumeLog` only reacts to warn-level lines (`uiDeny`), so several meaningful
moments are silent or wrongly cued:

- buying research, completing or failing a contract, deploying an outpost and losing a
  drone — each relies on the log text alone (drone losses get the positional explosion,
  but no distinct "you just lost a ship" cue);
- achievements carry an explicit identity (`LogEntry.achievement?`) but no sound;
- not everything that _is_ cued sounds right: `uiDeny` fires for any warn line, including
  system warnings, and identical major lines (e.g. several drones dying in one flare) would
  stack into a wall of sound if naively cued.

The issue asks for **explicit event identities** rather than string-matching the log text,
plus one short cue each, rate-limited so rapid bursts collapse into single sounds.

## Decisions

### Event identities live on the log entry (not a queue)

`LogEntry` already carries optional identities the HUD layers read (`achievement?`,
`toast?`). We extend that pattern:

```ts
/** Explicit event identities the audio layer keys on (details stay in `text`). */
export type LogEvent =
  "research" | "contractDone" | "contractFail" | "outpost" | "shipLoss";

export interface LogEntry {
  level: "info" | "warn" | "major";
  text: string;
  achievement?: AchievementId;
  toast?: { kicker: string; title: string; detail: string };
  event?: LogEvent;
}
```

- A secondary `Outbox.events[]` queue was considered and rejected: it adds a new outbox
  surface, drain accounting and wiring for zero audible difference.
- Identities are coarse (no payload). The log text already tells the player _which_ drone,
  _which_ contract; the cue means "this class of thing happened".
- Stamping sites (one field added per existing log push, no behavioural change to the
  sim): research (`handlers.buyPerk`), contract complete and failed (`contracts.updateContracts`),
  outpost deployed (`handlers.deployOutpost`), both flagship and drone destruction
  (`ships.destroyShip` line pair). Achievements keep their existing `achievement?`
  field — the audio layer reads that instead of a new stamp.

### Warp stays on the existing `warp` fx

`handlers.warp` already pushes `out.fx { t: 'warp' }`, which `voiceFor` maps to the
`warp` whoosh. Approval call: that is the arrival/transition cue; no `warpArrive`
identity is added and the two are not stacked. Contract _acceptance_ stays silent too
(the issue does not list it; uiClick already covers the button press).

### One pure cue table in `sfx.ts`

The pure mapping (testable without Web Audio) — each key gets its **own** `SoundId`,
all non-positional (`pan: 0`, `rate: 1`, `cutoff: CENTER_CUTOFF`):

```ts
export type CueKey = LogEvent | "achievement";

export interface Cue {
  id: SoundId;
  gain: number;
}

export function cueBatch(log: readonly LogEntry[]): {
  deny: boolean;
  cues: CueKey[];
};
```

`cueBatch` is the whole grouping rule: it returns whether any warn-level line exists
(→ one `uiDeny`, as today) and the **distinct** `CueKey`s in the batch (a set; a burst in
the same ~0.1 s log window collapses to one cue per identity). The engine then
plays one voice per key through the existing `RateLimiter` and voice-counted `MAX_VOICES`.

| CueKey         | preset         | gain | MIN_GAP (s) | reverb send | Sound in words                                   |
| -------------- | -------------- | ---- | ----------- | ----------- | ------------------------------------------------ |
| `research`     | `research`     | 0.5  | 0.15        | 0           | short rising arpeggio, three notes, perky        |
| `achievement`  | `achievement`  | 0.7  | 0.5         | 0.22        | bright fanfare, longer tail                      |
| `contractDone` | `contractDone` | 0.6  | 0.3         | 0.22        | major-key two-note "paid" chime                  |
| `contractFail` | `contractFail` | 0.45 | 0.3         | 0           | falling minor pair, the opposite of "paid"       |
| `outpost`      | `outpost`      | 0.55 | 0.3         | 0           | solid thud + short confirming tone: placed       |
| `shipLoss`     | `loss`         | 0.7  | 0.4         | 0.32        | low non-positional loss tone under the explosion |

- Six new `SoundId`s, six new ZzFX presets (randomness 0, like all others), six new
  `MIN_GAP` rows. Distinctness of ids is a spec requirement so the HUD `PRESETS` render
  loop and the limiter's per-id spacing apply per class of event independently —
  e.g. a contract completing 0.1 s after research does not eat either cue.
- `shipLoss` plays _on top of_ the already-positional explosions: it is the layer the
  player hears regardless of where the doomed fleet was on screen. The `MIN_GAP` of 0.4 s
  plus `cueBatch`'s set semantics mean a flare wiping three drones in one tick plays one
  loss tone, not three.
- Reverb sends join the existing table (`REVERB_SEND` in `mix.ts`): milestone chimes
  share `dock`'s 0.22 room; the loss tone shares `explode`'s 0.32. The functional short
  tones (research, outpost, contractFail) stay dry.
- TypeScript safety: `ui('uiClick' | 'uiDeny')` keeps its narrow parameter; cue voices
  go through a new `playCue(CueKey)` private in the engine that builds the `Voice`, so a
  cue id cannot be passed to `ui()` or appear at a positional call site.
- `consumeLog` becomes: `cueBatch(log)` → throttle `uiDeny` and each cue through the
  existing `allow()` path (one `Voice` per cue, gains from the table; reverb sends apply
  automatically via `REVERB_SEND` keyed on the preset id). Nothing else in the engine moves.

### Pause policy

Untouched and unaffected. The policy table gates **continuous** layers (`hums`, `alarm`),
which still route through `pauseAudio(paused)` exactly as today. These new cues are
one-shots triggered by sim ticks, so they cannot arrive while the sim is frozen —
except research purchases, which run through `applyCommands` while a menu is open; those
play like `uiClick` (a deliberate act while the player is at the keyboard). A hidden tab
stays fully silent via the existing `ctx.state !== 'running'` guard in `play`.

## What can go wrong (and where it is caught)

1. **An event identity is stamped but has no cue, or two keys share a sound.**
   `sfx.ts` types `CueKey` so the table is `Record<CueKey, Cue>` — a missing or duplicated
   `id` is a compile error plus a dedicated test (`new Set(...).size === 6`).
2. **A fleet wipe stacks into noise.** `cueBatch` set semantics (unit test: three loss
   lines in one batch → one cue) and `MIN_GAP.loss` across batches.
3. **The deny buzz regresses** (e.g. batch dedupe accidentally drops the warn check).
   `cueBatch.deny` is pinned by tests; the engine change is mechanical.
4. **Presets clip, run forever or are silent.** The existing `PRESETS` render loop test
   picks the six new ones up automatically — no new code path to forget.
5. **Balance drift.** No sim state or RNG is touched; only log-entry fields. The run log
   asserts `run.rng.s` and `docs/balance.md` are unchanged rather than re-running the bot.
6. **TypeScript similarity to `ui()`** — `ui('uiClick' | 'uiDeny')` keeps its narrow
   parameter; inline cues go through a new `playCue(CueKey)` private that builds a
   `Voice`, so a cue id cannot leak into UI call sites.

## Blast radius

- `src/sim/types.ts`: `LogEvent`, `LogEntry.event?`.
- `src/sim/handlers.ts`, `src/sim/contracts.ts`, `src/sim/ships.ts`: stamp the new field
  (achievements already stamp theirs).
- `src/audio/sfx.ts`: six presets, `MIN_GAP` rows, `CueKey`/`Cue`/`cueBatch`.
- `src/audio/mix.ts`: three `REVERB_SEND` rows.
- `src/audio/AudioEngine.ts`: `consumeLog` uses `cueBatch`; `playCue`.
- `tests/audio.test.ts`: preset renders ride the loop; new `describe('event cues')` for
  mapping/distinctness/grouping/deny.
- `README.md` audio bullet (list of silent-until-now events now covered).

Not touched: `src/ui/**` (HUD already renders achievement toasts), save format
(`out` is transient — no `SAVE_VERSION` bump), pause policy, `MusicPlayer`, the bot and
`docs/balance.md`, `RateLimiter`/`MAX_VOICES` mechanics, existing sound presets.

## Acceptance criteria mapping (issue #168)

- _"Each listed event has a distinct, rate-limited cue."_
  → the cue table (one `SoundId` per key, `MIN_GAP` per row), Task-2 tests for
  distinctness and spacing; warp and achievements included (warp via the existing fx).
- _"Group rapid events so a fleet loss does not stack into noise."_
  → `cueBatch` set semantics + `MIN_GAP`; Task-2 test with a three-drone same-tick wipe.
- _"Pause policy still suppresses the appropriate layers."_
  → continuous-layer code untouched; one-shot cues are tick-driven (`applyCommands`
  exceptions documented above); Task-3 keeps the `#67` pause smoke green.
- _"`tests/audio.test.ts` covers any new pure mapping."_
  → `cueBatch` and the cue table are pure and tested there.
