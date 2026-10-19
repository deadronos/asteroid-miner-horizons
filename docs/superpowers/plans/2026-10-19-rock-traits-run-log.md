# Rock traits run log (#48)

- **Date:** 2026-10-19
- **Issue:** #48 — Rock traits: volatile, dense, magnetic
- **Branch:** `feat/rock-traits` (base `ed29fd3`)
- **Spec:** [`2026-10-19-rock-traits-design.md`](../specs/2026-10-19-rock-traits-design.md)
- **Plan:** [`2026-10-19-rock-traits.md`](2026-10-19-rock-traits.md)

## Setup

An orchestrated subagent-driven build: one implementer subagent per plan task, a separate reviewer
subagent per task against the task's diff, and the orchestrator (this session) owning the plan,
commits and rulings. Spec and plan written and committed first; then eight tasks, then a
whole-branch review and one fix wave. Everything ran on the `feat/rock-traits` branch in the main
worktree; no worktree was created because the task sequence is strictly sequential and the branch
already isolates it from `main`.

## Verification

- `npm run check` green after every task and after the fix wave: 29 files, 437 tests; `tsc --noEmit`
  for both `src` and `scripts` clean.
- `npm run balance` regenerated `docs/balance.md` (Task 8): systems 1–3 within 1.05/0.94/1.01× of the
  pre-feature baseline, no wall through warp 10; the late game (systems 8–10) is ~1.19× slower but
  efficiency-neutral (value median 1.13×). No tuning change was needed.
- Determinism held: `rollTrait` is a stateless `hash01` of `(seed, system, id)` and draws nothing
  from `run.rng`; `tests/hazards.test.ts` and `tests/traits.test.ts` pin `run.rng.s`, `nextId` and
  the rock layout. `tests/alloc.test.ts` stays green (magnetic drift is allocation-free).

## Task table

| Task | Commits | Implementer rounds | Reviewer |
| --- | --- | --- | --- |
| 1 Trait data, tuning, rolling | `f7b09b5` (+ doc `8ad31bf`) | 1 | Approved, 3 minor |
| 2 Dense gate (`laserTier`, `canMine`, rejection, AI skip) | `6fe7719`, fix `f1c46d2` | 1 + 1 fix | Needs fixes → clean |
| 3 Trait yield multipliers | `5f32dad` | 1 | Approved, 1 minor |
| 4 Volatile blast and stand-off | `00a7462` | 1 | Approved, 3 minor |
| 5 Magnetic drift | `408c268` (+ spec `a37f103`) | 1 + 1 ruling | Approved, 2 minor |
| 6 Save v6 → v7 | `d54d59e` | 1 | Approved, 1 minor |
| 7 Tooltip and 3D telegraph | `d7adc97` | 1 | Approved, 2 minor |
| 8 Balance run | `af8e338` | 1 | Approved, 3 minor |
| Final whole-branch review + fix wave | `f03c2f5` | 1 | All 8 addressed, no new breakage |

## Deviation from the plan and why

- **Task 2 (accepted, beyond the brief).** The implementer also filtered `chainTarget`'s
  nearest-rock fallback with `canMine`; without it the balance bot stalled on an uncuttable dense
  rock. In scope for the "drones must not target rocks `canMine` rejects" constraint.
- **Task 5 (ruling).** The implementer's first pass lowered `tests/autopilot.test.ts` from `N-1` to
  `N-4` because magnetic drift cost the autopilot ~12 % docking reliability. Rejected: a trait
  specified as a gentle nudge must not be absorbed by weakening an invariant test. The pull was
  gentled instead (`magnetTraitRange` 300 → 180, `magnetTraitAccel` 10 → 6), docking returned to
  23/24 at the original `N-1` threshold, and the spec's values were updated.
- **Task 6 (accepted).** The pre-existing `loads a malformed upgradable save as unusable` test was
  pinned from `SAVE_VERSION - 1` to a literal `version: 3`, because the newest migration step (v6 →
  v7) is a documented no-op and can no longer throw. The reviewer confirmed the intent and
  assertion strength are preserved.
- **Task 8 (accepted).** No tuning: the brief's trigger was "a new wall or a system-1..3 regression",
  and neither occurred. The late-game stretch is attributed to the volatile blast mechanic, which is
  part of the designed trait.

## Reviewer findings accepted

- Task 2: `droneThink` adopted a dense `aiTargetId` / flagship mine order without a `canMine`
  re-check — a reachable permanent stall. Fixed (`f1c46d2`) with two new pilot tests.
- Final: harden `isTrait` against a `null` rock element (a hand-edited save could throw out of
  `parseImport`); `TRAIT_IDS` readonly; interpolate `TUNING.denseMinLaserTier` into the rejection
  text; hoist `shipStats` out of the bot's rock loop; add a dead-ship volatile case, the exact blast
  damage and a traitless-fragment assertion; assert the shader emits `vTrait = aTrait;`; refresh the
  plan's magnetic values; make the ship loop robust to more than one removal per tick. All fixed
  (`f03c2f5`) and verified.

## Reviewer findings rejected or deferred

- **Task 7: the volatile accent is a steady whole-rock tint, not the spec's "pulsing hot rim".**
  Deferred as a conscious simplification: the acceptance criterion ("visual cues per trait") is met,
  and a pulsing rim is a shader-only polish with no headless test. Follow-up if the scene wants it.
- **`TRAIT_INDEX` values and the fragment thresholds (0.5/1.5/2.5) are coupled by comment only.**
  Parked: the trait set is frozen for this issue; a shared constant is a follow-up.
- **The `volatileBlastDamage × (radius / 40)` literal.** Parked: it matches the spec's code exactly.
- **The Task 8 report's ablation table is not reproducible from the diff.** Parked: process note.
- Several test-strength minors (vacuous on-ship NaN test, stand-off single-branch coverage, loose
  balance-report labelling) were logged and left; none change behaviour.

## What landed

13 commits: the spec and plan, eight task commits (Tasks 1–8), one mid-implementation ruling, one
plan/spec consistency fix, and the final-review polish. 32 files changed, +1934 / −159, including a
new `src/data/traits.ts`, `src/sim/traits.ts`, `src/ui/rockTooltip.ts`, a `tests/fixtures/save-v6.json`
fixture and a regenerated `docs/balance.md`.
