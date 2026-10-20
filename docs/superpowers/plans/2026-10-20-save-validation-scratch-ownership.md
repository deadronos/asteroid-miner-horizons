# Save Validation and Scratch Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract save payload validation into `src/sim/validate.ts` and remove the implicit `SimIndex` scratch vectors in favour of caller-owned locals.

**Architecture:** Task 1 moves the existing `fromData` validators into a new module behind `validateState()`, leaving migration/storage in `save.ts`, and adds direct corruption tests plus a deterministic fuzz test. Task 2 deletes the four reusable vectors from `SimIndex`; each helper writes into a local owned by its caller, with a boolean `inCometPath` predicate so the hot `unsafe` check stays allocation-free.

**Tech Stack:** TypeScript, Vitest, Oxc formatter/linter, Vite.

**Spec:** [`docs/superpowers/specs/2026-10-20-save-validation-scratch-ownership-design.md`](../specs/2026-10-20-save-validation-scratch-ownership-design.md)

## Global Constraints

- Keep `src/core`, `src/data` and `src/sim` pure: no DOM, no three.js, no `Math.random`, no `Date` inside a tick.
- Do not change the save format, `SAVE_VERSION`, the public save API, tick order, RNG consumption or bot balance.
- Do not add dependencies.
- Never hand-edit `docs/balance.md`; run `npm run balance` if balance could move.
- Do not touch `scratch.md`.
- Reuse the existing `Rng` from `src/core/rng.ts` for the fuzz test; do not use `Math.random`.
- `npm run check` must pass before each commit. Match the local style: one short module header, `/** */` on exported
  functions and non-obvious fields, no comment noise.
- Commit subjects are imperative, specific and reference the issue: `... (#157)` / `... (#158)`.

## Review Focus

- A corrupt save with any missing required field must return `null`, not throw and not produce a half-valid state;
  covered by the table and fuzz tests in Task 1.
- Non-finite numbers and duplicate ship/rock ids must be rejected; covered by explicit cases in Task 1.
- Valid saves, including fixtures v2–v12, must still load with identical serialized output; covered by the existing
  migration tests plus the round-trip test in Task 1, and by `npm run check`.
- A ship in a comet path or flare near the star must still steer to the same escape point, with no residual
  avoidance or home state between calls or ships; covered by the regression test in Task 2.
- The per-tick allocation budget must stay under 112 KiB and `docs/balance.md` must not change; covered by
  `tests/alloc.test.ts` and `npm run balance` in Task 2.

---

### Task 1: Extract payload validation into `src/sim/validate.ts` (#157)

**Files:**
- Create: `src/sim/validate.ts`
- Create: `tests/validate.test.ts`
- Modify: `src/sim/save.ts`

**Interfaces:**
- Consumes: `migrate()` from `src/sim/migrations.ts`, returning `SaveData` (`Pick<GameState, 'version' | 'profile' | 'run'>`).
- Produces: `validateState(data: SaveData): GameState | null` from `src/sim/validate.ts`. `save.ts` calls it after
  `migrate()`.
- `src/sim/save.ts` keeps every existing export (`serialize`, `deserialize`, `loadsBack`, `exportText`,
  `exportCompact`, `parseImport`, `parseImportText`, slot helpers) with unchanged signatures.

- [x] **Step 1: Write the failing direct-validation tests**

Create `tests/validate.test.ts`. Build a valid payload with
`JSON.parse(serialize(newGame(7))) as unknown as SaveData`, clone it per case, and assert
`validateState(payload)` is non-null and its `serialize()` round-trips. Add a table of cases that must return
`null`:

```ts
const corruptions: Array<[string, (s: SaveData) => void]> = [
  ['missing profile', (s) => delete s.profile],
  ['missing profile.seed', (s) => delete s.profile.seed],
  ['profile.seed a string', (s) => (s.profile.seed = '7' as unknown as number)],
  ['missing run', (s) => delete s.run],
  ['missing run.rng.s', (s) => delete s.run.rng.s],
  ['empty system.belts', (s) => (s.run.system.belts = [])],
  ['missing ship.pos.x', (s) => delete s.run.ships[0]!.pos.x],
  ['ship slot tier 4', (s) => (s.run.ships[0]!.slots[0] = { type: 'laser', variant: 'standard', tier: 4 } as never)],
  ['bank missing alloy', (s) => delete s.run.bank.alloy],
  ['rock size 3', (s) => (s.run.rocks[0]!.size = 3)],
  ['hazard timer Infinity', (s) => (s.run.hazards.flareTimer = Infinity)],
  ['duplicate ship id', (s) => s.run.ships.push({ ...s.run.ships[0]! })],
  ['duplicate rock id', (s) => s.run.rocks.push({ ...s.run.rocks[0]! })],
];
```

