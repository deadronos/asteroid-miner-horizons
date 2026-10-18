# Remove per-tick allocations in the sim

- **Date:** 2026-10-18
- **Issue:** #13 — "Remove per-tick allocations in the sim"
- **Status:** Design of record (verified against the current tree; not re-designed)
- **Builds on:** #5 — `docs/superpowers/specs/2026-10-17-sim-index-design.md`
  (`src/sim/index.ts` / `SimIndex` already landed; `tick(state, dt, input, index)`)

## Context / problem

The issue's Context paragraph is **stale**. It describes `new Map` for rocks and
stats plus `[...run.ships]` spreads, but #5 already replaced the two per-tick
`Map`s with the reused `SimIndex.rockById` / `SimIndex.stats` maps, and there is
no `[...run.ships]` spread anywhere in `src/sim`. **Do not re-do #5.**

What is actually left was found by grepping `src/sim` and `src/core` and reading
every hit. Each site below is **verified**, with its true frequency and a
decision. "Per tick" = one allocation/call for every one of the ~3,600 ticks/min
the sim runs at 60 Hz.

| Site | Frequency | Decision |
| --- | --- | --- |
| `spatialHash.ts` `rebuild()` — `cells.set(k, [it])` allocates a fresh array for **every newly-touched cell** | **per tick** (≈40–60 cells at 196 rocks) | **fix** — recycle buckets through a pool |
| `sim/index.ts` `rebuild()` — `shipStats(s, profile)` allocates a `ShipStats` object per ship, plus `systemEffects()` allocates a `SystemEffects` **and** a nested `mix` object per ship | **per ship per tick** (≈21 objects at 7 ships) | **fix** — hoist the effects, write stats in place |
| `sim/update.ts` `updatePickups` — `run.ships.filter(isAlive)` allocates an array + closure | **per tick** | **fix** — drop the snapshot, inline `isAlive` |
| `sim/update.ts` `updatePickups` — `run.pickups.filter(cb)` allocates a new array + closure and reassigns the field | **per tick** | **fix** — in-place compaction |
| `sim/pilot.ts` `steer` — `const [px, pz] = … ? [a, b] : [c, d]` allocates a 2-element array | **per steer** (≈1/ship/tick) | **fix** — plain numbers |
| `sim/pilot.ts` `avoidance` — returns a fresh `{ x, z, danger }` object | **per steer with `assists.avoid`** (on by default) | **fix** — write into a reused scratch `Vec2` |
| `sim/pilot.ts` `droneThink` — `const home = { … }` object | **per drone-think** | **fix** — write into a reused scratch `Vec2` |
| `sim/pilot.ts` `chainTarget` — `frags.filter(...)` allocates an array | **per cracked rock** | **fix** — single nearest-in-reach loop |
| `sim/mining.ts` `destroyRock` — `run.rocks = run.rocks.filter(...)` allocates + reassigns | per cracked rock | **fix** — in-place `removeItem` |
| `sim/ships.ts` `damageShip` — `run.ships = run.ships.filter(...)` allocates + reassigns | per drone death | **fix** — in-place `removeItem` |
| `sim/handlers.ts` `scrap` — `state.run.ships = … .filter(...)` | per scrap command | **fix** — in-place `removeItem` (same helper, consistency) |
| `sim/update.ts` `updateShip` — `ship.pos = { ...station.pos }` | respawn only | leave — event, not steady state |
| `sim/update.ts` `regrowBelts` — `run.system.belts.map(() => 0)` | one regrow every `TUNING.beltRegrowInterval` = 4 s | leave — 1 array / 240 ticks |
| `sim/update.ts` `unload` — `RESOURCES.filter(...).map(...)` | dock only | leave — event; also builds display strings |
| `*.ts` `state.out.fx.push({ t, pos: { ...x.pos } })` | per fx event (collect/crack/dock/impact/explode) | leave — a snapshot the `Fx` type requires; the outbox is drained by the harness each tick and read by the renderer (#14–#16) |
| `sim/ships.ts` `damageShip` — `shipStats(ship, profile)` builds a throwaway `ShipStats` | per damage event | leave — event-driven; passing `index.stats` in would ripple the signature for an event-rate win |
| `sim/update.ts` `collideRocks`, `sim/pilot.ts` `avoidance` / `nearestRock` — the arrow closure passed to `rockHash.query` | per ship per tick (+1 per drone query) | leave — removing it needs a `SpatialHash` visitor API (see #18) or persistent visitor objects; a much larger refactor than this issue |
| `sim/update.ts` `const ctx: TickCtx = { … }` | **per tick** (1 object) | leave — one small short-lived object per tick |
| `sim/contracts.ts` `board.offers.filter(...)` | only when an offer expires | leave — event |

Order of magnitude: ~40–60 arrays/tick from the spatial hash, ~21 objects/tick
from stats, a handful more from pickups/ships/steer — roughly **95–110 small
allocations per tick**, of which this design removes ~75. The remaining ~20 are
closures and the per-tick `TickCtx`, deliberately out of scope.

## Goals

- Remove the per-tick array/object allocations listed above from the steady-state
  tick (idle mining, no commands), so the GC has far less per-tick garbage.
- Keep the tick **behaviorally identical**: same gameplay, same seeded replay,
  same serialized save bytes.
- Reuse the existing owner of non-persisted state (`SimIndex`) for the scratch
  values, so no module-level mutable state is reintroduced (`sim/` must stay free
  of it — #5).
- Keep the change small and reviewable: one core helper, one pooling change in
  `SpatialHash`, in-place removals, and per-tick scratch.

## Non-goals

- **Not re-doing #5.** `rockById` / `stats` are already reused maps.
- **No renderer work.** `src/render/**` is #14/#15/#16. `src/render/shipView.ts`
  keeps its own per-frame `new Map` (#16).
- **No `SpatialHash` API change and no incremental insert/remove** (that is #18).
  `rebuild(items)` and `query(center, radius, fn)` keep their signatures and
  semantics.
- **No save-format change.** `GameState` stays plain JSON; `SimIndex` (including
  its new scratch fields) is never serialized. No new field is added to `Ship`,
  `Rock`, `Pickup` or `Run`.
- **No swap-with-last removal.** See "Design §0" — order-preserving compaction
  only.
- No new dependency, no new `scripts/**` file, no change to the CI workflow.

## Design

### 0. Removal must preserve array order (why not swap-remove)

The issue proposes "swap-remove for dead rocks/pickups". **Rejected.** Swap-remove
reorders the array, and array order is observable in this sim:

- `SpatialHash.rebuild` inserts items in `run.rocks` order, so bucket order (and
  therefore `query` callback order) follows `run.rocks` order.
- `collideRocks` resolves ships against rocks **sequentially**, mutating ship and
  rock velocity each time: a different rock order gives different final
  velocities and positions.
- `nearestRock` / `chainTarget` keep the first minimum on ties, so order decides
  the winner.
- `serialize(state)` is `JSON.stringify(run)`, so array order is literally part of
  the determinism assertion's output.

So the design uses **in-place, order-preserving compaction** everywhere. It is
just as allocation-free as swap-remove, and it cannot change behavior.

Two mechanics: remove one specific element (`removeItem`, used by ships/rocks),
and keep-or-drop every element (`updatePickups`' inline write-index loop).

### 1. `src/core/array.ts` — one in-place removal helper

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

`Array.prototype.splice` is *not* used: it returns the removed elements in a fresh
array, which is exactly the allocation this issue is removing. The shift loop is
O(n) after the index and allocation-free. Sizes are small (≈196 rocks, ≤7 ships),
and it runs on an event, not per element per tick.

### 2. `src/core/spatialHash.ts` — recycle buckets instead of `[it]` per cell

The public API is unchanged. Internally the hash keeps its bucket arrays alive
across rebuilds via a pool, and keeps the `cells` map bounded to the cells
actually in use:

```ts
export class SpatialHash<T extends { pos: Vec2 }> {
  private readonly cells = new Map<number, T[]>();
  /** Buckets detached from the map last rebuild, empty and ready to be refilled. */
  private readonly pool: T[][] = [];
  /** Keys currently in `cells`, so the next rebuild can detach exactly those. */
  private readonly live: number[] = [];

  constructor(private readonly cell = 128) {}
  private key(cx: number, cz: number): number { /* unchanged */ }

  rebuild(items: readonly T[]): void {
    for (const k of this.live) {
      const b = this.cells.get(k);
      if (b) {
        this.cells.delete(k);
        b.length = 0;
        this.pool.push(b);
      }
    }
    this.live.length = 0;
    for (const it of items) {
      const k = this.key(Math.floor(it.pos.x / this.cell), Math.floor(it.pos.z / this.cell));
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = this.pool.pop() ?? [];
        this.cells.set(k, bucket);
        this.live.push(k);
      }
      bucket.push(it);
    }
  }

  query(center: Vec2, radius: number, fn: (item: T) => void): void { /* unchanged */ }
}
```

Steady state (same cells each tick) allocates **nothing**: every bucket is taken
from the pool and returned to it. `cells` still holds exactly the live cells, so
a rock that drifts into a new cell does not grow the map forever. `rebuild([])`
(used by `SimIndex.clear`) returns every bucket to the pool.

### 3. Ship removal + making the tick's ship loop safe

**The pinned correctness trap.** `src/sim/update.ts` iterates
`for (const ship of run.ships)` and `damageShip` currently *reassigns*
`run.ships = run.ships.filter(...)`. The `for…of` iterator holds the array it
captured, so removal-by-reassignment never disturbs iteration — the removed ship
is simply absent from `run.ships` for later guards. Replacing that with an
in-place `removeItem` mutates the array the iterator is walking, so the ship that
shifts down into the freed slot would be **skipped**.

Two coordinated edits make in-place removal safe:

1. `src/sim/ships.ts` `damageShip` (non-flagship branch):
   `run.ships = run.ships.filter((s) => s !== ship)` → `removeItem(run.ships, ship)`.
2. `src/sim/update.ts`, the ship loop becomes index-based and re-checks the slot:

```ts
// Index-based so a ship removed in `updateShip` (an in-place `removeItem`) does
// not shift the next ship into an already-visited slot: after a removal the
// element at `i` is a ship we have not seen, so do not advance.
for (let i = 0; i < run.ships.length; i++) {
  const ship = run.ships[i]!;
  updateShip(ctx, ship, index.stats.get(ship.id)!, input.thrust);
  if (run.ships[i] !== ship) i--;
}
```

Why this is exactly equivalent: the only removal that can happen inside the loop
is the **current** ship (`damageShip` is only ever called with `ship` from
`updateShip`), order is preserved, and elements before `i` are untouched — so
`run.ships[i] !== ship` iff the current ship was removed, in which case the
element now at `i` is the one that followed it and must be visited next.

`src/sim/handlers.ts` `scrap` (line 213) is also converted to
`removeItem(state.run.ships, ship)`. It runs inside `applyCommands`, **before**
the ship loop, and nothing iterates `run.ships` spanning two commands
(`withShip` resolves its ship with `find` first), so it needs no loop guard — but
converting it keeps the pattern uniform and removes another array.

**Loop safety audit (all loops in `src/sim` that can see a removal):**

| Loop | Can a removal happen while it runs? | Safe because |
| --- | --- | --- |
| `tick` ship loop (`update.ts:65`) | yes — `damageShip` on the current ship | index loop + identity re-check (above) |
| rock orbit loop (`update.ts:46`) | no | runs before the ship loop |
| `SimIndex.rebuild` rock/ship loops (`index.ts`) | no | pure reads; runs before the ship loop |
| `collideRocks` / `nearestRock` `rockHash.query` callbacks | no — they never destroy a rock; `rockById` guards stale buckets | unchanged |
| `updatePickups` pickup loop | it *is* the removal | inline compaction; iterates nothing else |
| `updatePickups` ship scan | no | reads `run.ships` only |
| `regrowBelts` rock count loop (`update.ts:231`) | no | the `push`/`pop` happens in the later `belts.forEach` |
| `droneThink` pickup scan (`pilot.ts:217`) | no | `updatePickups` runs after the ship loop |

`removeItem` is *not* used where a loop is walking the same array mid-flight
without a guard; `destroyRock`'s in-place removal of a rock happens inside the
ship loop (never a `run.rocks` loop) or from a test.

### 4. Rock removal — `src/sim/mining.ts`

```ts
run.rocks = run.rocks.filter((r) => r !== rock);
```
becomes
```ts
removeItem(run.rocks, rock);
```
`destroyRock` then pushes the fragments onto `run.rocks` as before, so the
resulting order is identical to filter-then-push. `regrowBelts`'
`spawnBeltRock(...)` + `run.rocks.pop()` pair is unchanged and still correct:
`pop` removes the rock `spawnBeltRock` just appended.

### 5. Pickups — `src/sim/update.ts`

`updatePickups(state, stats, dt)` becomes `updatePickups(state, index, dt)` and
replaces the `live` array and the `filter` with an inline write-index compaction.
It reads `index.stats` instead of the passed map; the predicate's body is
otherwise unchanged, and the callback's two `return false` cases become
`continue`:

```ts
function updatePickups(state: GameState, index: SimIndex, dt: number): void {
  const { run } = state;
  const stats = index.stats;
  const drag = damp(0.8, dt);
  const pickups = run.pickups;
  let kept = 0;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i]!;
    p.age += dt;
    if (p.age > TUNING.pickupLifetime) continue; // dropped: age > lifetime
    p.vel.x *= drag;
    p.vel.z *= drag;

    let best: Ship | null = null;
    let bestD = Infinity;
    for (const s of run.ships) {
      if (!isAlive(s)) continue; // was `const live = run.ships.filter(isAlive)`
      const st = stats.get(s.id)!;
      const d = dist(s.pos, p.pos);
      if (d < st.magnet && d < bestD && cargoFree(s, st) > 0.01) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      const st = stats.get(best.id)!;
      const pull = TUNING.tractorSpeed * (0.4 + 0.6 * (1 - bestD / st.magnet));
      p.vel.x = best.vel.x + ((best.pos.x - p.pos.x) / bestD) * pull;
      p.vel.z = best.vel.z + ((best.pos.z - p.pos.z) / bestD) * pull;
      if (bestD < TUNING.pickupCollectRadius + st.size) {
        const take = Math.min(cargoFree(best, st), p.amount);
        best.cargo[p.kind] += take;
        p.amount -= take;
        state.out.fx.push({ t: 'collect', pos: { ...best.pos }, kind: p.kind, amount: take, shipId: best.id });
        if (p.amount <= 1e-6) continue; // consumed: dropped
      }
    }
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    pickups[kept++] = p;
  }
  pickups.length = kept;
}
```

Equivalence: `run.ships` is not modified during `updatePickups`, so testing
`isAlive` per candidate is the same set as the old one-shot `live` snapshot;
order is preserved; the mutations happen in the same order; `pickups.length =
kept` leaves the array identity untouched. `run.pickups` is never reassigned
again.

### 6. `SimIndex.rebuild` — hoist the effects, write stats in place

Two changes remove all 3 per-ship objects:

- `src/sim/modifiers.ts` gains `applyEffects(st, fx)` (the body `applySystemStats`
  already has); `applySystemStats(st, system)` becomes
  `applyEffects(st, systemEffects(system.modifiers))`. Existing callers
  (`modifiers.ts` tests, `ui/panels/ShipPanel.ts`) are unchanged.
- `src/sim/ships.ts` gains `emptyStats()` and `writeShipStats(out, ship, profile)`
  — the exact body of today's `shipStats`, writing into `out` instead of a fresh
  literal. `shipStats(ship, profile)` becomes
  `writeShipStats(emptyStats(), ship, profile)`, so its signature and behavior are
  unchanged for every existing caller.

`SimIndex` keeps one stats object per ship id **across ticks** and prunes ids that
are gone. `stats` is therefore no longer `clear()`-ed each rebuild — it is
reconciled:

```ts
readonly stats = new Map<number, ShipStats>();
private readonly liveShipIds = new Set<number>();

rebuild(state: GameState): void {
  const { run } = state;
  this.rockHash.rebuild(run.rocks);
  this.rockById.clear();
  for (const r of run.rocks) this.rockById.set(r.id, r);

  const fx = systemEffects(run.system.modifiers); // once per tick, not per ship
  this.liveShipIds.clear();
  for (const s of run.ships) {
    this.liveShipIds.add(s.id);
    let st = this.stats.get(s.id);
    if (!st) this.stats.set(s.id, (st = emptyStats()));
    applyEffects(writeShipStats(st, s, state.profile), fx);
  }
  // A scrapped or destroyed ship's entry must not linger for the whole run.
  for (const id of this.stats.keys()) if (!this.liveShipIds.has(id)) this.stats.delete(id);
}

clear(): void {
  this.rockHash.rebuild([]);
  this.rockById.clear();
  this.stats.clear();
  this.liveShipIds.clear();
}
```

Because `writeShipStats` overwrites every `ShipStatKey` before `applyEffects`
multiplies `magnet`, the reused object cannot compound the system magnet effect
across ticks, and a reused entry cannot go stale. `shipStats` is still the
authority used by tests/UI/damage; the index just avoids re-allocating.

### 7. `src/sim/pilot.ts` — scratch instead of per-steer vectors

- `steer`: replace the destructuring ternary with plain locals:
  ```ts
  const sp = len(ship.vel);
  let px: number;
  let pz: number;
  if (sp > 30) {
    px = ship.vel.x / sp;
    pz = ship.vel.z / sp;
  } else {
    const w = Math.hypot(wx, wz);
    px = wx / w;
    pz = wz / w;
  }
  ```
  (Only reached when `want > 1e-6`, so `Math.hypot(wx, wz) > 0`.)
- `avoidance(ctx, ship, st, dx, dz, ignoreId)` now returns `number` (`danger`) and
  writes its correction into `ctx.index.avoid` instead of returning a fresh
  object:
  ```ts
  ctx.index.avoid.x = ax;
  ctx.index.avoid.z = az;
  return danger;
  ```
  `steer` reads `ctx.index.avoid.x/.z` where it used `a.x` / `a.z`. `avoidance`
  is called once per `steer` and never re-entrantly (it only calls
  `rockHash.query`), so a single shared scratch is safe.
- `droneThink` writes its home slot into `ctx.index.home` instead of a literal:
  ```ts
  const home = ctx.index.home;
  home.x = anchor.x + Math.cos(slot) * 70;
  home.z = anchor.z + Math.sin(slot) * 70;
  ```
  `home` is read inside `arrive` (which converts it to `dx, dz` immediately) and
  is never retained. It must be a **different** object from `avoid`, because
  `arrive` → `steer` → `avoidance` overwrites `avoid` between the write and later
  reads of `home` in the same `droneThink`.
- `chainTarget` drops the `frags.filter(...)` array:
  ```ts
  let best: Rock | null = null;
  let bestD = Infinity;
  for (const f of frags) {
    const d = dist(f.pos, ship.pos);
    if (d < st.range * 1.6 && d < bestD) {
      best = f;
      bestD = d;
    }
  }
  if (best) return best.id;
  return nearestRock(ctx, ship.pos, st.range * 1.2, () => true)?.id ?? null;
  ```
  (`<` keeps the first minimum on ties, matching the old `reduce`'s `a` on `<=`.)

The two scratch fields live on `SimIndex` (the session's owner of non-persisted
state) so no module-level mutable state returns to `sim/`. They hold only numbers,
so `rebuild`/`clear` do not need to reset them: every use writes before it reads.

## Exact interfaces

```ts
// src/core/array.ts  (new)
export function removeItem<T>(arr: T[], item: T): boolean;

// src/core/spatialHash.ts  (public API unchanged)
export class SpatialHash<T extends { pos: Vec2 }> {
  constructor(cell?: number);
  rebuild(items: readonly T[]): void;
  query(center: Vec2, radius: number, fn: (item: T) => void): void;
}

// src/sim/ships.ts
export function emptyStats(): ShipStats;
export function writeShipStats(out: ShipStats, ship: Ship, profile: Profile): ShipStats;
export function shipStats(ship: Ship, profile: Profile): ShipStats; // unchanged behavior

// src/sim/modifiers.ts
export function applyEffects(st: ShipStats, fx: SystemEffects): ShipStats;
export function applySystemStats(st: ShipStats, system: StarSystem): ShipStats; // unchanged

// src/sim/index.ts
export class SimIndex {
  readonly rockHash: SpatialHash<Rock>;
  readonly rockById: Map<number, Rock>;
  readonly stats: Map<number, ShipStats>;
  /** Scratch written by `pilot.avoidance`; never read without writing first. */
  readonly avoid: Vec2;
  /** Scratch written by `pilot.droneThink`; never read without writing first. */
  readonly home: Vec2;
  rebuild(state: GameState): void;
  clear(): void;
}

// src/sim/update.ts
export function tick(state: GameState, dt: number, input: TickInput, index: SimIndex): void; // unchanged
// internal only:
function updatePickups(state: GameState, index: SimIndex, dt: number): void;

// src/sim/pilot.ts
function avoidance(ctx: TickCtx, ship: Ship, st: ShipStats, dx: number, dz: number, ignoreId: number | null): number;
export function steer(ctx: TickCtx, ship: Ship, st: ShipStats, wx: number, wz: number, avoid?: boolean, ignoreId?: number | null): void; // unchanged
export function chainTarget(ctx: TickCtx, ship: Ship, st: ShipStats, frags: Rock[]): number | null; // unchanged
export function droneThink(ctx: TickCtx, ship: Ship, st: ShipStats): void; // unchanged
```

## Verification strategy

### Determinism (existing, primary gate)

`tests/sim.test.ts` → `describe('determinism')` replays `newGame(42)` twice for
20 sim-seconds and asserts `serialize(a) === serialize(b)`. Every task keeps it
green. Because `serialize` includes the rock/ship/pickup arrays verbatim, this
also guards the order-preserving requirement of §0: a reorder would move bytes.

### Mechanism (identity) tests — the honest way to test an internal refactor

These changes have almost no behavior-observable surface, so the plan pins the
*mechanism* — the thing the issue is actually about — with identity assertions.
Each is genuinely failing-first:

- `SpatialHash`: after two rebuilds of the same cell, the bucket object read back
  from the (private) map is the **same array instance**; after 50 rebuilds the
  pool is empty and the map holds one key. (Before: `rebuild` sets `[it]`, a new
  array each time → red.)
- `damageShip` / `destroyRock` / `updatePickups`: the array **identity** of
  `run.ships` / `run.rocks` / `run.pickups` survives the removal. (Before: each
  reassigns via `filter` → red.)
- `SimIndex.rebuild`: the same `ShipStats` object is returned for a ship across
  rebuilds, and an entry for a ship that left `run.ships` is deleted.
- `pilot`: `index.avoid` / `index.home` exist, are reused (same object before and
  after the call) and are written with finite numbers.
  (`avoidance`'s and `steer`'s own behavior tests are also included, but they pass
  before and after — they are regression guards, not red→green. The plan says so
  at each such step.)

Plus behavior guards for the semantics that in-place removal could break if the
loop were wrong, which the identity tests do not cover:

- **Mid-tick ship death:** a tick with a drone that dies from star heat must still
  update the drone that sat **after** it in `run.ships` (assert its hull dropped).
  With a naive in-place removal and no loop guard the loop ends early and that
  drone is skipped.
- **Stale hash buckets:** query after a rebuild that dropped a cell must not
  return the old items.
- **Dead ships are not pickup magnets:** with `live` gone, a `respawn > 0` ship
  must not pull a nearby pickup.

Where a step's test passes before and after (a regression guard), the plan says so
and does not present it as evidence of a new capability — the same honesty rule the
#5 plan used.

### Performance (bench) — a micro-optimization, reported honestly

`npm run bench` (`scripts/bench.ts`) is the measurement: mean/p95/p99 ms per tick
over 10 simulated minutes with a full fleet. Locally observed on this branch
before any change (7 ships, 196 rocks):

```
mean 0.0162 ms · p95 0.0216 ms · p99 0.0469 ms · 61163 ticks/s
```

The controller captured its own pre-change baseline and supplies it at execution
time; the final task re-runs the bench and records the delta in the PR. CI runs
`npm run bench -- --json bench.json` **warn-only**, so the bench cannot gate.

**Honesty caveat.** This removes ~75 small, short-lived objects per tick — real
GC pressure, but a mean of 0.016 ms/tick is ~0.1 % of a 16.7 ms frame. The
expected `meanMs` delta is **small and may be inside run-to-run noise**. If the
after-run is not measurably better, report that plainly; do **not** claim a
speedup. The defensible outcomes are the allocation reduction (identity tests) and
the GC-sawtooth check below.

### Acceptance criterion 2 ("no steady GC sawtooth during idle mining") — manual, not CI

**CI cannot verify this and the plan does not pretend it does.** The sim runs at
60 Hz alongside a Three.js renderer, so a browser profile attributes most of the
main-thread work (and most of the allocation) to rendering, which is #14–#16. The
reproducible manual procedure, run **before** (base commit) and **after** on the
same machine:

1. `npm run dev`, open the printed URL in Chrome.
2. Start a new game and click a rock near the station so the flagship has a mine
   order; optionally buy a Mining Drone. Then do not touch the input.
3. DevTools → **Performance** → ensure no CPU throttling → Record for ≥30 s while
   idle-mining → Stop.
4. Read the main-thread track: count the grey **GC / Major GC** chips and note
   whether they recur in a regular sawtooth (e.g. one every few seconds).
5. DevTools → **Memory** → *Allocation instrumentation on timeline* → Record the
   same scenario; note the steady allocation rate (MB/s) and the alloc/collect
   pattern.
6. Record both before/after in the PR with the machine and Chrome version. A
   null result (no visible change) is a **valid, honest** outcome to report,
   because the sim is a tiny fraction of the frame.

A scripted Playwright/CDP heap measurement was considered and **rejected**: it
adds a heavyweight dependency and a `scripts/**` file, both outside this issue's
scope, to measure a signal dominated by the renderer, which this issue does not
touch.

## Risks / migration notes

- **Iteration semantics (highest risk).** In-place removal changes what a running
  `for…of` sees. Mitigated by the index loop + identity re-check in §3, the loop
  audit table, and the mid-tick-death test. Reviewers should treat any other loop
  that both iterates a run array and can remove from it as a bug.
- **Order preservation.** Swap-remove was rejected (§0). The plan's tests assert
  the shifted neighbour lands in the freed slot, and determinism covers the rest.
- **Stats map lifetime.** `stats` now survives between ticks and is pruned by id.
  If a caller ever held a `ShipStats` object and compared it across ticks, it now
  sees the same mutated object; no caller does (all reads are within one tick).
  `clear()` still empties it for the #5 session-swap test.
- **Reused stats compounding.** `writeShipStats` rewrites every key, so
  `applyEffects`'s `magnet *=` cannot compound. Pinned by a double-rebuild test.
- **`removeItem` cost.** O(n) shift per removal; n ≤ ~196 and removals are events.
  Negligible against the per-tick savings.
- **No save impact.** No new serialized field; `SimIndex` and its scratch are
  transient. The existing save round-trip test is the guard.
- **Signature ripple is tiny.** Only the internal `updatePickups` changes
  parameters; `tick`, `shipStats`, `applySystemStats`, `SpatialHash` keep their
  public signatures, so no call site outside `src/sim/` changes.

## Out of scope

- **#14 / #15 / #16** — `src/render/**`, including `shipView.ts`'s per-frame
  `new Map` (#16).
- **#18** — incremental `SpatialHash` insert/remove and any `query` visitor API
  that would remove the per-tick closures.
- `scripts/**` (so no new allocation/GC measuring script), `.github/**`, and any
  new dependency.

## Conflicts with the issue / open questions

Recorded faithfully; the divergences are deliberate:

1. **"swap-remove" rejected.** The issue proposes swap-remove for dead
   rocks/pickups; this design uses order-preserving compaction because array order
   changes collision resolution, tie-breaks and serialized output (§0).
2. **The issue's Context is stale.** The per-tick `new Map`s it names were already
   removed by #5; this design targets what actually remains (verified in the table
   above). Re-doing #5 is explicitly out of scope.
3. **"reuse scratch objects for vectors" extended.** The scratch lives on
   `SimIndex` (`avoid`, `home`) rather than at module level, because #5 requires
   `sim/` to hold no module-level mutable state.
4. **Closures left in place.** The per-tick `rockHash.query` arrow closures are
   the largest remaining per-tick allocation this design does *not* remove;
   removing them needs a `SpatialHash` API change (#18) or persistent visitor
   objects. Called out so the remaining GC pressure is not a surprise and the
   bench result is interpreted honestly.
5. **No perf baseline file in-repo.** As in the #5 spec: there is no committed
   baseline; the before/after bench numbers are captured locally by the
   implementer (and the controller's baseline), not diffed against a repo file.
