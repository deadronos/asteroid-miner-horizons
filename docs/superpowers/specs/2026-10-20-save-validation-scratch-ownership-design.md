# Save validation extraction and explicit scratch ownership — design

**Issues:** #157 and #158, children of the October 2026 code-quality review (#153).

**Goal:** Make the save boundary easier to audit and make the pilot's use of reusable vectors structurally safe,
without changing the save format, the public save API, or simulation results.

## Part 1 — Split the save payload validators out of `save.ts` (#157)

`src/sim/save.ts` currently mixes four jobs: slot storage, compact export/import, legacy migration and roughly
250 lines of payload validation. The proposal moves only the payload validation into a focused
`src/sim/validate.ts`.

### Boundary

`src/sim/validate.ts` exports one entry point:

```ts
export function validateState(data: SaveData): GameState | null;
```

`data` is the output of `migrate()`: the version envelope is already trusted, but the profile and run are still
`unknown` shape at runtime. The function returns the complete `GameState` (with an empty outbox) or `null`. Every
sub-validator (`isProfile`, `isRun` pieces, `isShip`, `isRock`, `isSystem`, …) stays private to the module.

`src/sim/save.ts` keeps storage, the save/export record format and migration orchestration. Its private
`fromData()` becomes:

```ts
const migrated = migrate(data, opts);
return migrated ? validateState(migrated) : null;
```

`serialize`, `deserialize`, `loadsBack`, `parseImport`, `parseImportText`, slot helpers and the migration chain
keep their current exports and behaviour. No data table moves out of `src/data`.

### Duplicate ids

A save whose `run.ships` or `run.rocks` contains two entries with the same `id` is corrupt: `SimIndex.rockById`
and the per-ship stats map would silently keep one entry, producing a half-valid state. `validateState` therefore
rejects duplicate ship ids and duplicate rock ids. Existing outpost-host and achievement uniqueness checks stay
where they are.

### Tests

`tests/validate.test.ts` drives the new entry point directly:

- A valid round-tripped `newGame(seed)` payload returns a state whose serialized form round-trips again.
- A table of representative corruptions (missing field, wrong type, null, non-finite number, empty required array,
  duplicate ship id, duplicate rock id) returns `null`.
- A seeded fuzz test builds the same valid payload, applies a deterministic sequence of mutations (delete a key,
  replace a value with a wrong type, inject `null`, inject `NaN`/`Infinity`, truncate an array, duplicate an id),
  and asserts that validation never throws. Any accepted result must itself load back. The same seed must produce
  the same accept/reject sequence on every run.

The existing `tests/migrations.test.ts` corruption table and fixtures stay in place; this is an additional,
module-focused gate, not a replacement.

## Part 2 — Make `SimIndex` scratch-vector ownership explicit (#158)

### Chosen option

Remove the four shared scratch vectors (`avoid`, `home`, `escape`, `waypoint`) from `SimIndex`. Each call that
needs a vector owns a local one for the duration of that call. There is then no cross-call scratch to clobber, so
the ownership rule is enforced by scoping rather than by a comment or a naming convention.

This is option 1 from the issue. Option 2 (a take/release pool) keeps shared mutable state and adds ceremony to a
hot path; option 3 documents the hazard instead of removing it.

### Resulting signatures

- `pilot.avoidance(..., out: Vec2): number` writes its avoidance vector into a caller-owned local inside `steer`.
- `pilot.starDetour(..., out: Vec2): boolean` writes its waypoint into a caller-owned local inside `arrive`.
- `pilot.formationSlot(anchor: Vec2, id: number, radius: number): Vec2` returns a fresh vector. The old `out`
  parameter and its cross-module callers are updated.
- `pilot.dodgeHazards` and `pilot.unsafe` use locals. `unsafe` calls a new allocation-free predicate
  `hazards.inCometPath(run, comets, pos, pad): boolean`; the existing out-parameter API of `cometPathEscape` and
  `flareShelter` is kept for callers that already own an output vector.

`hazards.pathEscape` internally may return a vector; the exported predicate wrapper copies it into the caller's
`out` vector only when a hit occurs, so the common "not in a path" check does not allocate.

### Tests

- `tests/pilot.test.ts` drops the two tests that assert writes into `index.avoid` / `index.home`.
- A structural test asserts `SimIndex` no longer exposes the four scratch fields.
- `formationSlot` is tested to return a fresh vector and leave its anchor untouched.
- A regression test runs the nested hazard/arrival path (`dodgeHazards → arrive → starDetour → steer`) and checks
  the ship still steers along the escape vector.
- `tests/alloc.test.ts` remains the budget guard; the measured mean is recorded in the run log.

## Trade-offs

- Local vectors allocate on some paths. The allocation is small (one `{x,z}` per steer/arrival at most) and the
  existing 112 KiB/tick budget has headroom; the allocation test will confirm the actual cost.
- Duplicate-id rejection is a new rejection for corrupt saves. Valid saves, including every fixture from v2 to v12,
  are unaffected.
- Keeping the hazards out-parameter API avoids a broad signature change across the bot script and hazard tests,
  while still removing the shared `SimIndex` state that made ownership implicit.

## Non-goals

- No save schema or `SAVE_VERSION` change.
- No new dependencies.
- No change to bot balance, RNG consumption or tick order.
- No rewrite of the migration table or of unrelated `save.ts` helpers.

## Verification

`npm run check` is the bar. Additionally run `npm run build`, `tests/alloc.test.ts`, and `npm run balance`; the
generated `docs/balance.md` must stay unchanged, proving the refactor did not move simulation behaviour.
