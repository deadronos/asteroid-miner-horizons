# Command Handler Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `applyCommand`'s three `if` blocks, `switch` and trailing refit block into one named handler per `Command` variant, dispatched through an exhaustive `handlers` map keyed by `Command['t']`, with zero behaviour change.

**Architecture:** A new `src/sim/handlers.ts` owns the `Handler`/`Handlers` mapped types, `export const handlers`, the moved helpers (`fail`, `refund`, `clampToStats`, `slotTarget`) and a `withShip` wrapper for the eleven ship-scoped commands. `src/sim/commands.ts` keeps the `Command` union and shrinks to a thin `applyCommand` doing one indexed lookup. `handlers.ts` imports `Command` via `import type` (erased), so the runtime edge is one-way `commands.ts → handlers.ts`; `update.ts`/`applyCommands` are untouched.

**Tech Stack:** TypeScript, Three.js, Vite, vitest, oxlint/oxfmt

**Spec:** No separate spec — this plan is the design of record for issue #7.

## Global Constraints

- **Behaviour-preserving.** Every effect, guard, log line, refund and clamp is copied verbatim. Invalid commands stay warn-and-return; a command for a missing ship stays a silent no-op (no log).
- **`Command` stays exported from `src/sim/commands.ts`** (imported from there by `src/input.ts`, `src/main.ts`, `src/ui/Hud.ts`, `src/ui/panels/context.ts`, `src/sim/update.ts`, `scripts/harness.ts`, `scripts/bot.ts`, tests). Do not move it.
- **`applyCommands` (in `update.ts`) must NOT change.** **No new dependencies.**
- **Cycle rule:** `handlers.ts` may import only `import type { Command }` from `commands.ts` (erased), never a value. Verified: `commands.ts → handlers` (value), `handlers.ts → ./economy`, `./ships`, `./create`, `data/*`, `core/vec`, `./types` (values) + `Command` (type); neither imports `update.ts`. No runtime cycle.

## Review Focus

Failure modes this refactor can introduce that a happy-path test misses, most-likely-first; each is owned by a task's test.

1. **A dropped early-return, so an invalid command throws (or mutates) instead of logging a warning.** `mine` with no laser and `install` under-funded call `fail` and return today. **Task 3** asserts `{ level: 'warn' }` + no throw + unchanged state.
2. **`aiMode`/`stop` order-sensitivity.** `stop` clears `order` **and** `aiTargetId`; `aiMode` sets `aiMode`, clears `aiTargetId`, but **leaves `order`**. Reordering extracts silently changes AI. **Task 1** (`stop`/`aiMode` tests) pins both.
3. **A refit that skips `refitBlock`** (dock/alive validation) or fails to `clampToStats`. **Task 3** asserts an un-docked `install` is rejected and hull is re-clamped after `remove`.
4. **A missing ship no longer silent.** **Task 3** asserts no throw and no log for `shipId: 999`.

## Task 1: Handler map + dispatch (all 14 variants), tests first

**Files:** Create `src/sim/handlers.ts`; modify `src/sim/commands.ts` (keep `Command` + `applyCommand` only); Test: create `tests/commands.test.ts`.

**Interfaces:**
- Consumes: `type Command` from `./commands`; the moved helpers/list gained by callers listed in the cycle rule.
- Produces: `export type Handler<K extends Command['t']> = (state: GameState, cmd: Extract<Command, { t: K }>) => void;` · `export type Handlers = { [K in Command['t']]: Handler<K> };` · `export const handlers: Handlers;` · in `commands.ts`, `export function applyCommand(state: GameState, cmd: Command): void`.

- [ ] **Step 1: Write the characterization suite** in `tests/commands.test.ts` — one test per variant (14), all through the public `applyCommand` seam (the map is exported; direct use is proven in Task 2).

