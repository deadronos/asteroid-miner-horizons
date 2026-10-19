# Automation tier run log (#39)

- **Date:** 2026-10-19
- **Issue:** #39 — Automation tier: hauler drones and mining outposts
- **Branch:** `claude/project-thread-4x2h5l` (base `d7128b6`)
- **Spec:** [`2026-10-19-automation-design.md`](../specs/2026-10-19-automation-design.md)
- **Plan:** [`2026-10-19-automation.md`](2026-10-19-automation.md)

## Setup

One session built the six plan tasks in order and reviewed its own diff against the spec's Review Focus list; no
separate implementer or reviewer sessions were used, so the per-task table below records verification rather than
review rounds.

## Verification

- `npm run check` green on the final tree: 35 files, 527 tests; `tsc --noEmit` for `src` and `scripts` clean.
- Determinism: nothing in the feature calls an RNG. `tests/automation.test.ts` pins `run.rng.s` with an outpost
  ticking, and the balance report is byte-identical to the pre-feature baseline for systems 1–4, where the bot has
  not yet bought a hauler.
- Browser smoke test (Vite dev server, headless Chromium through `window.__amh`): deploying an outpost and buying a
  drone and a hauler rendered the outpost ring, the fleet panel's Outposts section and the hauler's Standby status,
  with no console errors.
- `npm run balance -- --seeds 10 --warps 10` regenerated `docs/balance.md`. The mid-game active-play share is
  **61 %** pooled (target ≥ 40 %, baseline 60 %), so automation stays well short of dominant.

## Task table

| Task                                | Verification                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| 1 Data and state                    | typecheck                                                                 |
| 2 Outposts and the deploy command   | Tests: rejections, extraction, capacity, perk, dismantling, RNG, AI    |
| 3 Hauler AI                         | Tests: conservation every tick, threshold, outpost, idle, parked fleet  |
| 4 Save v9                           | Tests over the v2/v5/v7/v8 fixtures and malformed automation            |
| 5 Balance bot and report            | Bot tests; two tuning passes of the 10 × 10 report                      |
| 6 Presentation                      | tooltip test; browser smoke test                                          |

## Deviations from the plan and why

- **Haulers detour round the star (Task 3).** The first outpost test had the hauler fly straight from the far belt
  to the station and burn up in the star. Drones never meet this because they work within 700 units of their
  anchor; haulers cross the whole system, so `haulTo` bends round the heat zone.
- **Outposts are not range-limited (Task 3).** `haulRange` (1800 from the station) first applied to outposts too,
  which left the far side of the outer belt (up to ~3200 away) unserved. The player places outposts, so haulers now
  serve them anywhere; the range only bounds miner skimming.
- **Hazard-aware sources (Task 3).** Haulers originally ignored flares and comet paths when choosing a source,
  which would make them oscillate at a flare's edge. They now skip unsafe sources like drones skip unsafe rocks.
- **Tuning (Task 5).** The first pass (reserve 8×, 0.5/s, store 80) passed the gate but did not pay: late-game
  value per minute fell 4–12 % against the baseline, because a hauler took a drone's slot and an outpost deployed
  mid-system barely recovered its cost before the warp. Two variants were run on all 10 seeds × 10 warps:

  | Variant                                  | Sys 7–10 value / min | Sys 7–10 value delivered | Mid-game active share |
  | ---------------------------------------- | -------------------- | ------------------------ | --------------------- |
  | Baseline (no automation)                 | 671 · 570 · 645 · 731 | 6650 · 7738 · 8942 · 11480 | 60 %               |
  | First pass (8×, 0.5/s, 80)               | 616 · 547 · 597 · 645 | 7211 · 8262 · 8507 · 12093 | 61 %               |
  | **A: 10×, 0.8/s, 100 (adopted)**         | 640 · 586 · 650 · 709 | 7586 · 8353 · 9652 · 13882 | 61 %               |
  | B: A plus skimming only at 50 % holds    | 614 · 587 · 672 · 676 | 7915 · 8431 · 10084 · 13809 | 60 %              |

  A was adopted: value delivered and Horizon Data rise over the baseline from system 7 on, haulers carry 7–10 % of
  late-game income, and the mid-game gate is unchanged. B was no better and slower in system 7.
- **Balance runner.** `npm run balance` failed in this container before any change (its worker threads could not
  load TypeScript through `--import tsx`), so the reports were produced by a throwaway copy of the script that
  plays the seeds sequentially; the script's own header notes the two are identical. The copy was not committed.
