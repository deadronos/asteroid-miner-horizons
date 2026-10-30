# Fleet command depth: construction drones, smarter miners, a status line

- **Date:** 2026-10-30
- **Issue:** #174 — "Fleet command depth: roles, priorities and an idle reason"
- **Builds on:** #39 (outposts and haulers), #140 (per-ship autorepair/autoupgrade and the bank reserve), #206/#207
  (fleet and automation tuning), #208 (hazard damage in the balance report)
- **Status:** Approved for planning

## Why

The drone AI is capable but opaque, and the fleet has no decisions in it beyond "buy more". Outposts only appear
when the player flies the flagship to a large rock and deploys one by hand, so automation stops at the point where
it would get interesting. The player can't tell what a ship is doing or why it is sitting still without watching it.

The owner's direction: give the fleet a real composition choice, make the existing miners smarter rather than
adding knobs, and say in one line what each ship is doing.

## Goals

1. **A construction drone.** A new ship that finds suitable large asteroids and builds outposts on its own, paid
   from the bank within the player's reserve. It takes a fleet slot like any other ship, so the choice is how to
   split the cap: miners for income now, builders for outposts and hauler income later.
2. **Resource-aware mining.** Drones and harvesters weigh what the bank is short of when picking a rock, so the
   bank balances itself over time. No per-ship mining priorities.
3. **Better hazard sense, mostly collisions.** #208 shows about 75% of hull damage comes from bumping into rocks.
   Improve autopilot flying around rocks; comet and flare reflexes are already in place and are a smaller lever.
4. **A one-line status per ship in the fleet list**: what it is doing and what it is targeting, including why it
   is idle.

## Non-goals

- Per-ship mining priorities (ore/ice/crystal toggles). Rejected by the owner in favour of goal 2.
- "Hold position" and "stay near flagship" orders. The existing ASSIST/AUTO modes cover "stay near flagship".
- Speech bubbles or labels over ships in the game view. The owner judged them too noisy; the status lives in the
  fleet list only.