```ts
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { applyCommand, type Command } from '../src/sim/commands';
import { flagship, makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';

const send = (s: GameState, c: Command): void => applyCommand(s, c);
const fs1 = () => { const s = newGame(1); return { s, fs: flagship(s.run) }; };

describe('command handlers', () => {
  it('select', () => { const { s, fs } = fs1(); s.run.selectedId = 0; send(s, { t: 'select', shipId: fs.id }); expect(s.run.selectedId).toBe(fs.id); });
  it('move', () => { const { s, fs } = fs1(); send(s, { t: 'move', shipId: fs.id, to: { x: 5, z: 6 } }); expect(fs.order).toEqual({ kind: 'move', to: { x: 5, z: 6 } }); });
  it('mine', () => { const { s, fs } = fs1(); send(s, { t: 'mine', shipId: fs.id, rockId: s.run.rocks[0]!.id }); expect(fs.order).toEqual({ kind: 'mine', rockId: s.run.rocks[0]!.id }); });
  it('dock', () => { const { s, fs } = fs1(); send(s, { t: 'dock', shipId: fs.id }); expect(fs.order).toEqual({ kind: 'dock' }); });
  it('stop clears order + ai target', () => { const { s, fs } = fs1(); fs.order = { kind: 'dock' }; fs.aiTargetId = 7; send(s, { t: 'stop', shipId: fs.id }); expect(fs.order).toBeNull(); expect(fs.aiTargetId).toBeNull(); });
  it('aiMode sets mode, clears ai target, keeps order', () => { const { s, fs } = fs1(); fs.order = { kind: 'dock' }; fs.aiTargetId = 7; send(s, { t: 'aiMode', shipId: fs.id, mode: 'auto' }); expect(fs.aiMode).toBe('auto'); expect(fs.aiTargetId).toBeNull(); expect(fs.order).toEqual({ kind: 'dock' }); });
  it('install', () => { const { s, fs } = fs1(); s.run.bank.ore = 1000; send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' }); expect(fs.slots[2]).toEqual({ type: 'shield', tier: 1 }); });
  it('upgrade', () => { const { s, fs } = fs1(); s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0 }; send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' }); send(s, { t: 'upgrade', shipId: fs.id, slot: 2 }); expect(fs.slots[2]!.tier).toBe(2); });
  it('remove', () => { const { s, fs } = fs1(); s.run.bank.ore = 1000; send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' }); send(s, { t: 'remove', shipId: fs.id, slot: 2 }); expect(fs.slots[2]).toBeNull(); });
  it('repair', () => { const { s, fs } = fs1(); fs.hull = 50; s.run.bank.ore = 1000; send(s, { t: 'repair', shipId: fs.id }); expect(fs.hull).toBeGreaterThan(50); });
  it('buyHull', () => { const s = newGame(1); s.run.bank = { ore: 1000, ice: 1000, crystal: 0 }; const n = s.run.ships.length; send(s, { t: 'buyHull', hullId: 'drone' }); expect(s.run.ships.length).toBe(n + 1); });
  it('scrap', () => { const s = newGame(1); const d = makeShip(s.run, s.profile, 'drone', 'Drone-9', { ...s.run.system.station.pos }); s.run.ships.push(d); send(s, { t: 'scrap', shipId: d.id }); expect(s.run.ships).not.toContain(d); });
  it('buyPerk', () => { const s = newGame(1); s.profile.data = 5; send(s, { t: 'buyPerk', perk: 'optics' }); expect(s.profile.perks.optics).toBe(1); expect(s.profile.data).toBe(4); });
  it('warp', () => { const s = newGame(1); s.run.bank.ice = 1000; send(s, { t: 'warp' }); expect(s.profile.warps).toBe(1); expect(s.run.system.number).toBe(2); });
});
```

Spec values: `perkCost(optics, 0) = 1` (`data/perks.ts`); `warpCost` at 0 warps = 250 ice (`tuning.ts`); the Prospector starts docked with a tier-1 laser (`data/hulls.ts`, `create.ts`), so the flagship is refit-legal and `mine`-capable from `newGame`.

