# Refinery perks: Catalytic Furnace and Bulk Hoppers

- **Date:** 2026-10-19
- **Issue:** #84 — "Refinery perks: faster refining and bigger batches"
- **Status:** Approved design (requested by the maintainer alongside raising `baseFleetCap` to 5)

## Context / problem

The refinery finishes one batch at a time at a fixed rate: alloy 2 s, fuel 0.5 s. Warp fuel grows ×1.3 per warp,
so system 10 needs ~500 fuel, about 2500 ice and over four minutes of refining. With a base fleet of 5 and the
automation tier (#39), the bank fills faster than the refinery converts it, so refining becomes the late-game
bottleneck.

## Design

Two research perks in `data/perks.ts`, bought with Horizon Data:

| Perk              | Id        | Effect per level                                     | Max | Cost (level → +1) |
| ----------------- | --------- | ---------------------------------------------------- | --- | ----------------- |
| Catalytic Furnace | `furnace` | cycle time ÷ (1 + 0.25 × level) (`furnaceSpeedPerLevel`) | 4   | 2 + level         |
| Bulk Hoppers      | `hopper`  | one more batch finished per cycle from the front job | 3   | 3 × (level + 1)   |

- `sim/refining.ts` gains `cycleTime(recipe, profile)` and `batchesPerCycle(profile)`. `updateRefinery` spends its
  time budget on cycles; a finished cycle completes `min(batchesPerCycle, job.count)` batches, so the final cycle of
  a job can be partial. Leftover time still carries into the next job.
- Input → output ratios are unchanged: a cycle only finishes batches that were already paid for at queue time, so
  value in still equals value out. Only throughput rises (up to 2× speed × 4 batches = 8× at max).
- `job.progress` stays in seconds of the current cycle. Buying a furnace level mid-cycle just shortens the
  remaining time.
- HUD: `describeRecipe` and `jobProgress` take the profile, so the refinery panel shows the effective cycle time
  and `×N` batches per cycle, and its progress bar tracks the shorter cycle.
- Save v9 → v10 adds both perk keys at level 0; `fromData` now rejects a profile whose perk levels are not all
  finite numbers, since the refinery, stats and costs read every one.
- The balance bot researches both (furnace after optics, hoppers after the drone bay); `docs/balance.md` is
  regenerated with `baseFleetCap` 5.

## Trade-offs

- **Speed plus batch size rather than parallel queues.** Parallel lines would change how the queue reads in the
  HUD (several jobs progressing at once). Batches per cycle keep one front job and one progress bar.
- **No output bonus.** Doubling output per batch would mint value and break the refinery's conservation rule.
