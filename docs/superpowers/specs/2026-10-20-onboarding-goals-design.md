# First-steps goals and contextual hints

- **Date:** 2026-10-20
- **Issue:** #171 — "First-run onboarding goals and contextual hints"
- **Status:** Implemented

## Goal

A new player gets a short checklist that walks the core loop up to the first warp, plus a one-line hint for
whatever is blocking them right now. The static help box stays as the controls reference; the checklist covers
the loop and does not repeat key bindings.

## Goals and how each is derived

| Goal                 | Done when                                       |
| -------------------- | ----------------------------------------------- |
| Mine 20 units        | `stats.unitsMined >= 20`                        |
| Dock and unload      | `run.runValue > 0` (or a warp has happened)     |
| Install a component  | `stats.installs > 0` (**new stat**)             |
| Buy a drone          | `stats.drones > 0`                              |
| Complete a contract  | `stats.contracts > 0`                           |
| Warp to a new system | `stats.warps > 0`                               |

- `run.runValue` only grows when cargo is deposited at the station, so it stands in for "unloaded once". The
  checklist only shows before the first warp, so a per-run value is enough.
- **Install cannot be derived.** Slots only show the current fit: a remove, a scrap or a flagship refit would
  erase the evidence, and comparing against hull loadouts misfires on the Excavator. So `installs` is a new
  lifetime stat, bumped by the `install` command and by autoupgrade filling an empty slot. It shows in the Stats
  tab as "Components installed".
- The current goal is the first one not met; goals met out of order stay ticked.

## Visibility and dismissal

- Shown while `!profile.goalsDismissed && stats.warps === 0`. The warp is the last goal, so the checklist
  disappears on completion, and a warp ends onboarding even if a step was skipped.
- The × button sends `{ t: 'dismissGoals' }`, which sets `profile.goalsDismissed`. That is per save, not a
  browser setting, so it survives reloads and travels with an exported save. Dismissing twice is a no-op.
- There is no "show again" control. A dismissed or finished checklist stays gone.

## Hints

`goalHint(state)` returns the first match, or null:

1. The flagship is being rebuilt.
2. The flagship has no mining laser ("dock and install one in the ship panel").
3. The flagship's hold is full and it is not already heading home ("click the station to unload").
4. A mining drone with no order, no target, no beam, a laser and room in its hold is idle. Assist mode suggests
   flying near asteroids or switching to AUTO; auto mode suggests switching to ASSIST.
5. The warp is the current goal and the bank lacks fuel ("refine it from ice in the refinery panel").

Hints show only inside the checklist, so they stop once onboarding is over.

## Save schema

`SAVE_VERSION` 12 → 13, because the stat is required (the issue allows a bump for a new stat). The new
`goalsDismissed` profile flag uses the same bump.

- Migration 12: `stats.installs = 0` (past installs were never counted) and `goalsDismissed = false`.
- `fromData` rejects a profile whose `goalsDismissed` is not a boolean. The existing stat check already rejects a
  missing `installs`.
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
