# Lifetime stats and achievements

- **Date:** 2026-10-19
- **Issue:** #40 — "Stats & achievements screen"
- **Status:** Approved design (requested by the maintainer)

## Context / problem

Nothing records progress across runs: a warp rebuilds the run, and the profile only keeps warps, Horizon Data
and perk levels. There is no long-term feedback.

## Design

- **Stats** live in `profile.stats`, a `Record<StatKey, number>`, so they survive warps and belong to one save.
  `STAT_KEYS` and the labels are in `data/achievements.ts`:

  | Key           | Bumped where                                   |
  | ------------- | ---------------------------------------------- |
  | `time`        | every tick (sim seconds, so paused time is out) |
  | `rocksBroken` | `destroyRock`                                  |
  | `unitsMined`  | a ship collecting debris (`updatePickups`)     |
  | `warps`       | the `warp` handler                             |
  | `contracts`   | a completed contract (`updateContracts`)       |
  | `refined`     | units a refinery cycle produces                |
  | `outposts`    | the `deployOutpost` handler                    |
  | `drones`      | `buyHull` for a drone or hauler                |
  | `perks`       | `buyPerk` (research levels)                    |
  | `comets`      | a comet spawning (`spawnComet`)                |
  | `shipsLost`   | `damageShip` when a ship is destroyed          |

- **Achievements** are a pure table in `data/achievements.ts`: 21 entries, each a threshold `{ stat, at }` on one
  stat, spread from "break an asteroid" to "play for 5 hours". `profile.achievements` lists the unlocked ids in
  unlock order.
- `sim/achievements.ts` `updateAchievements(state)` runs last in the tick. It unlocks every threshold reached and
  pushes a `major` log line carrying `achievement: id`. It loops by index and allocates only on an unlock.
- **Toast:** `Hud.pushLog` shows any log line with `achievement` as a toast under the hazard banner for 6 s. The
  log line stays, so the unlock is also in the event log at either verbosity.
- **Stats tab:** a new ⚙ → Stats tab lists the stats and every achievement: unlocked ones first, in unlock order,
  then locked ones with progress (`37 / 500`). The `Menu` now takes `getState` for it. Text comes from pure
  helpers (`statRows`, `achievementRows`) so it is tested without a DOM.
- **Save v10 → v11** adds both fields. The migration seeds what the save already implies: `warps` and research
  levels in full, and this run's time, completed contracts, refined units and comets as a lower bound. Nothing
  is unlocked by the migration; the first tick unlocks whatever the seeded stats reach. `fromData` rejects a
  profile whose stats are not all finite or whose achievement list holds an unknown or duplicate id.

## Trade-offs

- **Per save, not global.** The issue puts the stats in the profile, and a profile is one save. A new game
  starts from zero; global stats would need a store outside the save slots.
- **Thresholds only.** Every achievement is one stat reaching a number, so the table stays pure data and the
  check is one loop. Feats like "warp without a drone" would need their own tracking and are left out.
- **No RNG and no behaviour change.** The counters only add; the bot plays identically, so `docs/balance.md` is
  not regenerated.
- **The tab is a snapshot.** It renders when shown, like the other tabs. With "pause while menus are open" off
  the numbers do not tick live until the tab is reopened.