- Combat, escorts or any new hazard types (#175).

## Anti-goals

- **A builder that drains the bank.** Construction drones never spend below the reserve.
- **Miners that cross the system for one ice rock.** Scarcity weighting must not beat distance by so much that
  drones spend their time flying instead of mining.
- **Hazard changes that cost more income than they save.** Fewer collisions that come from creeping around belts
  at half speed are a regression.
- **A status line that lies or flickers.** It should change when the ship's intent changes, not every tick.

## Decided by the owner

- Construction drone is a distinct ship type that builds outposts autonomously; how many to field is the
  player's choice against the fleet cap.
- It builds automatically by default, with a toggle so manual placement stays an option.
- Its spending is limited by its own builder reserve, separate from the autoupgrade reserve.
- Mining stays automatic; drones and harvesters take bank scarcity into account instead of player priorities.
- Hazard handling should improve, at least in the AI.
- The status line appears in the fleet list, not over ships in the game view.

## Design

### 1. Construction drone

**Hull.** A new `HullId`, `constructionDrone` (display name "Construction Drone"), with a new role `builder` added
to `HullDef.role`. *Call made in this design:* not `constructor`, which collides with `Object.prototype.constructor`
on plain-object lookups like `HULLS[id]`. It counts toward the fleet cap through the same `droneCount`/`fleetCap`
check drones and haulers use, and toward the #207 fleet-utilisation row. It does not count in the
`miningDrones` stat or as a mining drone in the goals panel. It is bought from the fleet panel like the other hulls.

- Stats, cost and starting loadout are the builder's call, tuned with the balance report. Starting point: drone-like
  speed, modest hull, no laser in the starting loadout, and a cargo hold between a drone's and a hauler's, since it
  hauls when it has nothing to build. It should cost a little more than a mining
  drone and include some alloy, so it arrives after the first drones, not instead of them.
- It gets a build order for autoupgrade in `BUILD_ORDER`, whose key type widens from `'drone' | 'hauler'` to include
  `builder` (for example engine → armor → shield → sensor → cargo).

**Brain.** A new `builderThink`, run where `droneThink` and the hauler brain run, in the same order of reflexes:
hazard dodging and blast back-off first, then the #140 repair trip, then building.

1. If its BUILD toggle is on and an outpost can be built, pick a target: the nearest large, non-comet, safe rock with no outpost and no other
   builder heading for it. "Can be built" means: fewer than `TUNING.outpostMax` outposts and the budget check
   below. Nothing else gates it (decided by the owner: builders build automatically). In particular it does not
   wait for a hauler; outposts store their output until a hauler or a hauling builder collects it. When an
   exhausted outpost is dismantled, its slot frees up and builders fill it again.
   - **Search area** (*call made in this design*): builders always anchor on the station, like AUTO mode, and
     search within `TUNING.builderLeash`, starting at about 1.5 × `droneLeash`, so they reach large rocks drones
     wouldn't but don't roam the whole system. Builders have no ASSIST mode. They accept the player's manual
     move/dock orders through `runOrder` like drones do.
2. Fly to it, using `arrive` with the usual star detour and avoidance.
3. Once within `TUNING.outpostDeployGap` of the rock, deploy the outpost through the same code the player's deploy
   uses (`makeOutpost`, pay, stats, log line, `outpost` event), and mark the rock as no longer minable as today.
4. **With nothing to build, it helps the haulers** (decided by the owner). This covers the outpost limit being
   reached, no eligible rock, or the bank below the builder reserve. It runs the hauler brain's
   collecting logic (empty outposts and full miners, unload at the station) with its own cargo hold. It goes back
   to building as soon as a build becomes possible again; a builder carrying cargo unloads first. Its status
   says why: for example "Hauling · outpost limit reached". With no hauler in the fleet, builders are what empty
   the outposts they built.

**BUILD toggle (decided by the owner: manual stays an option).** Each construction drone has a BUILD toggle in its
fleet row, next to REPAIR and UPGRADE from #140, on by default.

- **On:** it picks outposts itself, as above.
- **Off:** it never picks a rock itself. It hauls (step 4) until the player gives it a build order: with the
  construction drone selected, the player targets a large rock, and the ship flies there and deploys on it,
  using the same budget check. *Call made in this design:* the order reuses the existing "mine this rock" input,
  so a construction drone told to mine a large rock builds there instead; a new `Order` kind `build` carries it.
  An order on a rock that can't take an outpost is rejected with a log line, like other invalid commands.
- Build orders also work with the toggle on, to override its choice once.
- The flagship's own deploy (`deployOutpost`) is unchanged, so outposts can still be placed without any
  construction drone.

**Deploy rule.** `outpostBlock` currently insists the *flagship* is next to the rock. Split it so the distance
check takes the deploying ship as a parameter: the player's command still passes the flagship, and builders pass
themselves. All other checks (large rock, no existing outpost, limit, cost) stay shared. Builders additionally
require the bank to stay at or above the builder reserve (below) after paying, using `affordAbove` from
`fleetAuto.ts`.
The player's own deploy keeps ignoring the reserve, as the player's purchases do today.

**Budget (decided by the owner: builders get their own).** A new `FleetAuto.builderReserve`, set in Menu →
Gameplay next to the existing reserve, separate from the autoupgrade reserve. The shared 100-per-resource default
would need 110 alloy in the bank per outpost and leave builders idle most of a run.

- *Calls made in this design:* it works like the existing reserve (keep at least this many units of every resource
  the outpost costs), with choices 0 / 10 / 25 / 50 / 100 / 250 and a default of 25. At the default an outpost
  needs 105 ore, 35 ice and 35 alloy in the bank. The builder may retune the default with the balance report.
- Settings are validated like the other `FleetAuto` fields: an unknown stored value falls back to the default
  (#103). It lives in settings, not the save.

**Pacing.** At most one deploy per builder per `TUNING.autoUpgradeInterval`-style interval, so two builders can't
empty the bank in one tick. Builders reserve their target (transient, in `SimIndex`) so two don't race for the
same rock.

**Determinism.** Target choice is a pure function of state (distance, then rock id as the tiebreak). No RNG draws.

### 2. Resource-aware target choice

`droneThink` picks the nearest safe rock today (`nearestRock`). Replace the pure distance pick for drones and
harvesters, in AUTO and ASSIST modes alike, with a scored pick:

- `score(rock) = distance(rock) / need(rock.kind)`, lowest wins, ties on rock id.
- `need(kind)` rises when the bank is short of that kind's resource compared with the others. A simple form:
  `need = 1 + TUNING.scarcityWeight * (1 - share)`, where `share` is that resource's bank amount divided by the
  largest of the mined resources' bank amounts (ore, ice, crystal; alloy and fuel are not mined).
- Cap the effect so a needed rock can be at most about `1 + scarcityWeight` times further away than the nearest
  rock. The builder tunes `scarcityWeight` with the balance report; start around 1 (a needed rock may be up to
  twice as far).
- The search radius and the safety filters (comet paths, flare zones, blasts, outpost rocks) are unchanged.
- Manual orders and chain mining of a broken rock's fragments are unchanged: fragments of the rock a ship just
  broke stay its next target.

Reading the bank is fine: drones already read run state; nothing new is saved.

### 3. Hazard sense: fewer collisions

Collision damage comes from `collideRocks` in `src/sim/update.ts` when a ship hits a rock faster than
`TUNING.collisionMinSpeed`. The autopilot's `avoidance` in `src/sim/pilot.ts` looks a fixed corridor ahead.

- Diagnose first with the #208 hazard meter: which ships collide (drones, haulers, builders, the flagship on
  autopilot), at what speed, and while doing what (arriving at a target, leaving the station, chasing pickups,
  dodging a comet).
- Likely fixes, to be confirmed by that diagnosis: scale the look-ahead with speed, brake earlier when a rock sits
  in the corridor, and approach the work rock at a speed that stays below `collisionMinSpeed`.
- Comet and flare reflexes stay as they are unless the diagnosis shows they cause collisions (for example, a dodge
  that steers into a rock).

**Target:** collision damage per system in the balance report's Hazards section drops by at least a third, while
the mid-game value-per-minute median drops by no more than 5%. Both go in the report as a PASS/FAIL row.

### 4. Status line in the fleet list

Each drone, harvester, hauler and construction drone row in `src/ui/panels/FleetPanel.ts` gets one short line under
its name. *Call made in this design:* the flagship is out of scope for now; its autopilot is `runOrder`, not a brain,
and the player is flying it.

- **Source.** Each brain writes a small status record when it decides what to do: a kind plus optional target info
  (rock kind and size, resource, outpost, percentages). It lives in `SimIndex` (transient, not saved), keyed by ship
  id, so it costs no save change. The UI formats it; the sim does not build strings.
- **Wording** (final text is the builder's call; keep it short enough for the phone layout):
  - Mining: "Mining ice rock · hold 62%"
  - Heading for a target: "Heading to large ore rock"
  - Collecting: "Collecting pickups"
  - Returning: "Returning to dock · hold full"
  - Unloading/repairing at the station: "Docked · repairing" / "Docked · unloading"
  - Hauling: "Collecting from outpost" / "Collecting from drone"
  - Building: "Heading to build an outpost" / "Building outpost on large metal rock"
  - Hazards: "Avoiding comet" / "Sheltering from flare"
  - Idle, always with the reason: "Idle · no safe rocks in range", "Idle · outpost limit reached",
    "Idle · bank below reserve", "Idle · waiting for repair money",
    "Idle · nothing to haul"
- **Refresh.** The fleet panel already refreshes on its own cadence; the line updates there, with no new per-frame
  DOM work. A status only changes when the brain's decision changes, not with every percentage tick of movement.
- **Accessibility.** Plain text, readable by screen readers; no colour-only meaning. Under the #210 palette, any
  colour on the line is decoration only.

### 5. Balance bot and report

- The bot (`scripts/bot.ts`) needs a simple rule for builders so the report can measure them: for example, buy one
  construction drone once the fleet has two mining drones and a hauler is affordable, and stop the flagship's own
  manual outpost deploys when a builder exists.
- The report gains: outposts built by builders vs by the flagship, and the collision-damage row from section 3.
- All existing targets (opening, active-play share, #206 automation rows, #207 fleet utilisation) must still pass.
  Regenerate with `npm run balance:ci`.

## State and save

- A new `HullId` and `role` value are additive. Old saves contain no `constructionDrone` ships, and the save
  validators must accept the new hull id.
- The BUILD toggle is a saved per-ship field, `autoBuild`, like `autoRepair`/`autoUpgrade`. The order kind `build`
  is saved in `Ship.order` like other orders. So this does change the save shape: bump `SAVE_VERSION`, add one
  migration that sets `autoBuild: false` on existing ships, and add a frozen fixture for the new version, as
  AGENTS.md and docs/agents/testing.md require.
- Status records, builder target reservations and deploy pacing are transient in `SimIndex`, like `repairWait`
  and `upgradeReadyAt` from #140.
- Commands: the `shipAuto` command's `kind` widens to include `build` (rejected for ships that aren't construction
  drones, with a `warn`). Build orders go through the existing `mine` command; its handler turns a mine order on a
  construction drone into a `build` order. Automatic building itself needs no command: the builder brain acts
  inside the tick, like autoupgrade. Buying the hull uses the existing `buyHull` command.

## Testing

- Builder brain: builds on the nearest eligible rock, respects the builder reserve and the outpost limit, never
  targets a rock another builder has claimed, never builds on a comet or an unsafe rock, and switches to hauling
  (and back) with the right status reason. With BUILD off it never picks a rock, only hauls, and still carries
  out a build order; an invalid build order is rejected with a log line.
- Save: the migration adds `autoBuild` to old ships, the new fixture loads, and a build order survives a round-trip.
- `outpostBlock` split: the player's deploy behaves exactly as before.
- Scarcity scoring: with ice short, a slightly further ice rock wins; with the bank balanced, the nearest rock wins;
  the distance cap holds.
- Collision changes: a seeded run shows fewer collisions and unchanged determinism.
- Status: each brain branch produces its status kind; the UI formats each kind.
- Long-running bot tests use the `HEAVY = { timeout: 30_000 }` option.

## Left to the builder

- Construction drone stats, cost, loadout and build order, tuned with the balance report.
- `scarcityWeight` and the exact `need` formula, within the anti-goal above.
- The specific collision fixes, chosen from the diagnosis.
- Final status-line wording and layout in the fleet row, including the phone layout.
- Whether this lands as one PR or several (a natural split: status line → scarcity → collisions → construction
  drone, each with its own balance regeneration).
