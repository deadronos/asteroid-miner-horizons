# Per-Tick Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the sim's remaining steady-state per-tick array/object allocations (spatial-hash buckets, ship-stats values, pickup/ship snapshots, per-steer vectors) without changing gameplay or the save format.

**Architecture:** One allocation-free `removeItem` helper in `src/core`, a bucket pool inside `SpatialHash`, order-preserving in-place removals for ships/rocks/pickups (with an index-based ship loop so mid-tick deaths cannot skip a ship), and reused scratch/stats objects owned by `SimIndex`. Every removal preserves array order, because rock order affects collision resolution, tie-breaks and `serialize(state)`.

**Tech Stack:** TypeScript, Three.js, Vite, vitest, oxlint/oxfmt

**Spec:** `docs/superpowers/specs/2026-10-18-per-tick-allocations-design.md` — read it with this plan. It is the design of record; the code bodies marked "the spec has the body verbatim" live there.

## Global Constraints

Copied verbatim from the issue brief:

- **Pure performance refactor: no gameplay/behavior change.** The sim is deterministic and must stay byte-identical. `tests/sim.test.ts` `describe('determinism')` compares `serialize(a) === serialize(b)` over a seeded replay — it must stay green and produce identical output.
- **No save-format change.** `GameState` stays plain JSON and serializable (`src/sim/types.ts`).
- **CRITICAL — swap-remove vs mid-loop removal:** `src/sim/update.ts` iterates `for (const ship of run.ships)` and its comment says removals are safe because they *reassign* `run.ships` rather than mutate it in place. A `[]`-preserving swap-remove mutates the array, which changes iteration semantics (elements skipped/revisited). Your design MUST specify how iteration is made safe for every loop that can remove an element (ships, rocks, pickups), e.g. reverse iteration, index-based while loops, or deferring removals. Pinned this because it is the most likely correctness trap.
- **Out of scope (do not touch):** `src/render/**` (that is issues #14, #15, #16) and issue #17. #18 is the umbrella. Only `src/sim/**`, `src/core/**` if genuinely required, and `tests/**`.
- **Keep the full CI gate green:** `npm run format:check`, `npm run lint` (warnings fail), `npm run typecheck`, `npm test`, and `npx vite build`.
- **Bench evidence, honestly reported.** `scripts/bench.ts` (`npm run bench`) is the measurement. The pre-change baseline on this branch has been captured by the controller and will be supplied at execution time; the plan must include a step that re-runs `npm run bench` and records the delta in the PR. The design spec must state explicitly (as the #5 spec did) that this is a micro-optimization and the delta may be within run-to-run noise — report honestly rather than claiming a speedup that isn't there.
- **Additional rules from the spec:** every removal preserves array order (no swap-remove); scratch state lives on `SimIndex`, never at module level (`sim/` must hold no module-level mutable state — #5); do **not** re-do #5 (the per-tick `new Map`s are already gone); no new dependency and no new `scripts/**` file.

Before every commit in every task, run `npm run format`, `npm run lint`, and `npm run typecheck` and confirm they pass.

## Review Focus

Failure modes the spec implies that the tasks' obvious assertions do **not** directly exercise, most-likely-first. Each has a test in its owning task.

1. **A ship dies mid-tick while the ship loop is walking `run.ships`.** The ship that shifts down into the freed slot must still be updated exactly once this tick (not skipped, not updated twice). The obvious "ships array identity" test does not cover it. **Owning task:** Task 3 (`still updates every surviving ship when one dies mid-loop`).
2. **A removal reorders the run arrays.** Order is observable through `SpatialHash.rebuild` insertion order, sequential collision resolution, nearest-on-ties, and `serialize`. **Owning tasks:** Task 4 (`destroyRock … order`) and Task 5 (`… preserving the order of the rest`).
3. **The reused `ShipStats` object compounds the system magnet multiplier** when `rebuild` runs twice. **Owning task:** Task 6 (`does not compound the system magnet effect across rebuilds`).
4. **A scrapped/destroyed ship's `ShipStats` entry lingers forever** now that `stats` is no longer cleared each tick. **Owning task:** Task 6 (`rebuild drops stats for ships that are gone`).
5. **A `SpatialHash` rebuild that drops a cell still returns the cell's old items** (stale bucket in the map or pool). **Owning task:** Task 2 (`query sees exactly the items of the latest rebuild`).

---

## Task 1: Allocation-free `removeItem` helper

**Files:**
- Create: `src/core/array.ts`
- Test: create `tests/array.test.ts`

**Interfaces:**
- Produces: `removeItem<T>(arr: T[], item: T): boolean` — removes the first element `=== item` **in place**, preserving order; returns whether it was found.

- [ ] **Step 1: Write the failing test** in `tests/array.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { removeItem } from '../src/core/array';

describe('removeItem', () => {
  it('removes the first match in place, preserving order and identity', () => {
    const arr = [1, 2, 3, 2];
    const same = arr;
    expect(removeItem(arr, 2)).toBe(true);
    expect(arr).toEqual([1, 3, 2]);
    expect(arr).toBe(same);
  });

  it('returns false and leaves the array untouched when absent', () => {
    const arr = ['a', 'b'];
    expect(removeItem(arr, 'z')).toBe(false);
    expect(arr).toEqual(['a', 'b']);
  });

  it('removes the last element', () => {
    const arr = [1, 2];
    expect(removeItem(arr, 2)).toBe(true);
    expect(arr).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/array.test.ts`. Expected: FAIL — cannot resolve `../src/core/array` (module does not exist yet).

- [ ] **Step 3: Implement `removeItem` in `src/core/array.ts`.** Use the shift loop, **not** `splice` (`splice` returns the removed elements in a fresh array, which is the allocation this issue is removing). The spec's §1 has the body verbatim; it is:

```ts
/** Removes the first element `=== item` in place, preserving order. Returns whether it was found. */
export function removeItem<T>(arr: T[], item: T): boolean {
  const i = arr.indexOf(item);
  if (i < 0) return false;
  for (let j = i; j < arr.length - 1; j++) arr[j] = arr[j + 1]!;
  arr.length -= 1;
  return true;
}
```

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/array.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/array.test.ts
git add src/core/array.ts tests/array.test.ts
git commit -m "Add allocation-free in-place removeItem helper (#13)"
```

---

## Task 2: `SpatialHash` reuses its bucket arrays

**Files:**
- Modify: `src/core/spatialHash.ts` (the whole class; `query` is unchanged)
- Test: create `tests/spatialHash.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SpatialHash<T>` with the **unchanged** public API `rebuild(items: readonly T[]): void` and `query(center: Vec2, radius: number, fn: (item: T) => void): void`. Internally it gains `private readonly cells: Map<number, T[]>`, `private readonly pool: T[][]`, `private readonly live: number[]` (the test reads `cells` and `pool` through a cast).

- [ ] **Step 1: Write the failing test** in `tests/spatialHash.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/core/spatialHash';

interface Thing {
  pos: { x: number; z: number };
}
const at = (x: number, z: number): Thing => ({ pos: { x, z } });
/** The private fields the reuse test inspects. */
type Internals = { cells: Map<number, Thing[]>; pool: Thing[][] };

describe('SpatialHash', () => {
  it('reuses the same bucket array for a cell across rebuilds', () => {
    const hash = new SpatialHash<Thing>(128);
    const internals = hash as unknown as Internals;
    hash.rebuild([at(10, 10)]);
    const bucket = internals.cells.values().next().value;
    expect(Array.isArray(bucket)).toBe(true);
    hash.rebuild([at(11, 11)]); // same cell: (0, 0) at cell size 128
    expect(internals.cells.values().next().value).toBe(bucket);
  });

  it('allocates no new buckets once the pool is warm', () => {
    const hash = new SpatialHash<Thing>(128);
    const internals = hash as unknown as Internals;
    for (let i = 0; i < 50; i++) hash.rebuild([at(10, 10)]);
    expect(internals.cells.size).toBe(1);
    expect(internals.pool.length).toBe(0);
  });

  it('query sees exactly the items of the latest rebuild', () => {
    const hash = new SpatialHash<Thing>(128);
    hash.rebuild([at(10, 10), at(5000, 5000)]);
    let near = 0;
    hash.query({ x: 0, z: 0 }, 100, () => {
      near++;
    });
    expect(near).toBe(1);
    hash.rebuild([at(11, 11)]); // drops the far cell
    let far = 0;
    hash.query({ x: 5000, z: 5000 }, 100, () => {
      far++;
    });
    expect(far).toBe(0);
    near = 0;
    hash.query({ x: 0, z: 0 }, 100, () => {
      near++;
    });
    expect(near).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/spatialHash.test.ts`. Expected: the first test FAILS at `toBe(bucket)` (a `rebuild` sets a fresh `[it]` array each time) and the second FAILS with `internals.pool` being `undefined`. The third test **passes before and after** — it is a correctness guard, not a red→green test.

- [ ] **Step 3: Implement the pooling `rebuild`.** The spec's §2 has the body verbatim; copy it. The shape: keep `cells`/`pool`/`live` as fields, detach last rebuild's buckets into `pool` (resetting their `length`), then refill, taking a bucket from `pool` before allocating `[]`. `query` and `key` are unchanged.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/spatialHash.test.ts tests/index.test.ts tests/modifiers.test.ts`. Expected: PASS — the hash still satisfies `SimIndex` and the nebula pickup-radius tests.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/spatialHash.test.ts
git add src/core/spatialHash.ts tests/spatialHash.test.ts
git commit -m "Recycle SpatialHash buckets instead of allocating one array per cell per tick (#13)"
```

---

## Task 3: In-place ship removal + a loop-safe ship iteration

**Files:**
- Modify: `src/sim/ships.ts:111` (`damageShip` non-flagship branch)
- Modify: `src/sim/handlers.ts:213` (`scrap`)
- Modify: `src/sim/update.ts:64-65` (the ship loop)
- Test: create `tests/alloc.test.ts`

**Interfaces:**
- Consumes: `removeItem` from `../core/array` (Task 1).
- Produces: nothing public changes. `tick(state, dt, input, index)` keeps its signature. `damageShip(state, ship, raw)` and the `scrap` handler keep their signatures and behavior.

- [ ] **Step 1: Write the failing test** in `tests/alloc.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { damageShip, makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';

const DT = 1 / 60;

/** Ticks `state` with no input for `seconds` (default: one tick). */
function runTick(state: GameState, seconds = DT): void {
  const index = new SimIndex();
  const input: TickInput = { thrust: { x: 0, z: 0 }, commands: [] };
  for (let t = 0; t < seconds; t += DT) tick(state, DT, input, index);
}

describe('in-place ship removal', () => {
  it('damageShip keeps the ships array identity', () => {
    const state = newGame(1);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
    state.run.ships.push(drone);
    const ships = state.run.ships;
    damageShip(state, drone, 1e6);
    expect(state.run.ships).toBe(ships); // not reassigned by a filter
    expect(ships).not.toContain(drone);
  });

  it('still updates every surviving ship when one dies mid-loop', () => {
    const state = newGame(1); // system 1 is class G: starRadius 75, heatRadius 150
    const run = state.run;
    run.rocks = [];
    for (const ship of run.ships) ship.pos = { x: 1e5, z: 1e5 }; // flagship out of the star's heat
    const drones = [0, 1, 2].map((i) => {
      const d = makeShip(run, state.profile, 'drone', `Drone-${i}`, { x: 100, z: i * 4 });
      d.hull = 100;
      run.ships.push(d);
      return d;
    });
    drones[1]!.hull = 0.01; // dies to star heat (30 dps at ~0.67 falloff ≈ 0.33 hull/tick)
    runTick(state);
    expect(run.ships).not.toContain(drones[1]);
    expect(drones[0]!.hull).toBeLessThan(100);
    expect(drones[2]!.hull).toBeLessThan(100); // the ship after the removed one still ran
  });
});
```

- [ ] **Step 2: Run the test and see which fails.** Run `npx vitest run tests/alloc.test.ts`. Expected: `damageShip keeps the ships array identity` **FAILS** (`filter` reassigns). `still updates every surviving ship…` **passes before and after**: today the `for…of` loop captures the old array, so the reassignment does not disturb it. It is a regression guard for the in-place change, not evidence of a new capability. Say so in the PR.

- [ ] **Step 3: Implement.**
  - `src/sim/ships.ts` (line 111): replace `run.ships = run.ships.filter((s) => s !== ship);` with `removeItem(run.ships, ship);` and add `import { removeItem } from '../core/array';`.
  - `src/sim/handlers.ts` (line 213): replace `state.run.ships = state.run.ships.filter((s) => s !== ship);` with `removeItem(state.run.ships, ship);` and import `removeItem`. (`scrap` runs in `applyCommands` before the ship loop; no loop guard is needed.)
  - `src/sim/update.ts` (lines 64-65): replace the comment and the `for…of` loop with the index loop (the spec §3 has it verbatim):

```ts
  // Index-based so a ship removed in `updateShip` (an in-place `removeItem`)
  // does not shift the next ship into an already-visited slot: after a removal
  // the element at `i` is a ship we have not seen, so do not advance.
  for (let i = 0; i < run.ships.length; i++) {
    const ship = run.ships[i]!;
    updateShip(ctx, ship, index.stats.get(ship.id)!, input.thrust);
    if (run.ships[i] !== ship) i--;
  }
```

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/alloc.test.ts tests/sim.test.ts tests/commands.test.ts`. Expected: PASS — including `determinism`, and `commands.test.ts`'s existing `scrap` test.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/alloc.test.ts tests/sim.test.ts tests/commands.test.ts
git add src/sim/ships.ts src/sim/handlers.ts src/sim/update.ts tests/alloc.test.ts
git commit -m "Remove ships in place and keep the tick's ship loop safe (#13)"
```

---

## Task 4: In-place rock removal

**Files:**
- Modify: `src/sim/mining.ts:42` (`destroyRock`)
- Test: append to `tests/alloc.test.ts` (add `import { destroyRock } from '../src/sim/mining';`)

**Interfaces:**
- Consumes: `removeItem` from `../core/array` (Task 1).
- Produces: `destroyRock(state, rock)` keeps its signature and its `Rock[]` return of the spawned fragments.

- [ ] **Step 1: Write the failing test** — add to `tests/alloc.test.ts`.

```ts
describe('in-place rock removal', () => {
  it('destroyRock keeps the rocks array identity and order', () => {
    const state = newGame(1);
    const rocks = state.run.rocks;
    expect(rocks.length).toBeGreaterThan(10);
    const target = rocks[5]!;
    const next = rocks[6]!;
    const before = rocks.length;
    const frags = destroyRock(state, target);
    expect(state.run.rocks).toBe(rocks); // no reassignment
    expect(rocks[5]).toBe(next); // the next rock shifted into the freed slot
    expect(rocks).not.toContain(target);
    expect(rocks.length).toBe(before - 1 + frags.length); // fragments are appended
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/alloc.test.ts`. Expected: FAIL at `expect(state.run.rocks).toBe(rocks)` (`filter` reassigns). The order assertion also covers Review Focus 2.

- [ ] **Step 3: Implement.** In `src/sim/mining.ts` replace `run.rocks = run.rocks.filter((r) => r !== rock);` with `removeItem(run.rocks, rock);` and import `removeItem`. Everything else in `destroyRock` is unchanged: fragments are pushed onto `run.rocks` at the end, so the array order equals the old filter-then-push order, and `regrowBelts`' `spawnBeltRock`/`pop` pair is untouched.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/alloc.test.ts tests/sim.test.ts`. Expected: PASS — including the `cracking` resource-conservation test and `determinism`.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/alloc.test.ts tests/sim.test.ts
git add src/sim/mining.ts tests/alloc.test.ts
git commit -m "Remove cracked rocks in place without reallocating the rocks array (#13)"
```

---

## Task 5: Pickups tick without a snapshot array or a `filter`

**Files:**
- Modify: `src/sim/update.ts` (`updatePickups`, and the call site at line 67)
- Test: append to `tests/alloc.test.ts` (add `import { flagship } from '../src/sim/ships';` alongside the existing `damageShip, makeShip` import, and `import { TUNING } from '../src/data/tuning';`)

**Interfaces:**
- Consumes: `SimIndex` (`index.stats`), `isAlive`, `cargoFree`, `dist`, `damp`, `TUNING`.
- Produces: internal `updatePickups(state: GameState, index: SimIndex, dt: number): void`. The `tick` call site becomes `updatePickups(state, index, dt);`.

- [ ] **Step 1: Write the failing test** — add to `tests/alloc.test.ts`.

```ts
describe('pickups tick in place', () => {
  it('keeps the pickups array identity over a tick', () => {
    const state = newGame(1);
    state.run.pickups = [{ id: 1, kind: 'ore', amount: 1, pos: { x: 5000, z: 5000 }, vel: { x: 0, z: 0 }, age: 0 }];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups).toHaveLength(1);
  });

  it('drops expired pickups in place, preserving the order of the rest', () => {
    const state = newGame(1);
    const mk = (id: number, age: number) => ({
      id,
      kind: 'ore' as const,
      amount: 1,
      pos: { x: 5000 + id, z: 5000 },
      vel: { x: 0, z: 0 },
      age,
    });
    state.run.pickups = [mk(1, 1), mk(2, TUNING.pickupLifetime + 1), mk(3, 3)];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups.map((p) => p.id)).toEqual([1, 3]);
  });

  it('ignores dead ships when pulling pickups', () => {
    const state = newGame(1);
    const fs = flagship(state.run);
    fs.respawn = 5; // not alive this tick
    state.run.pickups = [
      { id: 1, kind: 'ore', amount: 1, pos: { x: fs.pos.x + 10, z: fs.pos.z }, vel: { x: 0, z: 0 }, age: 0 },
    ];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups[0]!.vel).toEqual({ x: 0, z: 0 });
  });
});
```

- [ ] **Step 2: Run the test and see which fails.** Run `npx vitest run tests/alloc.test.ts`. Expected: the two identity tests **FAIL** (`filter` reassigns `run.pickups`). `ignores dead ships…` passes before and after (the old `live` snapshot already excluded them) — a regression guard for dropping `live`.

- [ ] **Step 3: Implement.** Replace `updatePickups` with the inline write-index compaction in the spec's §5 (verbatim) and change the call at `src/sim/update.ts:67` to `updatePickups(state, index, dt);`. Key points: read `index.stats`; iterate `run.ships` with `if (!isAlive(s)) continue;` instead of building `live`; the two `return false` cases become `continue` (one after `p.age += dt`, one after pushing the `collect` fx); write survivors with `pickups[kept++] = p` and finish with `pickups.length = kept`. No `run.pickups = …` remains.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/alloc.test.ts tests/sim.test.ts tests/modifiers.test.ts`. Expected: PASS — the mining-loop collect/dock test, determinism, and the nebula pickup-radius tests all still hold.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/alloc.test.ts tests/sim.test.ts tests/modifiers.test.ts
git add src/sim/update.ts tests/alloc.test.ts
git commit -m "Compact pickups in place and drop the per-tick live-ships snapshot (#13)"
```

---

## Task 6: `SimIndex` reuses `ShipStats` and hoists the system effects

**Files:**
- Modify: `src/sim/modifiers.ts` (add `applyEffects`; `applySystemStats` delegates)
- Modify: `src/sim/ships.ts` (add `emptyStats`/`writeShipStats`; `shipStats` delegates)
- Modify: `src/sim/index.ts` (`rebuild`, `clear`, imports)
- Test: append to `tests/index.test.ts`; add one test to `tests/stats.test.ts`

**Interfaces:**
- Produces: `emptyStats(): ShipStats`; `writeShipStats(out: ShipStats, ship: Ship, profile: Profile): ShipStats`; `applyEffects(st: ShipStats, fx: SystemEffects): ShipStats`.
- `shipStats(ship, profile)` and `applySystemStats(st, system)` keep their signatures and behavior.
- `SimIndex.stats` becomes persistent across rebuilds (reconciled by id in `rebuild`, still emptied by `clear()`).

- [ ] **Step 1: Write the failing tests.** Add to `tests/index.test.ts` (extend the import to `import { makeShip, shipStats } from '../src/sim/ships';`):

```ts
  it('rebuild reuses each ship stats object across ticks', () => {
    const state = newGame(13);
    const index = new SimIndex();
    index.rebuild(state);
    const id = state.run.ships[0]!.id;
    const first = index.stats.get(id);
    index.rebuild(state);
    expect(index.stats.get(id)).toBe(first);
  });

  it('rebuild drops stats for ships that are gone', () => {
    const state = newGame(13);
    const index = new SimIndex();
    state.run.ships.push(makeShip(state.run, state.profile, 'drone', 'Drone-9', { x: 0, z: 0 }));
    index.rebuild(state);
    const gone = state.run.ships[state.run.ships.length - 1]!;
    expect(index.stats.has(gone.id)).toBe(true);
    state.run.ships.pop();
    index.rebuild(state);
    expect(index.stats.has(gone.id)).toBe(false);
  });

  it('does not compound the system magnet effect across rebuilds', () => {
    const state = newGame(1);
    state.run.system.modifiers = ['nebula' as const];
    const index = new SimIndex();
    index.rebuild(state);
    const ship = state.run.ships[0]!;
    const once = index.stats.get(ship.id)!.magnet;
    index.rebuild(state);
    index.rebuild(state);
    expect(index.stats.get(ship.id)!.magnet).toBeCloseTo(once);
    expect(once).toBeCloseTo(shipStats(ship, state.profile).magnet * 0.85);
  });
```

Add to `tests/stats.test.ts` (import `emptyStats`, `writeShipStats` from `../src/sim/ships`):

```ts
  it('writeShipStats fills a provided object identically to shipStats', () => {
    const state = newGame(7);
    const ship = state.run.ships[0]!;
    expect(writeShipStats(emptyStats(), ship, state.profile)).toEqual(shipStats(ship, state.profile));
  });
```

- [ ] **Step 2: Run the tests and see which fail.** Run `npx vitest run tests/index.test.ts tests/stats.test.ts`. Expected: `rebuild reuses each ship stats object…` **FAILS** (`shipStats` allocates a new object each rebuild → `toBe` fails) and the new `stats.test.ts` test **FAILS** (imports do not exist). `rebuild drops stats…` and `does not compound…` pass before and after, because the old code calls `stats.clear()` every rebuild — they are guards for the new persistence (Review Focus 3 and 4). Say so in the PR.

- [ ] **Step 3: Implement.**
  - `src/sim/modifiers.ts`: add `applyEffects(st, fx)` with `st.magnet *= fx.magnet; return st;`; make `applySystemStats(st, system)` return `applyEffects(st, systemEffects(system.modifiers))`.
  - `src/sim/ships.ts`: rename today's `shipStats` body into `writeShipStats(out, ship, profile)` writing into `out`, add `emptyStats(): ShipStats` (every `ShipStatKey` at 0), and make `shipStats` `return writeShipStats(emptyStats(), ship, profile);`. `writeShipStats` must overwrite **every** key so a reused object cannot keep a stale value.
  - `src/sim/index.ts`: the spec's §6 has `rebuild`/`clear` verbatim; copy them. Add the `liveShipIds: Set<number>` field, hoist `const fx = systemEffects(run.system.modifiers);` out of the ship loop, reuse/create each ship's stats object and call `applyEffects(writeShipStats(st, s, state.profile), fx)`, then delete ids no longer in `run.ships`. Imports become `emptyStats, writeShipStats` from `./ships` and `applyEffects, systemEffects` from `./modifiers`. Import direction stays acyclic.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/index.test.ts tests/stats.test.ts tests/modifiers.test.ts tests/session.test.ts tests/sim.test.ts`. Expected: PASS — including the `clear()` session-swap tests (`session.test.ts`), the nebula index-stats test (`modifiers.test.ts`), and determinism.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/index.test.ts tests/stats.test.ts tests/modifiers.test.ts tests/session.test.ts
git add src/sim/modifiers.ts src/sim/ships.ts src/sim/index.ts tests/index.test.ts tests/stats.test.ts
git commit -m "Reuse ship stats objects and hoist system effects out of the per-ship loop (#13)"
```

---

## Task 7: Pilot scratch reuse (no per-steer vectors)

**Files:**
- Modify: `src/sim/index.ts` (add the `avoid` / `home` scratch fields)
- Modify: `src/sim/pilot.ts` (`steer`, `avoidance`, `droneThink`, `chainTarget`)
- Test: create `tests/pilot.test.ts`

**Interfaces:**
- Consumes: `SimIndex` with `readonly avoid: Vec2` and `readonly home: Vec2`; `TickCtx` from `pilot.ts` (unchanged shape).
- Produces: `function avoidance(ctx, ship, st, dx, dz, ignoreId): number` (module-private; returns `danger` and writes `ctx.index.avoid`). `steer`, `chainTarget`, `droneThink` keep their exported signatures.

- [ ] **Step 1: Write the failing test** in `tests/pilot.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTS } from '../src/sim/assists';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { chainTarget, droneThink, steer, type TickCtx } from '../src/sim/pilot';
import { makeShip } from '../src/sim/ships';

const DT = 1 / 60;

function ctxFor(state: ReturnType<typeof newGame>): TickCtx {
  const index = new SimIndex();
  index.rebuild(state);
  return { state, index, dt: DT, assists: DEFAULT_ASSISTS };
}

describe('pilot scratch reuse', () => {
  it('steer writes its avoidance result into the shared index scratch', () => {
    const state = newGame(1);
    const ctx = ctxFor(state);
    const ship = state.run.ships[0]!;
    state.run.rocks.push(makeRock(state.run, 'ore', 0, { x: ship.pos.x + 40, z: ship.pos.z }, 30, 0));
    ctx.index.rebuild(state);
    const scratch = ctx.index.avoid;
    const st = ctx.index.stats.get(ship.id)!;
    steer(ctx, ship, st, 1, 0, true);
    expect(ctx.index.avoid).toBe(scratch);
    expect(Number.isFinite(ctx.index.avoid.x)).toBe(true);
  });

  it('droneThink writes its home slot into the shared index scratch', () => {
    const state = newGame(1);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 100, z: 0 });
    state.run.ships.push(drone);
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(drone.id)!;
    const scratch = ctx.index.home;
    droneThink(ctx, drone, st);
    expect(ctx.index.home).toBe(scratch);
    expect(Number.isFinite(ctx.index.home.x)).toBe(true);
    expect(Number.isFinite(ctx.index.home.z)).toBe(true);
  });
});

describe('chainTarget', () => {
  it('chains onto the closest fragment inside laser reach', () => {
    const state = newGame(1);
    const ship = state.run.ships[0]!;
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(ship.id)!;
    const near = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range, z: ship.pos.z }, 2, 0);
    const far = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range * 5, z: ship.pos.z }, 2, 0);
    expect(chainTarget(ctx, ship, st, [far, near])).toBe(near.id);
  });

  it('falls back to the nearest rock when no fragment is in reach', () => {
    const state = newGame(1);
    state.run.rocks = [];
    const ship = state.run.ships[0]!;
    const rock = makeRock(state.run, 'ore', 0, { x: ship.pos.x + 50, z: ship.pos.z }, 30, 0);
    state.run.rocks.push(rock);
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(ship.id)!;
    const far = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range * 5, z: ship.pos.z }, 2, 0);
    expect(chainTarget(ctx, ship, st, [far])).toBe(rock.id);
  });
});
```

(Laser tier 1 gives `range` 170, `LASER_RANGE[0]`; a fragment at `range` is inside `range * 1.6`, one at `5 * range` is not.)

- [ ] **Step 2: Run the test and see which fail.** Run `npx vitest run tests/pilot.test.ts`. Expected: the two `pilot scratch reuse` tests **FAIL** with a `TypeError` (`ctx.index.avoid` / `ctx.index.home` is `undefined`). The two `chainTarget` tests pass before and after — regression guards for the `frags.filter` rewrite, not red→green. Say so in the PR.

- [ ] **Step 3: Implement.** The spec's §7 has all four edits. In `src/sim/index.ts` add, next to `stats`:

```ts
  /** Scratch written by `pilot.avoidance`; never read without writing first. */
  readonly avoid = { x: 0, z: 0 };
  /** Scratch written by `pilot.droneThink`; never read without writing first. */
  readonly home = { x: 0, z: 0 };