- [ ] **Step 2: Run on the CURRENT code — this is the baseline, not a red step.** Run `npx vitest run tests/commands.test.ts`. Expected: **PASS (14)** against today's `applyCommand`. These are characterization tests: green **before and after** the refactor; never present them as red→green.

- [ ] **Step 3: Minimal implementation.** Create `src/sim/handlers.ts` (move `fail`, `refund`, `clampToStats` out of `commands.ts`; add `slotTarget`; one handler per variant, bodies copied verbatim from today's `applyCommand`):

```ts
// src/sim/handlers.ts
import type { Command } from './commands'; // type-only (erased): no runtime cycle
export type Handler<K extends Command['t']> = (state: GameState, cmd: Extract<Command, { t: K }>) => void;
export type Handlers = { [K in Command['t']]: Handler<K> };
function fail(state: GameState, msg: string): void;               // was applyCommand's closure
function refund(state: GameState, c: Cost): void;                  // moved verbatim
function clampToStats(state: GameState, ship: Ship): void;         // moved verbatim
type ShipCommand = Extract<Command, { shipId: number }>;           // the 11 ship-scoped variants
/** Silent no-op when the ship is missing (unchanged). */
const withShip = <K extends ShipCommand['t']>(fn: (state: GameState, ship: Ship, cmd: Extract<ShipCommand, { t: K }>) => void): Handler<K>;
/** refitBlock + slot-bounds guard; the slot's current fitting, or null if invalid. */
function slotTarget(state: GameState, ship: Ship, slot: number): { cur: Fitted | null } | null;
export const handlers: Handlers; // all 14 keys; bodies = applyCommand commands.ts:56-191 verbatim
```

Then `src/sim/commands.ts` keeps the union and only the dispatch (delete now-unused imports):

```ts
import type { GameState } from './types';
import { handlers } from './handlers';

export function applyCommand(state: GameState, cmd: Command): void {
  // One cast: `handlers` is a mapped type, so `handlers[cmd.t]` is the handler for
  // exactly cmd's narrowed variant; TS just cannot correlate a union index with a
  // union value, so the correlation is asserted here and is safe by construction.
  (handlers[cmd.t] as (s: GameState, c: Command) => void)(state, cmd);
}
```

- [ ] **Step 4: Run and see it pass.** Run `npx vitest run tests/commands.test.ts`, `npx vitest run tests/sim.test.ts`, `npm run typecheck`. Expected: all PASS; the 14 tests and `determinism` are unchanged by the move.

- [ ] **Step 5: Commit.**

```sh
git add src/sim/handlers.ts src/sim/commands.ts tests/commands.test.ts
git commit -m "Split applyCommand into a handler map (#7)"
```

## Task 2: Exhaustiveness proof + independent handler invocation

**Files:** Modify `tests/commands.test.ts`; no `src/` change.

**Interfaces:** Consumes `handlers`, `Handler`, `Handlers` from `../src/sim/handlers`. Produces nothing (tests only).

- [ ] **Step 1: Add the independent-invocation test** (acceptance: "each handler is independently testable") — call a handler through the exported map, bypassing `applyCommand`:

```ts
import { handlers } from '../src/sim/handlers';

it('handlers are exported and individually invokable', () => {
  const s = newGame(1), fs = flagship(s.run); s.run.selectedId = 0;
  handlers.select(s, { t: 'select', shipId: fs.id });
  expect(s.run.selectedId).toBe(fs.id);
  expect(Object.keys(handlers)).toHaveLength(14);
});
```

- [ ] **Step 2: Verify exhaustiveness empirically** (the second acceptance criterion, mirroring #6's "adding a component is data-only" proof). Temporarily delete the `warp:` entry from the `handlers` object in `src/sim/handlers.ts`.

- [ ] **Step 3: Run `npm run typecheck` and confirm it FAILS.** Expected (TypeScript 7.0.2), naming the deleted variant:

```
src/sim/handlers.ts:NN:14 - error TS2741: Property 'warp' is missing in type
'{ buyPerk: ...; buyHull: ...; select: ...; ... }' but required in type 'Handlers'.
```

Confirmed by the mapped type `{ [K in Command['t']]: Handler<K> }`: any missing variant is a compile error. Record the exact output in the PR.

- [ ] **Step 4: Restore the `warp:` entry and re-run.** `npm run typecheck` → PASS; `npx vitest run tests/commands.test.ts` → PASS (15 tests).

- [ ] **Step 5: Commit.**

```sh
git add tests/commands.test.ts
git commit -m "Prove handler-map exhaustiveness and direct invocability (#7)"
```

## Task 3: Guard-rail regressions + full gate

**Files:** Modify `tests/commands.test.ts`; no `src/` change.

**Interfaces:** Consumes `applyCommand`, `newGame`, `flagship`, `makeShip`. Produces nothing (tests only).

- [ ] **Step 1: Add the Review Focus tests.** (full blocks)

```ts
it('a command for a missing ship is a silent no-op', () => { const s = newGame(1), n = s.out.log.length; send(s, { t: 'stop', shipId: 999 }); expect(s.out.log.length).toBe(n); });
it('mine without a laser warns and sets no order', () => { const s = newGame(1), h = makeShip(s.run, s.profile, 'excavator', 'Ex', { ...s.run.system.station.pos }); s.run.ships.push(h); send(s, { t: 'mine', shipId: h.id, rockId: s.run.rocks[0]!.id }); expect(h.order).toBeNull(); expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' }); });
it('install is rejected unless docked', () => { const { s, fs } = fs1(); fs.pos = { x: 0, z: 5000 }; s.run.bank.ore = 1000; send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' }); expect(fs.slots[2]).toBeNull(); });
it('remove re-clamps hull to the new max', () => { const { s, fs } = fs1(); s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0 }; send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'armor' }); fs.hull = 1e9; send(s, { t: 'remove', shipId: fs.id, slot: 2 }); expect(fs.hull).toBeLessThanOrEqual(100); });
```

Spec values: Prospector base maxHull 100; armor T1 adds 40 (`data/components.ts` `ARMOR_HULL[0]`), so remove re-clamps to 100 via `clampToStats`. `mine` on the laser-less Excavator (`loadout: []`) logs a warning.

- [ ] **Step 2: Run and see them pass.** `npx vitest run tests/commands.test.ts` → PASS (19 tests).

- [ ] **Step 3: Full gate.** `npm run check` (format, lint, typecheck, test) → PASS. Re-confirms the restored map is exhaustive and that `Command` is still importable from `commands.ts` by `update.ts`, `input.ts` and the UI.

- [ ] **Step 4: Commit.**

```sh
git add tests/commands.test.ts
git commit -m "Add handler guard-rail regression tests (#7)"
```

## Self-review

- **Issue coverage:** independent testability → T2 S1; typecheck catches missing handlers → T2 S2–4; behaviour preservation → T1 + T3. Review Focus map: #1 → T3 (mine/install), #2 → T1 (stop/aiMode), #3 → T3 (docked install, clamp), #4 → T3 (missing ship).
- **No no-ops:** each step writes a file, runs a command with an expected result, or commits; T2 S2–4 is a deliberate delete→fail→restore proof.
- **Consistency:** `Handler`/`Handlers`/`handlers`/`applyCommand(state, cmd)` match across T1–2 and the constraints; all tests use the single `send` seam.
- **Conflict flagged:** the approved direction suggested splitting the 14 tests across T1–T2. This plan puts all 14 in T1 so the suite has a genuine pre-refactor baseline (T1 S2) in one task, and gives T2 the exhaustiveness proof; each task still ends with an independently testable deliverable.
