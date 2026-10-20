# First-steps goals and contextual hints

- **Date:** 2026-10-20
- **Issue:** #171 — "First-run onboarding goals and contextual hints"
- **Status:** Implemented

## Goal

A new player gets a short checklist that walks the core loop up to the first warp, plus a one-line hint for
whatever is blocking them right now. The static help box stays as the controls reference; the checklist covers
the loop and does not repeat key bindings.

## Goals and how each is derived

| Goal                 | Done when                                            |
| -------------------- | ---------------------------------------------------- |
| Mine 20 units        | `stats.unitsMined >= 20`                             |
| Dock and unload      | `stats.unloads > 0` (**new**: flagship unloads)      |
| Install a component  | `stats.installs > 0` (**new**: installs by hand)     |
| Buy a drone          | `stats.miningDrones > 0` (**new**: mining drones)    |
| Complete a contract  | `stats.contracts > 0`                                |
| Warp to a new system | `stats.warps > 0`                                    |

Three steps can't be derived from existing state:

- **Unload.** `run.runValue` also grows from drone and hauler deposits and from offline income. So `unloads`
  counts deposits by the flagship only, in `update.ts`'s `unload()`.
- **Install.** Slots only show the current fit: a remove, a scrap or a flagship refit erases the evidence. So
  `installs` counts the `install` command only. Autoupgrade fills don't count, and the Stats tab label is
  "Components installed by hand".
- **Drone.** `stats.drones` counts haulers too, and `run.ships` loses a drone that is destroyed or scrapped. So
  `miningDrones` counts `buyHull` for drone-role hulls (Mining Drone and Harvester).

The current goal is the first one not met; goals met out of order stay ticked.

## Visibility and dismissal

- Shown while `!profile.goalsDismissed && stats.warps === 0`. The warp is the last goal, so the checklist
  disappears on completion, and a warp ends onboarding even if a step was skipped.
- The × button sends `{ t: 'dismissGoals' }`, which sets `profile.goalsDismissed`. That is per save, not a
  browser setting, so it survives reloads and travels with an exported save. Dismissing twice is a no-op.
- There is no "show again" control. A dismissed or finished checklist stays gone.

## Hints

`goalHint(state, env)` returns the first match, or null. `env` carries the player's auto-dock and autorepair
settings, which the HUD reads from Settings; tests use the defaults.

1. The flagship is being rebuilt.
2. The flagship has no mining laser ("dock and install one in the ship panel").
3. The flagship's hold is full and it is not already heading home ("click the station to unload").
4. A mining drone with no order is parked full because auto-dock is off ("order it to dock, or turn on
   auto-dock").
5. A mining drone with no order genuinely has nothing to do. That means no comet or flare is pending (it may be
   dodging), it is not flying home for autorepair, and there is neither debris nor a rock it can mine (dense
   rock needs a tier-2 laser, outpost hosts are off limits) within `droneLeash` of its anchor. The anchor is the
   flagship in assist mode and the station in auto mode. Assist mode suggests flying near asteroids or switching
   to AUTO; auto mode suggests switching to ASSIST. This mirrors the drone brain's own search, so a drone that
   is between rocks, sweeping debris or dodging is not flagged. The drone's per-tick `aiTargetId` is not used.
6. The warp is the current goal and the bank lacks fuel ("refine it from ice in the refinery panel").

Hints show only inside the checklist, so they stop once onboarding is over.

## Save schema

`SAVE_VERSION` 12 → 13, for the three new stats and the `goalsDismissed` profile flag.

- Migration 12 backfills each stat from what the save shows, as a lower bound:
  - `installs`: fitted parts that differ from the starting loadout at the same slot. Flagships compare against
    the Prospector, because a refit carries parts over at their indices. Ships with autoupgrade on are skipped.
  - `miningDrones`: drone-role ships in the fleet.
  - `unloads`: 1 if this run has deposited anything or the save has warped, otherwise 0.
  - `goalsDismissed`: false.
- `fromData` rejects a profile whose `goalsDismissed` is not a boolean. The existing stat check already rejects
  a missing stat.
- New fixture `tests/fixtures/save-v12.json`.

## Code layout

- `src/ui/goals.ts`: pure rules (`GOALS`, `goalDone`, `goalsVisible`, `currentGoal`, `goalProgress`, `goalHint`).
  It lives in `ui/` because only the HUD reads it. It has no DOM, so tests import it directly.
- `src/ui/panels/GoalsPanel.ts`: built once and refreshed in place. It sits top centre, below the pause and
  hazard banner slots. Under 820 px wide only the current goal and the hint show.

## Balance and determinism

Nothing here touches an RNG or changes what the bot does, so `docs/balance.md` stays the same (checked: the
regenerated report differs only in its header). A test runs the bot from a fresh save. It meets all five
pre-warp goals and then warps, using only commands the HUD panels send (no ⚙ menu).