```

In `src/sim/pilot.ts`: `steer` uses plain `px`/`pz` locals instead of the array destructuring; `avoidance` writes `ax`/`az` into `ctx.index.avoid` and returns `danger` (a `number`), which `steer` uses; `droneThink` writes `home.x`/`home.z` into `ctx.index.home`; `chainTarget` replaces `frags.filter(...)` with the first-minimum-in-reach loop. Do not reuse one scratch object for both purposes — `arrive` → `steer` → `avoidance` overwrites `avoid` while `home` is still needed.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run tests/pilot.test.ts tests/autopilot.test.ts tests/sim.test.ts tests/bot.test.ts`. Expected: PASS — steering and the bot's autopilot behavior are unchanged, and determinism holds.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/pilot.test.ts tests/autopilot.test.ts tests/sim.test.ts
git add src/sim/index.ts src/sim/pilot.ts tests/pilot.test.ts
git commit -m "Reuse SimIndex scratch for avoidance and drone home vectors (#13)"
```

---

## Task 8: Bench delta, GC profile, and the full gate

**Files:** none (no `src/`, `tests/`, or `scripts/` change). Results go in the PR description; this task creates no commit.

**Interfaces:** none.

- [ ] **Step 1: Run the bench and record the delta.** Run `npm run bench`. Expected: it prints one line each of ships/rocks/ticks and `mean … p95 … p99 … ticks/s`. Record the after numbers next to the pre-change baseline in the PR: the controller's baseline is supplied at execution time; a locally observed pre-change run on this branch was **mean 0.0162 ms · p95 0.0216 ms · p99 0.0469 ms · 61163 ticks/s** (7 ships, 196 rocks). This is a micro-optimization; if the delta is inside run-to-run noise, write that plainly and do **not** claim a speedup. Also run `npm run bench` a second time and report the spread so the reader can judge the noise.

- [ ] **Step 2: Acceptance criterion 2 — manual GC-sawtooth check (not verified by CI).** State explicitly in the PR that CI cannot check this. Do the reproducible procedure from the spec's "Acceptance criterion 2" section, on the same machine and Chrome, at the base commit and on the branch: `npm run dev`, new game, click a rock near the station to start idle mining (optionally buy a drone), do not touch input, then DevTools → Performance → Record ≥30 s with no CPU throttling, count the grey **GC / Major GC** chips and whether they recur in a regular sawtooth; then DevTools → Memory → *Allocation instrumentation on timeline* for the same scenario and note the allocation rate (MB/s) and the alloc/collect pattern. Report both runs with the machine and Chrome version. A null result is a valid, honest outcome: the sim is ~0.1 % of a 16.7 ms frame and the renderer (#14–#16) dominates browser-side allocation. A scripted Playwright/CDP measurement was considered and rejected (heavyweight dependency, `scripts/**` file, and a renderer-dominated signal), so it is deliberately not added.

- [ ] **Step 3: Full CI gate.** Run, in order, and confirm each passes:
  - `npm run format:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npx vite build`

- [ ] **Step 4: Confirm no commit is needed.** This task changes no files. If `git status` is dirty with anything other than the controller's uncommitted spec/plan docs, stop and report it rather than committing.

---

## Self-review

- **Spec coverage:** §0/order-preservation → Tasks 3–5 (tests assert the shifted neighbour); §1 `removeItem` → Task 1; §2 spatial-hash pool → Task 2; §3 ship removal + loop safety → Task 3; §4 rock removal → Task 4; §5 pickups → Task 5; §6 stats/effects → Task 6; §7 pilot scratch → Task 7; Exact interfaces → the Interfaces block of each task; Verification strategy (determinism / identity tests / bench / manual GC) → Tasks 3–7's red steps, Task 8. Non-goals and out-of-scope items are constraints, not tasks.
- **Every task is red→green, honestly labelled:** Tasks 1, 2 (identity + pool), 3 (identity), 4 (identity), 5 (identity), 6 (stats reuse), 7 (scratch existence) each contain at least one genuinely failing-first test; the remaining assertions in those tasks are flagged in-line as regression guards that pass before and after.
- **Step scan:** every step yields a file, a test result, or a gate. The two long bodies (`SpatialHash.rebuild`, `updatePickups`) are not retyped here — they are pointed at the spec, which holds them verbatim, so no step merely transcribes code.
- **Type consistency:** `removeItem<T>(arr, item): boolean` (Tasks 1, 3, 4); `emptyStats()` / `writeShipStats(out, ship, profile)` / `applyEffects(st, fx)` (Task 6); `SimIndex.avoid` / `SimIndex.home` (Task 7); `updatePickups(state, index, dt)` (Task 5, consumed by the `tick` call site). `tick`, `shipStats`, `applySystemStats`, `SpatialHash.query` keep their signatures throughout.
- **Review Focus:** each of the five lines names its owning task, and each owning task contains the named test (Task 3 mid-loop death; Tasks 4 and 5 order; Task 6 compounding and pruning; Task 2 stale-cell query).
- **Proportion:** the plan is longer than the spec only because of the required test bodies, signatures and gates; no task retypes an implementation body it can point at.
