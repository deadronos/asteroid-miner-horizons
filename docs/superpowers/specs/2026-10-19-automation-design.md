# Automation tier: hauler drones and mining outposts

- **Date:** 2026-10-19
- **Issue:** #39 — "Automation tier: hauler drones and mining outposts"
- **Status:** Approved design

## Context / problem

Drones mine and haul for themselves: each one flies home when its hold fills, so a drone spends a large share of
its life commuting, and there is no logistics layer to invest in. The issue asks for:

1. A **hauler** hull that ferries cargo from miners.
2. **Outposts** deployable on large asteroids that mine slowly and need pickup.

Acceptance criteria:

1. Idle play remains viable but not dominant.
2. Balance-bot validated.

"Not dominant" already has a number in this repo: the balance report's **active-play share** must stay
**≥ 40 % through the mid-game** (systems 3–6, #46). Automation income counts as idle play, so that gate is the
acceptance test for criterion 1.

## Goals

- A hauler hull that never mines: it skims loaded miners and empties outposts, then unloads at the station.
- Outposts on large rocks that extract slowly into a capped store, so they stall without a hauler.
- Both cost a real slot: a hauler takes a fleet slot a mining drone could have had, and an outpost costs refined
  alloy and must be placed by flying the flagship to the rock.
- Nothing draws from `run.rng`; the rock layout and `run.rng.s` are unchanged by the feature.
- The balance bot uses both, and the report shows hauler income and outpost output separately.

## Non-goals

- Offline progress, outpost upgrades, hauler routing UI, or haulers serving the flagship.
- Outposts surviving a warp: like the refinery queue, they are left behind with a warning.

## Design

### Hauler hull (`data/hulls.ts`)

A new `role: 'hauler'` beside `'flagship'` and `'drone'`. `isFlagship` is unchanged and haulers count against the
fleet cap (`droneCount` counts every non-flagship). Stats: 2 slots (an Ion engine fitted), 80 hull, speed 115,
140 cargo, size 10; cost 160 ore · 60 ice · 20 alloy. The shipyard lists it automatically.

### Outposts (`sim/types.ts`, `sim/automation.ts`)

`run.automation = { outposts: Outpost[], extracted: number }`. An `Outpost` is
`{ rockId, kind, pos, stored: Wallet, reserve }`, keyed by its host rock (one per rock).

- **Reserve, not the rock.** An outpost taps a deep reserve of `rock.units × outpostReserveMul` (10×). The host
  rock's own units are untouched, so cracking conservation is unaffected. A 40-unit rock gives a 400-unit reserve.
- **Extraction.** Each tick, `outpostRate` (0.8/s) of reserve moves into `stored`, times the yield perk, until
  `stored` reaches `outpostCapacity` (100). A full outpost stalls: this is the "needs pickup" lever.
- **Dismantling.** Once `reserve` and `stored` are both empty the outpost is removed with a log line; the rock is
  then an ordinary rock again.
- **Protected host.** `SimIndex.outpostRocks` lists host rocks each tick. Drone AI, fragment chaining, Wide Beam
  splash and the balance bot skip them, and the `mine` command rejects one with a warning. Deploying clears any
  mine order or drone target already on the rock.

### Deploy command

`{ t: 'deployOutpost'; rockId }`. `outpostBlock` (shared by the handler and the bot) rejects: a missing rock,
anything but a large non-comet rock, a rock that already hosts one, the `outpostMax` (3) limit, a flagship that is
dead or more than `outpostDeployGap` (120) from the rock's surface, and an unaffordable `outpostCost`
(120 ore · 30 ice · 15 alloy). Payback: about 4.7 min of extraction at ore value covers the cost, so an outpost
pays off within a typical mid-game system only if it is deployed early and kept serviced.

### Hauler AI (`haulerThink`)

Called from `updateShip` for haulers with no manual order. Order of priority:

1. **Hazards** — the shared `dodgeHazards` reflex (comet path, flare).
2. **Load** — keep the claimed source while it still has cargo; otherwise pick the source with the best
   `load / (distance + 100)` among miners carrying ≥ `haulMinShare` (30 %) of their hold within `haulRange` of the
   station, and outposts holding ≥ `haulMinOutpost` (15) anywhere. Sources another hauler claimed, docked miners
   and sources in a hazard are skipped. Within `haulTransferGap` the hauler matches the source's velocity and moves
   `haulTransferRate` (30/s) into its hold.
3. **Unload** — carrying cargo with nothing worth loading (or full) → dock, if auto-dock is on.
4. **Wait** — hold a slot 110 units off the station.

The claimed source lives in `ship.aiTargetId`. Ship ids and rock ids share `run.nextId`, so a ship id and an
outpost's host rock id never collide. Haulers cross the whole system, so their travel (`haulTo`) bends around the
star's heat zone when the straight line would cross it.

### Save v8 → v9

`SAVE_VERSION` 9; the migration adds an empty `run.automation`. `fromData` validates it: an array of outposts, a
finite `extracted`, and per outpost a raw resource kind, a position, a full wallet, a finite reserve, and a host rock
that exists in the save and hosts no other outpost. A frozen `save-v8.json` fixture is added.

### Presentation

- **Input:** a new key action `outpost` (default **O**) deploys on the hovered rock. Settings merge new actions
  over old installs, so no settings migration is needed.
- **HUD:** the rock tooltip shows an outpost's stored/capacity and reserve, or the deploy key on a large rock; the
  help box gains an Automation line; the fleet panel lists outposts with a storage bar and gives haulers their own
  statuses (Collecting, Loading, Unloading, Standby) and no Assist/Auto toggle.
- **Render:** `OutpostView` draws a hexagonal ring tinted by resource kind around each host rock, plus an arc that
  fills with storage. Haulers get their own hull silhouette.

### Balance bot and report

- The bot keeps the fleet slot after two mining drones for one hauler (smelting alloy for it if short) and, once it
  has a hauler, deploys an outpost on any large rock its flagship is already beside, priced against the warp's ice
  reserve.
- The report credits hauler unloads separately (`Hauler share`, `hauler_value`) and records `outpost_units`.
  Active-play share is unchanged in definition; haulers count as idle income alongside drones.

## Trade-offs

- **Reserve vs. draining the rock.** Draining the host rock's own units would make an outpost worth ~40 units, far
  less than its cost. A reserve multiple keeps the rock intact and makes outposts a medium-term investment.
- **Haulers do not serve the flagship.** That would move active income into the idle column and blur the #46
  metric.
- **No new RNG stream.** Nothing in the feature is random, so none is needed.
