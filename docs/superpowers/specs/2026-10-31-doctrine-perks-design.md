# Choice-based research doctrines (#50)

Perks are straight upgrades, so every run buys them in the same order. Doctrines are exclusive pairs: taking one side locks the other out until the next warp, and each side is a bonus plus a cost.

## Decisions

- **Window.** A doctrine may be chosen, swapped or cleared only while `run.time < TUNING.doctrineWindow` (45 sim seconds). That is the opening of a new game and of every system after a warp. After it closes, `chooseDoctrine` is rejected with a log line. The next warp builds a fresh run at time 0, which opens the window again: the player keeps a pair by doing nothing, swaps it, or clears it. With the default "pause while menus are open", the clock stops while Research is open.
- **Cost.** Choosing costs no Horizon Data. The price is the other side. Doctrine picks do not increment the research-level stat.
- **Storage.** `profile.doctrines` is a total map from pair id to a side id or null. It lives on the profile and survives warps. Pair ids (`fleet`, `haul`, `focus`) and side ids (`swarm`, `ace`, `freighter`, `courier`, `survey`, `brawler`) are stable so a later New Game+ (#177) can copy a subset. One slot per pair is the exclusivity: the save validator and the command handler both reject a side that is not one of that pair's two.
- **Effects.** Each side is a list of stat effects in `src/data/doctrines.ts`. `writeShipStats` folds the ship-stat multipliers after the existing perk multipliers (a speed effect also scales acceleration, same as the thrust perk). `fleetCap` adds a fleet effect. Nothing else in the tick special-cases a doctrine.
- **Bot.** While `0 < run.time < doctrineWindow`, the balance bot picks one doctrine pair and leaves the other two null. `seed % 3` chooses the pair (`fleet`, `haul`, `focus`) and seed parity chooses its side (even: the first side, odd: the second). It never clears a pair. The check skips time 0 so a unit test, and the decision that warps, is not also a respec; the new system's next decision falls inside the window.

## Pairs

| Pair | Side | Bonus | Cost |
| --- | --- | --- | --- |
| `fleet` Fleet | `swarm` Swarm Doctrine | +1 fleet capacity | −10% drone damage |
| `fleet` | `ace` Ace Pilot | +25% flagship damage | −8% flagship speed |
| `haul` Hold | `freighter` Bulk Freighter | +25% cargo | −10% speed |
| `haul` | `courier` Courier | +12% speed | −15% cargo |
| `focus` Beam | `survey` Survey Array | +25% pickup radius | −10% laser damage |
| `focus` | `brawler` Brawler | +15% laser damage | −20% pickup radius |

Drone damage applies to the drone role only. Flagship effects apply to the flagship only. The others apply to every ship.

## Save

`SAVE_VERSION` 15. `migrations[14]` sets every pair to null. A frozen `tests/fixtures/save-v15.json` is a seed-4242 hazards-on run stopped about 128s into system 2, once that system had a second ship. Belt trimmed to eight rocks, same shape as `save-v14.json`.

## UI

`ResearchPanel` lists each pair, the picked side, and whether the window is open. Bonus and cost are sentences ("Bonus: … Cost: …"), and the button says Choose, Swap, Chosen, Clear or Locked. Buttons stay in the tab and gamepad order when locked (`aria-disabled`, not `disabled`) so activating one still produces the sim's log line. The panel traps Tab and arrow keys and takes focus when opened.
