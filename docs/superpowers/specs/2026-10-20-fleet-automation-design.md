# Fleet automation: autorepair and autoupgrade

- **Date:** 2026-10-20
- **Issue:** #140 — "Per-ship autorepair and autoupgrade toggles in the fleet panel"
- **Builds on:** #141 (bought slots), which autoupgrade can purchase
- **Status:** Implemented

## Goal

Once the fleet grows, repairing and upgrading ships one at a time is busywork. Each drone and hauler can look after
itself, spending only money the player has marked as spare.

## Decisions (from the maintainer, in the issue discussion)

- Two per-ship toggles, **REPAIR** and **UPGRADE**, next to ASSIST/AUTO in the fleet panel.
- The repair threshold is set in Menu → Gameplay.
- A **reserve** set by the player protects the bank; automation spends only what's above it. It replaces the
  "only when you have 2× the cost" idea.
- Autoupgrade never replaces a fitted part. Fitting a ship once by hand is how the player picks its build.

## Calls made while implementing

- Both toggles default **off**; the flagship has neither (the `shipAuto` command rejects it with a `warn`).
- **Threshold** choices are 25 / 50 / 75 % (default 50 %). **Reserve** is one number applied to every resource:
  0 / 50 / 100 / 250 / 500 / 1000 (default 100). The player's own purchases ignore it.
- **Repair trip:** below the threshold the drone or hauler brain (after hazard dodging) drops its target and flies
  to the station; while docked and still below the threshold it waits there. Docked repair is full, paid in ore.
- **Repair first:** a ship below the threshold that can't afford its repair above the reserve doesn't upgrade. It
  logs one `warn` per wait (tracked in `SimIndex.repairWait`, transient).
- **Autoupgrade** runs only while the ship is already docked; it never makes a trip. Candidates are: each fitted
  part's next tier, the first empty slot filled from the role's build order, or (with no empty slot) the next slot.
  It takes the affordable candidate with the lowest `walletValue`.
- **Build order:** drones laser → cargo → engine → armor → shield → sensor; haulers cargo → engine → armor →
  shield → sensor → cargo. Fitted parts count toward their place in the list, so a hand-fitted ship fills its gaps.
- **Pace:** at most one step per ship every `TUNING.autoUpgradeInterval` (0.5 s of sim time), so the log stays
  readable. The ready times live in `SimIndex.upgradeReadyAt` (transient). A ready time more than one interval ahead
  is treated as left over from an earlier run, because `run.time` restarts on warp.

## State and save

- `Ship.autoRepair` / `Ship.autoUpgrade`: `SAVE_VERSION` 11 → 12. Migration 11 sets both false on every ship, and
  `fromData` rejects a ship whose flags aren't booleans. New fixture: `tests/fixtures/save-v11.json`.
- The threshold and reserve are settings, not save state. They reach the sim as `TickInput.automation`
  (`FleetAuto`, defaults in `DEFAULT_FLEET_AUTO`), the same way `assists` and `hazards` do.

## Balance

The bot never turns the toggles on, and with both off `serviceDocked` returns before doing any work, so
`docs/balance.md` is unchanged (verified: regenerated report is identical apart from the header). Teaching the bot
to use autoupgrade is future work; when that happens, regenerate the report and recheck the active-play share.

## Code

`src/sim/fleetAuto.ts` (decisions and the docked service), hooks in `pilot.ts` (`droneThink`), `automation.ts`
(`haulerThink`) and `update.ts` (after unload). UI: `FleetPanel.ts` toggles, `SettingsTabs.ts` "Fleet automation"
section. Tests: `tests/fleetAuto.test.ts`, migration tests in `tests/migrations.test.ts`.
