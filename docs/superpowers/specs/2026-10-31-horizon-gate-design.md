# Horizon Gate and New Game+ (#177)

Prestige had no ending. The Horizon Gate is a target a run can finish. It does not gate the warp.

## Stages

Three stages, in `src/data/gate.ts`. A delivery pays whatever the player can spare toward the current stage. Horizon Data comes from `profile.data`. Resources come from the station bank. Fuel is never a stage cost, and a delivery will not spend fuel that the next warp needs, so funding the gate cannot turn an affordable warp into a failed one. Warping does not look at the gate. A player who never delivers keeps the warp loop they have today.

| Stage | Id | Horizon Data | Resources |
| --- | --- | --- | --- |
| Anchor | `anchor` | 1 | 40 ore, 15 ice |
| Ring | `ring` | 1 | 80 ore, 20 ice, 20 crystal |
| Aperture | `aperture` | 1 | 100 ore, 30 crystal, 15 alloy |

Partial payments persist on `profile.gate` across warps. The stage index advances when its bill is met, and the paid columns reset. The numbers are small enough that the balance bot, which only pays on the tick it warps, can finish stages inside a 10-warp run from resources it would otherwise abandon and Horizon Data that could not buy another perk.

## Completion

The last stage freezes a summary: warps, sim time, asteroids broken, units mined, contracts, units refined, Horizon Data earned, and the doctrine choice (side ids included). `stats.gates` increments. The achievement **Beyond the Horizon** (`gateOpen`) unlocks from that stat at 1. The HUD opens a summary dialog with **New Game+** and **Keep playing**. Dismissing it sends `dismissGate`, which sets `gate.acknowledged`. The summary stays in the research panel until New Game+.

## New Game+

`newGamePlus` is rejected until the gate is open. It then copies a subset and resets the rest of the run:

- **3 perk levels** in total, taken from the highest levels. Ties keep the earlier perk in the perk table (Refined Assays first). A perk is never kept above the level the run had.
- **1 doctrine pair**: the first set pair in `fleet`, `haul`, `focus` order. The stable side id is copied. The other pairs are cleared.
- Warps, Horizon Data (`data` and `dataEarned`), the gate, and every perk and doctrine not in that subset go back to a new profile. The galaxy seed, lifetime stats (including `gates`), achievements and the first-steps dismissal stay. The new run is system 1 on that seed.

## Save

`SAVE_VERSION` 16. `migrations[15]` sets an empty gate and `stats.gates` to 0. The validator rejects a missing gate, a stage outside `0..3`, a paid column above the current bill, a fully paid stage that did not advance, and a summary that is present before the gate is open or missing after it. A frozen `tests/fixtures/save-v16.json` is a seed-4242 hazards-on run with the gate part-paid.

## Bot

On the tick the bank can already warp, the bot delivers and then warps. Perk purchases still happen first. Through system 6 the delivery is resources only (`fundGate` with `data: false`), so it cannot move the mid-game perk timings the balance targets measure. From system 7 on, spare Horizon Data (whatever could not buy a perk) is included. The balance report records the system being left for the first delivery, each stage, and the gate opening.
