# Audio Mix Chain — Run log

**Date:** 2026-10-20 · **Issue:** #167 (child of #154) · **Branch:** `feat/audio-mix-chain`

**Spec:** [`../specs/2026-10-20-audio-mix-chain-design.md`](../specs/2026-10-20-audio-mix-chain-design.md)
**Plan:** [`2026-10-20-audio-mix-chain.md`](2026-10-20-audio-mix-chain.md)

## Setup

- Native OpenCode worktree at `/Users/openclaw/.local/share/opencode/worktree/ee4e41/audio-mix-chain`,
  branch `feat/audio-mix-chain` from `main` at `023b890`.
- `npm install` reused the local cache (56 packages). Baseline `npm test`: 56 files / 839 tests green.
- Spec committed as `a2bf3a7`; plan committed as `744761f`.

## Per-task summary

| Task | Commit | Implementer | Review | Result |
| --- | --- | --- | --- | --- |
| 1. Spatial cutoff | `bd678f4` | DeepSeek Flash | DeepSeek V4 Pro | Approved clean |
| 2. Pure mix rules | `b6ef677` | DeepSeek Flash | DeepSeek V4 Pro | Approved clean |
| 3. Engine wiring | `30c9d4c` | DeepSeek V4 Pro | DeepSeek V4 Pro | Approved clean |
| 4. Verification + run log | this commit | Controller | Final whole-branch review | — |

Each task ran its own TDD cycle (Tasks 1-2), then the full `npm run check`; Task 3 added
`npx vite build`. The controller generated a review package per task and dispatched a
fresh reviewer that did not write the code. No task needed a fix round.

### Review findings

| Task | Finding | Decision |
| --- | --- | --- |
| 1 | `spatial` JSDoc prose only describes gain/pan; the tail names the 3-tuple. | Accepted as a minor; no code change. The type and the return annotation are explicit. |
| 1 | Brief's file list omitted `AudioEngine.ts`, which needed `cutoff` on two `Voice` literals. | Accepted; the required-field typecheck forced the change, and it is exactly the two non-positional literals Task 3 would otherwise touch. |
| 2 | `reverbImpulse` does not guard non-positive `sampleRate`/`seconds`. | Rejected as unreachable: the only caller passes `AudioContext.sampleRate` and the module's default length. A guard would be untested defensive code. |
| 3 | `masterLimiter` is assigned but only read by the runtime probe; the `this.reverb` null check is redundant. | Accepted as minors. The field is the handle Task 4 uses for runtime evidence; the null check matches the plan's defensive shape. |

## Verification

### Gate

| Command | Result |
| --- | --- |
| `npm run check` | 57 files / 847 tests passed; format, lint and both typechecks clean |
| `npx vite build` | 108 modules; `dist/assets/index-B4Mh7T9D.js` 780.68 kB (216.21 kB gzip) |

### Browser probes (Vite dev server, Playwright/Chromium, audio unlocked)

The page was loaded at `http://localhost:5173`, clicked once, and `__amh.audio.state`
reported `running`. Only console error was the pre-existing `favicon.ico` 404.

| Probe | Observation |
| --- | --- |
| Master limiter node | `DynamicsCompressorNode`, threshold `-6`, knee `0`, ratio `20`, attack `0.003`, release `0.25` |
| Reverb buffer | 2 channels, duration `1.8 s`, sample rate `48000` |
| Signal reaches the limiter | Explosion tap: master RMS `0.0434`, limiter RMS `0.0642` (both non-zero) |
| Per-voice lowpass | Two `play()` calls with cutoff `18000` and `3200` created `lowpass`, Q `0.7`, frequencies `18000` and `3200` |
| Reverb send | Convolver-output RMS before an explosion `0`; 300 ms after `0.0168`; after the 1.8 s tail `0.000119`; a dry-only crack then measured `0.000041` |
| Pause policy | Direct `updateContinuous` probes: live `1` hum, `{hums:false}` `0`, live again `1`; `MAX_HUMS` still `4` |
| Voice cap | `RateLimiter` untouched; existing `tests/audio.test.ts` cap test still passes |

### Limiter peak render

An `OfflineAudioContext` rendered 12 looping full-scale noise voices at gain `1.5`, with
and without `LIMITER` applied, measuring peak and RMS after the first second:

| Render | Control peak | Limited peak | Limited RMS |
| --- | --- | --- | --- |
| Engine path (`sfx` bus trim `0.35`, master `1.0`) | `6.300` | **`0.936`** | `0.526` |
| Raw 12 voices straight into master (`1.0`) | `17.999` | `1.009` | `0.563` |

**Ruling:** the issue's acceptance signal is the game's own path — a full fleet, alarm and
music, where the SFX bus trims voices by `0.35` before the master gain. That render peaks
at `0.936`, under full scale, while the uncompressed control peaks at `6.300`. A synthetic
bed three times hotter than that path still shows a `0.009` (≈0.08 dB) overshoot because
`DynamicsCompressorNode` has a 3 ms attack and no lookahead; that signal cannot be built
through the engine's bus gains (the voice cap and SFX trim bound it), so it was recorded
rather than tuned away. Cost if wrong: a pathological, perfectly aligned transient at
maximum volume could clip by under 0.1 dB.

## Deviations from the plan

1. **Task 1 also touched `src/audio/AudioEngine.ts`.** Making `Voice.cutoff` required meant
   the two hand-built non-positional literals (`ui`, `updateAlarm`) needed
   `cutoff: CENTER_CUTOFF`. The typecheck caught it; the reviewer agreed it was necessary.
2. **Task 4's peak render uses the engine's SFX bus gain.** The plan's literal "12-voice
   mix" was rendered raw first; the `1.009` peak exposed compressor attack overshoot on a
   path 3× hotter than the engine's. The engine-path render is the acceptance measurement;
   both numbers are reported above.

## Acceptance criteria (issue #167)

- **A full fleet mining + alarm + music does not clip.** Master limiter wired
  (`master → limiter → destination`); engine-path peak `0.936` vs `6.300` uncompressed.
- **Distant cracks are audibly darker.** `spatial` cutoff `18000` at centre → `3200` at
  the edge → `900` floor zoomed out; every positional `Voice`/`BeamHum` carries it and the
  live per-voice filter applied both `18000` and `3200` correctly.
- **The voice cap and pause policy still hold.** `MAX_VOICES = 12`, `MAX_HUMS = 4`,
  `RateLimiter` and `pauseAudio` untouched; browser pause probe live `1` → paused `0` →
  resumed `1`.
