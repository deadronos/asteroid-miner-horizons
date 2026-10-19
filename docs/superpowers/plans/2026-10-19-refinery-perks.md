# Refinery perks implementation plan (#84)

- **Goal:** two research perks that raise refinery throughput without changing recipe ratios.
- **Architecture:** perk table entries, two helpers and a cycle-based `updateRefinery` in `sim/refining.ts`; save
  v9 → v10; HUD reads the helpers.
- **Spec:** [`2026-10-19-refinery-perks-design.md`](../specs/2026-10-19-refinery-perks-design.md)

## Global Constraints

Pure, deterministic sim; no RNG; a save change bumps `SAVE_VERSION` with a migration and fixture; `npm run check`
green; `docs/balance.md` regenerated, never hand-edited.

## Review Focus

- Units conserved with both perks maxed (Task 1).
- A partial final cycle and time carried across jobs (Task 1).
- A save with a missing perk key rejected rather than producing NaN cycle times (Task 2).

## Task 1: Perks and the refinery tick

**Files:** `src/data/perks.ts`, `src/data/tuning.ts`, `src/sim/refining.ts`, `tests/refining.test.ts`
**Build:** `furnace`, `hopper`; `cycleTime`, `batchesPerCycle`; cycle-based `updateRefinery`; profile-aware HUD
helpers.
**Tests:** furnace speed; hoppers incl. a partial last cycle; carry-over across jobs; conservation; HUD strings.
**Done when:** - [x] tests pass.

## Task 2: Save v10

**Files:** `src/sim/create.ts`, `src/sim/migrations.ts`, `src/sim/save.ts`, `tests/migrations.test.ts`,
`tests/fixtures/save-v9.json`
**Build:** migration 9 → 10; perk-level validation.
**Tests:** fixtures load at level 0; other levels kept; malformed levels rejected.
**Done when:** - [x] tests pass.

## Task 3: HUD, bot, balance

**Files:** `src/ui/panels/RefineryPanel.ts`, `scripts/bot.ts`, `README.md`, `docs/balance.md`
**Build:** live recipe label and progress; bot perk order; README perk list; regenerate the report.
**Done when:** - [x] `npm run check` green and the mid-game active-play gate still passes.
