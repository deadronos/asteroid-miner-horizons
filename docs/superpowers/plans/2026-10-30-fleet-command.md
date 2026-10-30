# Fleet command depth plan (#174)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a construction drone that builds outposts on its own (with a BUILD toggle and manual build orders),
miners that prefer what the bank lacks, fewer rock collisions, and a one-line status per ship in the fleet list.

**Architecture:** brains write a transient `ShipStatus` into the outbox (`state.out.status`), which the fleet panel
formats. Miners score rocks by distance over bank need. The construction drone is a new hull with role `builder`
and a `builderThink` brain that deploys through a ship-parameterised `outpostBlock`, and falls back to the hauler
brain's collecting logic. One save bump (v14) adds `Ship.autoBuild` and the `build` order.

**Tech Stack:** TypeScript, Vitest, Oxc. **Spec:**
[`2026-10-30-fleet-command-design.md`](../specs/2026-10-30-fleet-command-design.md)

## Global Constraints

- `src/core`, `src/data` and `src/sim` stay pure and deterministic: no DOM, no `Math.random`/`Date` in a tick.
- Input and UI never mutate `GameState`; they enqueue `Command`s. Invalid commands are rejected with a log line.
- Hull id is `constructionDrone` (display name "Construction Drone"), role `builder`. Never `constructor`.
- One `SAVE_VERSION` bump, 13 → 14, with one migration and a frozen `tests/fixtures/save-v14.json`.
- Builder reserve setting `builderReserve`: choices `0 | 10 | 25 | 50 | 100 | 250`, default `25`; in settings,
  not the save; unknown stored values fall back to the default.
- The player's own purchases and `deployOutpost` ignore both reserves.
- No per-frame DOM churn and no new per-tick allocations (`tests/alloc.test.ts` budget stays at 48 kB).
- `docs/balance.md` only via `npm run balance:ci`; every existing balance target keeps passing. `scratch.md`
  untouched. No new dependencies. Long bot tests use `HEAVY = { timeout: 30_000 }`.
- `npm run check` green after every task.

## Review Focus

- A builder and a hauler (or two builders) claim the same outpost and both stall beside it; claims must count
  every ship that hauls (Task 5 test).
- The status line flickers between kinds every tick while a ship hovers at a decision boundary, such as a hold
  near full or a rock at the leash edge (Task 1 test: same state over 2 ticks gives the same status).
- An old v13 save with a mine order on a drone loads and keeps mining, not building (Task 4 test).
- A build order on a rock that becomes an outpost, breaks or turns unsafe mid-flight is dropped cleanly, with no
  payment and no exception (Task 6 test).
- Scarcity scoring with an empty bank (all zero) divides by zero or prefers nothing (Task 2 test).

---

## Task 1: Status line

**Files:** create `src/sim/status.ts`; modify `src/sim/types.ts` (Outbox), `src/sim/create.ts`, `src/sim/validate.ts`
(line 326), `tests/hazards.test.ts:17`, `tests/pilot.test.ts:66`, `src/sim/pilot.ts` (`droneThink`, `dodgeHazards`),
`src/sim/automation.ts` (`haulerThink`), `src/ui/panels/FleetPanel.ts` (`status()`, lines 13–29);
test `tests/status.test.ts`.

**Interfaces — produces:**
- `type StatusKind = 'mining' | 'heading' | 'collecting' | 'returning' | 'docked' | 'repairing' | 'unloading' |
  'haulOutpost' | 'haulMiner' | 'buildHeading' | 'building' | 'avoidComet' | 'flare' | 'escorting' | 'idle'`
- `type IdleReason = 'noRocks' | 'outpostLimit' | 'noBuildSite' | 'belowReserve' | 'repairMoney' | 'nothingToHaul'`
- `interface ShipStatus { kind: StatusKind; reason: IdleReason | null; rockKind: RawResource | null; large: boolean }`
- `Outbox.status: Map<number, ShipStatus>`, transient (never saved, like `fx`/`log`), not drained per tick.
- `setStatus(out: Outbox, shipId: number, kind: StatusKind, reason?: IdleReason | null, rock?: Rock | null): void`
  reuses the ship's existing record (no allocation after a ship's first tick).
- `formatStatus(st: ShipStatus, holdShare: number): string`, the text the panel shows, in `src/ui/panels/FleetPanel.ts`.

