# Hazards — run log

- **Date:** 2026-10-19
- **Issue:** #37 — "Hazards: comets, solar flares (later pirates)"
- **Branch:** `feat/hazards`
- **Spec:** [`../specs/2026-10-19-hazards-design.md`](../specs/2026-10-19-hazards-design.md)
- **Plan:** [`2026-10-19-hazards.md`](2026-10-19-hazards.md)

## Setup

Claude Code orchestrated: it wrote the spec and plan, then dispatched one implementer subagent (Sonnet) per task
and a separate read-only reviewer subagent (Opus) that had not written the code. Fix rounds went back to the
original implementer so it kept its context. The orchestrator re-ran `npm run check`, read every diff, smoke-tested
the UI in the browser pane via `window.__amh` (forcing hazard timers low) and committed.

## Deviation from the plan

- **Tasks 2 and 3 were implemented by one session**, because they edit the same functions in the same two files
  (`sim/hazards.ts`, `sim/update.ts`). A single reviewer covered both.
- **Task 5 was done by the orchestrator** directly (two small script edits plus the measurement), with no
  separate review.
- `TickCtx` gained a required `hazards` field so `updateShip` knows the level. This was not in the plan, but it is
  the natural way to carry the level, matching `assists`.

## Sessions

| Task | Implementer rounds | Review rounds | Commit |
| --- | --- | --- | --- |
| 1 Data, state, save v6 | 1 (+2 nits fixed by orchestrator) | 1 | `160008c` |
| 2+3 Comets and flares in the tick | 2 | 1 | `4177a06` |
| 4 Setting, HUD, renderer, audio | 2 | 1 + browser smoke test | `d398e3c` |
| 5 Harness option and measurement | orchestrator | — | `49f6c09` |

## Verification

- After every task: `npm run check` green and the full diff read before committing. The suite grew from 360 to
  391 tests.
- **Off is byte-identical to `main`.** `npm run balance -- --seeds 10 --warps 10` (hazards off by default) produced
  a report identical to the committed `docs/balance.md` except for the commit hash in its header, so
  `docs/balance.md` was not regenerated. `tests/hazards.test.ts` also pins 20 000 off-mode ticks against values
  captured from `main` (`run.rng.s`, `nextId`, rock ids and positions, flagship state).
- **Browser smoke test:** the banner counts down both hazards, the log lines and alarm fire, the comet appears with
  a tail, the flare glow and shake play, and the comet path line renders. The path line only renders after the
  fix described under Task 4 below.

## Measurement with hazards on

`--seeds 10 --warps 10`, seeds 1000–1009. The bot ignores hazards (non-goal), so these numbers are a worst case
for a player who never shelters.

| System | Off median | Normal median | Harsh median |
| --- | --- | --- | --- |
| 1 | 5:07 | 5:07 | 5:07 |
| 2 | 5:47 | 6:08 | 6:33 |
| 3 | 6:26 | 5:59 | 6:08 |
| 4 | 7:43 | 8:45 | 8:45 |
| 5 | 9:50 | 10:57 | 10:05 |
| 6 | 10:08 | 11:54 | 9:52 |
| 7 | 9:55 | 9:16 | 11:44 |
| 8 | 13:08 | 13:25 | 13:24 |
| 9 | 12:16 | 13:57 | 15:14 |
| 10 | 15:33 | 16:30 | 18:04 |

- System 1 is identical at every level, which shows the `hazardMinSystem` grace works.
- The sum of medians is roughly +7% on Normal and +10% on Harsh. No walls at any level. Seeds whose warp took more than twice the previous one: Off 3, Normal 7, Harsh 11.
- The mid-game active-play share is unchanged (59–60%, PASS).
- No tuning was needed. Hazards cost time without breaking pacing.

## Review notes

### Task 1

- **Accepted (nit):** the test helper seeded `newHazards` with the system number. Fixed.
- **Accepted (nit):** a hard-coded `toBe(6)` was replaced with `SAVE_VERSION`. Fixed.
- **Rejected (nit):** the reviewer suggested moving `hazards:` after `populateBelts` in `newRun` for readability.
  It sits in the `Run` literal with the other boards, it draws only its own stream, and the reviewer verified it is
  byte-identical across 24 runs.

### Tasks 2 and 3

- **Accepted (major):** a ship killed by a comet in `collideRocks` could still take flare (or heat) damage, which
  produced a second "destroyed" log line and a second explosion. There is now an early return after `collideRocks`,
  and a test checks that exactly one `explode` fx fires.
- **Accepted (minor):** toggling Off and then back On during a flare restarted a flare at once, because
  `flareTimer` stayed at or below 0. The timer is now rolled when the warning starts, as comets do.
- **Accepted (minor):** the "off ≡ no feature" test compared an absent level with `'off'`, which maps to the same
  thing, so it could not fail. It is now pinned to values captured from `main`.

### Task 4

- **Found in the browser (major):** the comet path line was invisible. Its dash sizes were around 0.01 in a
  unit-length line scaled by 6400, and the fragment shader lacked the precision, so it discarded every fragment.
  The geometry is now built at real length, with dash sizes in world units. **Lesson:** a dashed line's dash sizes
  must be in geometry units, not object-scaled units, and an overlay needs a visual check, not just unit tests.
- **Accepted (minor):** `audio/sfx.ts` imported `data/hazards`, which breaks the layer rules, and duplicated the
  flare-exposure test. This is now one shared `flareExposure(run, ship)` in `sim/hazards.ts`, used by both the tick
  and `alarmLevel`.
- **Accepted:** `hazardBanner` returns early when nothing is pending; the star glow resets on a system rebuild;
  the comet-tail emission is now frame-rate independent; README wrapping fixed; an overclaiming test name fixed.
- **Rejected (nit):** switching to Off while paused leaves the banner and line up until the next tick. This is
  cosmetic and clears on resume, and fixing it would couple the HUD and renderer to settings.
- **Rejected (nit):** the reviewer noted the line pulses rather than fading along its length. The pulse reads
  well, so the spec wording was changed to match.

## Follow-ups

- Drone AI sheltering from flares and dodging comet paths (and teaching the balance bot to do the same).
- Pirates, which need combat components (the deferred part of #37).