Run each through `validateState`. Use `Partial<...>` casts for deletes and `unknown` casts for wrong-typed
assignments (the repo lints `no-explicit-any`). Also assert `deserialize(JSON.stringify(corrupt))` is `null` for
every case.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/validate.test.ts`
Expected: FAIL because `src/sim/validate.ts` does not exist (module resolution error).

- [x] **Step 3: Move the validators into `src/sim/validate.ts`**

Move the private validator block from `src/sim/save.ts` (from `isObj` through the body of `fromData`) into the new
module. Keep every helper private. Export only:

```ts
/** Validates the shape of a migrated save, returning a runnable state or null. */
export function validateState(data: SaveData): GameState | null
```

The body keeps the current checks in the same order, then returns
`{ version: data.version, profile, run, out: { fx: [], log: [] } }`. Add duplicate-id rejection for
`run.ships` and `run.rocks` using a small private helper (for example `hasUniqueIds(items)`), before the existing
cross-reference checks. Do not change any other acceptance rule.

- [x] **Step 4: Delegate from `save.ts`**

In `src/sim/save.ts`, replace the moved block with:

```ts
import { validateState } from './validate';

function fromData(data: unknown, opts?: MigrateOptions): GameState | null {
  const migrated = migrate(data, opts);
  return migrated ? validateState(migrated) : null;
}
```

Remove the now-unused data-table imports and the `Profile` / `Run` type imports. Keep `SAVE_VERSION`,
`chainCovers`, `migrate` and all storage/format code in `save.ts`.

- [x] **Step 5: Add the seeded fuzz test**

In `tests/validate.test.ts`, add a test using `makeRng(0x5eed)`, `next`, `int` and `pick` from `src/core/rng.ts`.
For 200 iterations:

1. Clone the valid payload.
2. Pick one mutation kind: delete a key from a required path, replace a required value with a wrong-typed value,
   set a required value to `null`, truncate the ships array or system belts to empty, duplicate a ship/rock id, or
   set a required number to `NaN` / `Infinity`.
3. Run the mutation through `validateState` (and through `deserialize(JSON.stringify(mutated))` for the JSON-safe
   kinds).
4. Assert neither call throws. If a state is returned, assert `deserialize(serialize(state))` is non-null.
5. Record `null` or `'valid'` per iteration; rerun the whole loop with the same seed and assert the sequences match.

Use a fixed list of required paths and finite-number paths so the mutations are always structurally meaningful.
Include at least one `NaN` and one `Infinity` iteration explicitly, not only through random selection.

- [x] **Step 6: Run the focused tests and the full check**

Run: `npx vitest run tests/validate.test.ts tests/migrations.test.ts tests/sim.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: PASS (format, lint, typecheck, all tests).

- [x] **Step 7: Commit Task 1**

```bash
git add src/sim/validate.ts src/sim/save.ts tests/validate.test.ts
git commit -m "Move save payload validation into its own module (#157)"
```

### Task 2: Replace `SimIndex` scratch vectors with caller-owned locals (#158)

**Files:**
- Modify: `src/sim/index.ts`
- Modify: `src/sim/pilot.ts`
- Modify: `src/sim/hazards.ts`
- Modify: `src/sim/automation.ts`
- Modify: `tests/pilot.test.ts`

**Interfaces:**
- Consumes: `SimIndex` without `avoid`, `home`, `escape` or `waypoint`.
- Produces:
  - `pilot.formationSlot(anchor: Vec2, id: number, radius: number): Vec2` (fresh vector; no `out` parameter).
  - `pilot.avoidance(..., out: Vec2): number` and `pilot.starDetour(..., out: Vec2): boolean` keep their existing
    parameter order with `out` appended.
  - `hazards.inCometPath(run: Run, comets: readonly Rock[], pos: Vec2, pad: number): boolean` (allocation-free on a
    miss). `cometPathEscape` and `flareShelter` keep their current signatures.