- [ ] **Step 1: Failing tests** in `tests/status.test.ts`:
  - `drone mining reports mining with the rock kind`: run a seeded drone until `beamOn`; expect
    `state.out.status.get(id)` to equal `{ kind: 'mining', rockKind: <rock.kind>, … }`.
  - `full drone reports returning`, `hauler with nothing to collect reports idle/nothingToHaul`,
    `drone in a comet path reports avoidComet`, `drone with no minable rock in range reports idle/noRocks`.
  - `status is stable`: two consecutive ticks with no state change give the same `kind` and `reason`.
  - `formatStatus`: `{mining, ice}` with hold 0.62 → `"Mining ice rock · hold 62%"`; `{idle, noRocks}` →
    `"Idle · no safe rocks in range"`; `{returning}` with hold 1 → `"Returning to dock · hold full"`;
  `{haulOutpost, outpostLimit}` → `"Hauling · outpost limit reached"` (a hauling builder's reason shows after
  the dot).
- [ ] **Step 2:** `npx vitest run tests/status.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Add `status.ts` and the Outbox field (initialise `status: new Map()` at all four construction
  sites). Call `setStatus` at each return branch of `droneThink`, `dodgeHazards` and `haulerThink`. Replace the
  panel's `status()` body with a read of `state.out.status` plus `formatStatus`, keeping the `Rebuilding`/order
  branches for manual orders and the flagship. Use the spec's wording list (§4); the copy is the builder's call.
- [ ] **Step 4:** `npx vitest run tests/status.test.ts tests/alloc.test.ts`; expect PASS.
- [ ] **Step 5:** `npm run check`, then commit "Show what each ship is doing in the fleet list (#174)".

## Task 2: Resource-aware target choice

**Files:** modify `src/data/tuning.ts` (add `scarcityWeight: 1`), `src/sim/pilot.ts` (`nearestRock` callers in
`droneThink`); test `tests/pilot.test.ts`; regenerate `docs/balance.md`.

**Interfaces — produces:** `need(bank: Wallet, kind: RawResource): number` and
`scoredRock(ctx, from, radius, filter, bank): Rock | null` in `src/sim/pilot.ts`. Score = `distance / need`,
lowest wins, ties on lower rock id. `need = 1 + TUNING.scarcityWeight * (1 - share)`, where
`share = bank[kind] / max(bank.ore, bank.ice, bank.crystal)`, and `share = 1` when that max is 0.

- [ ] **Step 1: Failing tests:** `need is 1 for the most plentiful resource and 1 + weight for an empty one`;
  `empty bank gives need 1 for all` (no NaN); `with ice at 0 and ore at 500 a drone picks an ice rock 1.8× as far
  over a near ore rock`; `with ice at 0 a drone still picks the near ore rock when the ice rock is 2.5× as far`;
  `chain targets after a manual break are unchanged` (existing chain test still passes).
- [ ] **Step 2:** Run `npx vitest run tests/pilot.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement `need` and `scoredRock`, then use `scoredRock` for both AI picks in `droneThink`.
  `chainTarget` keeps `nearestRock`. The filter callbacks stay hoisted (#217).
- [ ] **Step 4:** Tests pass. Then run `npm run balance:ci` and confirm that the opening, active-play, #206 and
  #207 rows still PASS. Tune `scarcityWeight` only if one fails.
- [ ] **Step 5:** `npm run check`, then commit "Miners prefer what the bank lacks (#174)" with the regenerated report.

## Task 3: Fewer rock collisions

**Files:** modify `scripts/hazardMeter.ts` (record the ship role and speed per collision), `scripts/balance.ts`
(Hazards section: collision damage per system plus the target row), `src/sim/pilot.ts` (`avoidance`, `arrive`),
`src/data/tuning.ts`; test `tests/pilot.test.ts`, `tests/hazardMeter.test.ts`.

**Interfaces — produces:** a balance row "Collision damage vs baseline (#174)" that PASSes when the median
collision damage per system (systems 3–10) is ≤ ⅔ of the baseline recorded in this task's first report, and the
mid-game value/min median is ≥ 95% of the same baseline. Hard-code both baselines as constants in `balance.ts`,
with a comment naming the commit they came from.

- [ ] **Step 1:** Run the diagnosis: extend the meter to split collision damage by role (flagship/drone/hauler)
  and by what the ship was doing (status kind from Task 1). Regenerate the report and note which case dominates
  in the PR body.
- [ ] **Step 2: Failing test** for the dominant case, for example `a drone arriving at a rock behind another rock
  does not hit it above collisionMinSpeed`: a seeded setup that collides today, asserting zero collision damage.
- [ ] **Step 3:** Fix only what the diagnosis points at: speed-scaled look-ahead in `avoidance`, earlier braking,
  or an approach-speed cap below `TUNING.collisionMinSpeed`. Keep comet and flare reflexes as they are unless they
  turn out to cause the collisions.
- [ ] **Step 4:** Tests pass; `npm run balance:ci`; the new row and every existing row PASS.
- [ ] **Step 5:** `npm run check`, then commit "Fly around rocks instead of into them (#174)".

## Task 4: Construction drone hull, save v14 and settings

**Files:** modify `src/data/hulls.ts` (role union, `constructionDrone` entry), `src/sim/types.ts`
(`Ship.autoBuild`, `Order` adds `{ kind: 'build'; rockId: number }`), `src/sim/ships.ts` (`isBuilder`, `makeShip`
default), `src/sim/fleetAuto.ts` (`BUILD_ORDER` key widens to `'drone' | 'hauler' | 'builder'`),
`src/sim/validate.ts` (`isOrder`, `autoBuild` check), `src/sim/create.ts` (`SAVE_VERSION = 14`),
`src/sim/migrations.ts` (step `13`), `src/sim/handlers.ts:203` (`miningDrones` unchanged, so builders don't
count), `src/sim/assists.ts` (`FleetAuto.builderReserve`), `src/settings.ts` (`builderReserve`,
`BUILDER_RESERVE_VALUES`), `src/main.ts:93,102`; tests `tests/migrations.test.ts`, `tests/hullSlots.test.ts`,
`tests/settings.test.ts`, `tests/validate.test.ts`; create `tests/fixtures/save-v14.json`.

**Interfaces — produces:**
- `isBuilder(ship: Ship): boolean` in `src/sim/ships.ts`.
- `Ship.autoBuild: boolean`: `true` for new construction drones, `false` for every other ship.
- `FleetAuto = { repairAt: number; reserve: number; builderReserve: number }`;
  `DEFAULT_FLEET_AUTO.builderReserve = 25`.
- `BUILDER_RESERVE_VALUES = [0, 10, 25, 50, 100, 250] as const`.

- [ ] **Step 1: Failing tests:**
  - `v13 fixture migrates to v14 with autoBuild false on every ship`;
  - `v13 mine orders survive unchanged`;
  - `save-v14 fixture loads through fromData`;
  - `a build order round-trips through save`;
  - `validate rejects a build order without a rockId`;
  - `settings: unknown builderReserve falls back to 25`;
  - `HULLS.constructionDrone has role builder and fits each module type at least once` (existing #141 rule);
  - `droneCount counts construction drones`.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Implement the hull with first-pass stats: speed 95, hull 60, cargo 70, slots 2/6, no laser, cost
  `{ ore: 110, ice: 15, alloy: 15 }`; Task 7 tunes it. Then the save changes, the migration, the fixture (generate
  it from a v14 state, as #215 did for v13) and the settings field. Wire `builderReserve` into `main.ts` like
  `reserve`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** `npm run check`, then commit "Add the construction drone hull and save v14 (#174)".

## Task 5: Builder brain

**Files:** create `src/sim/builder.ts`; modify `src/sim/automation.ts` (`outpostBlock` signature, `pickSource`
claim check, export a collecting step), `src/sim/update.ts:139-140` (dispatch), `src/sim/handlers.ts:340-360`
(`deployOutpost` passes the flagship), `src/sim/index.ts` (`builderClaims`, `buildReadyAt`), `src/data/tuning.ts`
(`builderLeash: 1050`, `buildInterval: 0.5`); test `tests/builder.test.ts`.

**Interfaces — consumes:** Task 1 `setStatus`; Task 4 `isBuilder`, `Ship.autoBuild`,
`FleetAuto.builderReserve`, `Order` kind `build`.

**Interfaces — produces:**
- `outpostBlock(state: GameState, rock: Rock | undefined, by: Ship): string | null`. The distance check uses `by`;
  every other check is unchanged.
- `deployOutpostAt(state: GameState, rock: Rock): Outpost`: the shared pay, stats, log and `outpost`-event path,
  used by both the handler and the builder.
- `haulStep(ctx: TickCtx, ship: Ship, st: ShipStats): void`: `haulerThink`'s collecting body after the reflexes,
  used by both brains.
- `hauls(ship: Ship): boolean` (hauler or builder). `pickSource` uses it for claims.
- `builderThink(ctx: TickCtx, ship: Ship, st: ShipStats): void`.
- `SimIndex.builderClaims: Map<number, number>` (rock id → ship id) and `SimIndex.buildReadyAt: Map<number, number>`,
  both pruned in `rebuild` like `upgradeReadyAt`.

- [ ] **Step 1: Failing tests** in `tests/builder.test.ts`:
  - `builds on the nearest eligible large rock within builderLeash of the station`;
  - `does not build when the bank would drop below builderReserve`, then status is `idle/belowReserve` while hauling;
  - `stops at outpostMax and hauls`, with status `haulOutpost`/`haulMiner`, or `idle/outpostLimit` with nothing to haul;
  - `builds without any hauler in the fleet`;
  - `two builders never claim the same rock`;
  - `a builder and a hauler never claim the same outpost`;
  - `never builds on a comet, an outpost rock or an unsafe rock`;
  - `refills a slot after an outpost is dismantled`;
  - `autoBuild off never picks a rock`;
  - `at most one deploy per buildInterval`;
  - `deterministic across two seeded runs`;
  - `the player's deployOutpost still requires the flagship beside the rock and ignores the reserve`.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Implement in the reflex order the spec gives: hazards → blast → repair → build order → auto-build
  → `haulStep`. A builder with cargo unloads before heading to build. Dispatch in `update.ts` with
  `else if (isBuilder(ship)) builderThink(...)` ahead of `droneThink`.
- [ ] **Step 4:** Tests pass (bot-length runs use `HEAVY`); `tests/alloc.test.ts` stays within budget.
- [ ] **Step 5:** `npm run check`, then commit "Construction drones build outposts and haul when idle (#174)".

## Task 6: Commands and fleet UI

**Files:** modify `src/sim/commands.ts:23` (`shipAuto.kind` adds `'build'`), `src/sim/handlers.ts` (`mine`,
`shipAuto`), `src/sim/pilot.ts` (`runOrder` handles `build` via `builderThink`'s order step),
`src/ui/panels/FleetPanel.ts` (BUILD toggle after UPGRADE, on construction drone rows only),
`src/ui/menu/SettingsTabs.ts` ("Builder reserve" row after "Keep in reserve"); tests `tests/commands.test.ts`,
`tests/shipPanel.test.ts`.

**Interfaces — consumes:** Task 5 `outpostBlock(…, by)`, `deployOutpostAt`.

- [ ] **Step 1: Failing tests:**
  - `mine on a construction drone with a large rock sets a build order`;
  - `mine on a construction drone with a small rock fails with a log line`;
  - `mine on a mining drone is unchanged`;
  - `shipAuto build toggles autoBuild on a construction drone`;
  - `shipAuto build on a drone fails with a warn`;
  - `a build order on a rock that breaks, gains an outpost or turns unsafe is dropped with no payment`;
  - `a build order with autoBuild on overrides the builder's own pick once`;
  - fleet panel: `BUILD toggle shows only on construction drone rows and sends shipAuto build`.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** In the `mine` handler, check `isBuilder` before the laser check. Settings row copy: "Builder
  reserve", choices labelled like "Keep in reserve", with the hint "Construction drones only build with what the
  bank holds above this."
- [ ] **Step 4:** Tests pass. Then run `npm run dev` and check in the built-in browser at desktop and phone width:
  the BUILD toggle, the status lines, and the settings row.
- [ ] **Step 5:** `npm run check`, then commit "BUILD toggle and build orders for construction drones (#174)".

## Task 7: Bot, report and tuning

**Files:** modify `scripts/bot.ts` (the purchase rule and outpost-deploy rule around lines 145–157 and 308–330),
`scripts/balance.ts` (an "Outposts by builder vs flagship" row), `src/data/hulls.ts` (tune the construction
drone); test `tests/bot.test.ts`; regenerate `docs/balance.md`.

- [ ] **Step 1: Failing test:** `bot buys one construction drone once it has two mining drones` and `bot stops
  flagship deploys once a construction drone exists` (`HEAVY`).
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Implement the bot rule from the spec (§5). Add the report row. Tune the hull's cost and stats so
  every target passes and builders place most outposts by system 4.
- [ ] **Step 4:** `npm run balance:ci`; every row PASSes, including Task 3's.
- [ ] **Step 5:** `npm run check`. Update the README's fleet section with the construction drone and BUILD
  toggle, then commit "Bot fields construction drones; tune and report (#174)".

## PR split

Open one PR per pair of tasks so each regenerated report reviews on its own: Tasks 1–2, Task 3, Tasks 4–6,
Task 7. Each PR rebases on `origin/main` before opening, references #174, and the last one closes it.
