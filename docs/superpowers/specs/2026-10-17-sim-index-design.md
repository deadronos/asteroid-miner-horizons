# Replace module-level rockHash and per-tick index rebuilds with a World index

- **Date:** 2026-10-17
- **Issue:** #5 — "Replace module-level rockHash and per-tick index rebuilds with a World index"
- **Status:** Approved design (recorded, not re-designed)

## Context / problem

`src/sim/update.ts` owns a module-level `SpatialHash` singleton:

```ts
const rockHash = new SpatialHash<Rock>(128); // line 30
```

Every `tick` rebuilds it (`rockHash.rebuild(run.rocks)`, line 54) and additionally
constructs two throwaway collections per tick:

- `rockById = new Map(run.rocks.map((r) => [r.id, r]))` (line 61) — a fresh
  `Map` (and a fresh intermediate array) over every rock, every tick.
- `stats = new Map<number, ShipStats>()` (line 56) — a fresh `Map` filled by
  calling `shipStats` for every ship, every tick.

`TickCtx` (`src/sim/pilot.ts`) then carries `rockHash`, `rockById` and `stats`
as three separate fields, so pilot code reads `ctx.rockHash` / `ctx.rockById`
directly. The module-level singleton is mutable state living in `sim/`, and it
is the only reason two `update.ts` imports could ever share anything.

Two consequences:

1. **Structural:** `sim/` holds module-level mutable state.
2. **Performance:** three allocations/rebuilds per tick instead of one owned
   object reused across ticks (~3,600 ticks/min at the 60 Hz sim rate).

## Goals

- Remove all module-level mutable state from `src/sim/`.
- Give the session an explicit, non-persisted owner (`SimIndex`) for derived
  per-tick structures.
- Reuse the same `Map`/`SpatialHash` instances across ticks via `clear()` +
  refill rather than reallocating.
- Keep the tick deterministic and keep `tick` a pure-ish function of
  `(state, dt, input, index)`.

## Non-goals

- **`src/render/shipView.ts` line 199** builds its own
  `new Map(run.rocks.map(...))` every frame. That is **issue #16**, not #5.
- **Incremental hash maintenance.** `SpatialHash` only exposes `rebuild()` and
  `query()`; adding `insert`/`remove` is **issue #18**. `SimIndex.rebuild` calls
  the existing full `rebuild`.
- No save-format change: `SimIndex` is transient and never serialized.
- No change to `applyCommands`, which is also called while paused and needs no
  index.

## Design

### 1. New `src/sim/index.ts`

A plain class owning the three derived structures. Import direction is
`index.ts -> ships.ts -> data/*` (plus `core/spatialHash.ts` and `sim/types.ts`);
`update.ts -> index.ts`. `index.ts` must **not** import `pilot.ts` or `update.ts`,
or a cycle appears (`pilot.ts` imports the `SimIndex` type).

```ts
// src/sim/index.ts
import { SpatialHash } from '../core/spatialHash';
import { shipStats, type ShipStats } from './ships';
import type { GameState, Rock } from './types';

/**
 * Per-session derived state. Not persisted: it is rebuilt from GameState every
 * tick and holds references into the current run's rocks/ships.
 */
export class SimIndex {
  readonly rockHash = new SpatialHash<Rock>(128);
  readonly rockById = new Map<number, Rock>();
  readonly stats = new Map<number, ShipStats>();

  /** Rebuild all three structures for `state`, reusing the same instances. */
  rebuild(state: GameState): void {
    const { run } = state;
    this.rockHash.rebuild(run.rocks);
    this.rockById.clear();
    for (const r of run.rocks) this.rockById.set(r.id, r);
    this.stats.clear();
    for (const s of run.ships) this.stats.set(s.id, shipStats(s, state.profile));
  }

  /** Drop every reference; used when the running game is swapped. */
  clear(): void {
    this.rockHash.rebuild([]);
    this.rockById.clear();
    this.stats.clear();
  }
}
```

`rebuild` keeps the *same* `Map` instances (only `clear()` + refill), so no
`Map` is allocated per tick.

### 2. `src/sim/update.ts`

- Delete line 30 (`const rockHash = ...`) and the `SpatialHash` import.
- New signature:

```ts
export function tick(state: GameState, dt: number, input: TickInput, index: SimIndex): void
```

- Replace `rockHash.rebuild(run.rocks)` and the two per-tick constructions
  (`stats`, `rockById`) with a single `index.rebuild(state)` at the same point
  in the order of operations (after rock orbits, before the ship loop).
- The `TickCtx` literals become:

```ts
const ctx: TickCtx = { state, index, dt, assists: input.assists ?? DEFAULT_ASSISTS };
```

- The ship loop reads `index.stats.get(ship.id)!`; `updatePickups` continues to
  receive the stats `Map` (`index.stats`) or is changed to take `index`.

### 3. `src/sim/pilot.ts`

`TickCtx` collapses from three carried structures to one owner:

```ts
export interface TickCtx {
  state: GameState;
  index: SimIndex;
  dt: number;
  assists: Assists;
}
```

Call sites become `ctx.index.rockHash` and `ctx.index.rockById`
(~6 edits: `avoidance` line 39–40, `workRock` line 145, `nearestRock` line
152–153, `runOrder` line 180, `droneThink` lines 232 and 234).

### 4. Ownership and reset points (`src/session.ts`)

`GameSession` is the owner because it already owns the running `GameState`:

```ts
readonly sim = new SimIndex();
```