- [x] **Step 1: Replace the scratch-reuse tests with ownership tests**

In `tests/pilot.test.ts`, delete the `pilot scratch reuse` describe block. Add:

```ts
it('SimIndex exposes no shared scratch vectors', () => {
  const index = new SimIndex();
  for (const key of ['avoid', 'home', 'escape', 'waypoint']) expect(Object.hasOwn(index, key)).toBe(false);
});

it('formationSlot returns a fresh vector and leaves its anchor alone', () => {
  const anchor = { x: 10, z: -4 };
  const a = formationSlot(anchor, 7, 70);
  const b = formationSlot(anchor, 7, 70);
  expect(anchor).toEqual({ x: 10, z: -4 });
  expect(a).not.toBe(b);
  expect(a).toEqual(b);
});
```

Update the existing `formationSlot(d.pos, fs.pos, d.id, 70)` call to `d.pos = formationSlot(fs.pos, d.id, 70)`.

Add a nested hazard/arrival regression test: place a ship inside a pending comet path, call `dodgeHazards`, and
assert it returns true and the resulting velocity points away from the path (positive lateral component relative
to the comet velocity). Follow it with a normal `arrive` to a caller-owned target and assert that target object is
unchanged.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/pilot.test.ts`
Expected: FAIL — `SimIndex` still has the scratch fields and `formationSlot` still requires an `out` argument.

- [x] **Step 3: Remove the scratch fields and use locals**

In `src/sim/index.ts`, delete the `avoid`, `home`, `escape` and `waypoint` fields and their comments.

In `src/sim/pilot.ts`:

- In `steer`, create `const a = { x: 0, z: 0 };`, pass it to `avoidance`, and read `a.x` / `a.z` after the call.
- In `arrive`, create `const wp = { x: 0, z: 0 };` and pass it to `starDetour`; use `wp` only inside that branch.
- Change `formationSlot` to `formationSlot(anchor, id, radius): Vec2`, returning a new `{ x, z }`. Update
  `droneThink` and `automation.ts` call sites; no `out` argument remains.
- In `unsafe`, replace the `ctx.index.escape` argument with `inCometPath(...)`.
- In `dodgeHazards`, own a local `esc` for `cometPathEscape` and a local `shelter` for `flareShelter`; pass
  `shelter` to `arrive` when the result is `'flee'`.

In `src/sim/hazards.ts`, make the private `pathEscape` return `Vec2 | null`, add
`inCometPath(run, comets, pos, pad): boolean`, and keep `cometPathEscape` by copying the returned vector into its
`out` argument only on a hit. Keep `flareShelter` as-is.

- [x] **Step 4: Run focused tests**

Run: `npx vitest run tests/pilot.test.ts tests/hazards.test.ts tests/autopilot.test.ts tests/alloc.test.ts`
Expected: PASS, with the allocation mean below 112 KiB/tick.

- [x] **Step 5: Run the full check and confirm no balance drift**

Run: `npm run check`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

Run: `npm run balance`, then `git diff --exit-code docs/balance.md`
Expected: no diff. If the report changes, stop and investigate the behaviour change before committing.

- [x] **Step 6: Commit Task 2**

```bash
git add src/sim/index.ts src/sim/pilot.ts src/sim/hazards.ts src/sim/automation.ts tests/pilot.test.ts
git commit -m "Give pilot vectors explicit per-call ownership (#158)"
```

### Task 3: Run log and PR preparation

**Files:**
- Create: `docs/superpowers/plans/2026-10-20-save-validation-scratch-ownership-run-log.md`

- [x] **Step 1: Write the run log**

Record the date, issues, branch, spec/plan links, the setup, the verification after each task (commands and
results), the measured allocation mean, any deviation from the plan and why, a per-task session/round/commit table,
and the reviewer findings with accepted/rejected calls.

- [x] **Step 2: Final verification**

Run: `npm run check && npm run build`
Expected: PASS.

- [x] **Step 3: Commit the run log**

```bash
git add docs/superpowers/plans/2026-10-20-save-validation-scratch-ownership-run-log.md
git commit -m "Record the save validation and scratch ownership run (#157, #158)"
```