`switchTo` and `newGame` both replace `this.running`; each calls
`this.sim.clear()` right after, via a tiny private `clearIndex()` helper, so the
previous run's rock/ship references can be collected. Correctness does **not**
depend on this reset, because `rebuild` runs at the top of every tick before any
consumer reads the index. The reset exists only so that a session which is never
ticked again (paused, then the tab left open) does not retain the old run's
rocks and ships indefinitely.

### 5. Call sites

- `src/main.ts`: `tick(state, STEP, { thrust, commands, assists }, session.sim)`.
- Tests `tests/sim.test.ts`, `tests/settings.test.ts`, `tests/autopilot.test.ts`:
  each holds one `SimIndex` and threads it through its `tick` calls.
- Scripts: `scripts/harness.ts` holds one `SimIndex` (`runBot` calls `tick`);
  `scripts/bench.ts` runs through `runBot`, so it needs no direct change.

## Exact interfaces

```ts
// src/sim/index.ts
export class SimIndex {
  readonly rockHash: SpatialHash<Rock>;
  readonly rockById: Map<number, Rock>;
  readonly stats: Map<number, ShipStats>;
  rebuild(state: GameState): void;
  /** Drop every reference (used when the running game is swapped). */
  clear(): void;
}

// src/sim/update.ts
export function tick(state: GameState, dt: number, input: TickInput, index: SimIndex): void;

// src/sim/pilot.ts
export interface TickCtx {
  state: GameState;
  index: SimIndex;
  dt: number;
  assists: Assists;
}
```

## Verification strategy

### Determinism (existing)

`tests/sim.test.ts` → `describe('determinism')` replays `newGame(42)` twice for
20 sim-seconds and asserts `serialize(a) === serialize(b)`. The `run` helper
gains one `SimIndex`; the assertion is unchanged. This must stay green.

### Two independent games (regression guard, NOT red->green)

Add a test that creates two `GameState`s, ticks them **interleaved** each with
its own `SimIndex`, and asserts the result equals ticking each to completion
separately.

> **Honesty caveat.** The acceptance criterion "Two games can be ticked in one
> process independently" is **already true today**: `rockHash` is rebuilt at the
> top of every `tick` from that tick's `state`, and JavaScript is
> single-threaded, so interleaving two games already works. This test therefore
> **passes before and after** the change — it is a regression guard, not a
> failing-first test. Do not present it as evidence of a new capability.

### Performance (bench, not a unit test)

The genuine outcomes of #5 are (a) structural — no module-level mutable state
in `sim/`; and (b) performance — two fewer `Map` allocations per tick. The
performance claim is evidenced by the headless bench, **not** by a unit test:

```sh
npm run bench          # prints mean/p95/p99 ms per tick
npm run bench -- --json bench.json
```

Run it **before and after** the change and compare `meanMs` / `p95Ms` /
`ticksPerSec`. CI already runs `npm run bench -- --json bench.json` warn-only
(`.github/workflows/ci.yml`). Because this is a micro-optimization of allocation
count, the delta may be small or within run-to-run noise; if it is not
measurable, report that honestly rather than claiming a speedup. No
wall-clock/sim-time assertion is added to the unit suite.

## Risks / migration notes

- **Signature ripple.** `tick` gains a required 4th parameter. This touches
  3 test files and `scripts/harness.ts` (the only place scripts call `tick`).
  The compiler finds every site; typecheck is the safety net.
- **`stats` caching nuance.** The issue proposal says stats are "cached … and
  invalidated on refit or perk change". The approved design deliberately does
  **not** do that: refits and perk purchases arrive as commands and are applied
  at the *start* of the tick (`applyCommands`), so stats are recomputed in the
  same tick's `rebuild`. Keeping a per-tick rebuild avoids a whole
  invalidation/invalidation-cascade surface and preserves determinism. The
  `stats` field is thus a reused map, not a semantic cache.
- **Maps vs. JSON.** `GameState` remains plain JSON (`types.ts`); `SimIndex` is a
  separate class, never serialized, so save/load is unaffected.
- **`rockById` maintenance.** The issue text says "maintained on add/remove",
  but the approved design refills it inside `rebuild` every tick (rocks also
  spawn via belt regrowth and fragments). This is intentional and simpler;
  incremental add/remove bookkeeping is out of scope (#18).

## Out of scope

- **#16** — `src/render/shipView.ts` (~line 199) allocates its own
  `new Map(run.rocks.map(...))` each frame; unchanged here.
- **#18** — incremental `SpatialHash` insert/remove; `SimIndex` uses the existing
  full `rebuild()`.

## Conflicts with the approved design / open questions

Recorded faithfully; do not silently deviate:

1. **"baseline report" not committed.** The task brief says the repo has a
   "baseline report". There is no committed perf baseline file (`glob
   **/*baseline*` and docs search find none); `docs/balance.md` is a *balance*
   report, and `bench.json` is generated at CI runtime. The before/after bench
   numbers must be captured locally by the implementer, since there is nothing
   in-repo to diff against.
2. **`reset()` ownership — RESOLVED during spec review.** The approved design
   named a `reset()` but did not say who owns it or what it clears. Resolved:
   `SimIndex` gains `clear()`, and `GameSession` (`src/session.ts`) calls
   `this.sim.clear()` from `switchTo` and `newGame` after replacing
   `this.running`. See sections 1 and 4. This adds one method beyond the original
   point 1. It does not affect correctness (rebuild runs every tick).
3. **Issue vs. approved design on maintenance.** The issue proposes an
   id→rock map "maintained on add/remove" and stats "invalidated on refit or
   perk change"; the approved design rebuilds both in `rebuild()` each tick.
   The approved design wins; noted so the divergence is explicit.
4. **Path case.** The brief says `src/render/ShipView.ts`; the actual file is
   `src/render/shipView.ts` (lowercase `s`). Cosmetic only.
