# Sim conventions

Recipes for the changes agents make most often, plus the rules behind them.

## Purity

`src/core`, `src/data` and `src/sim` must stay free of the DOM, three.js, `Math.random` and `Date`. The reasons
are testability and determinism, not tidiness.

- **Randomness goes through an `Rng`** (`src/core/rng.ts`), and the state lives in the save. Use `range`, `int`,
  `pick`, `chance`. Never call `Math.random` in `core`, `data` or `sim`.
- **Give a new subsystem its own RNG stream.** `run.contracts.rng` and the modifier roller are derived from
  `(seed, system)` rather than drawn from `run.rng`, precisely so adding a feature cannot shift the run's rock
  and pickup sequence — and therefore cannot move the balance numbers. Copy that pattern.
- **Use the same id counter discipline.** `run.nextId` numbers ships and rocks; new subsystems keep their own
  counter (e.g. `board.nextId`) so ids can't collide or drift.
- The only sanctioned `Math.random`/`Date` in the repo are `newGame`'s default seed and `savedAt` timestamps.
  Neither is read inside a tick.

## Adding a command

A player action is a `Command`: input and UI enqueue it, `tick()` applies it.

1. **`src/sim/commands.ts`** — add a variant to the `Command` union. Keep it plain data (ids and `Vec2`, no
   functions). This module owns the union and the dispatch; the per-variant logic is next door.
2. **`src/sim/handlers.ts`** — add the entry to the `handlers` map. The map is typed
   `{ [K in Command['t']]: Handler<K> }`, so a missing or mismatched variant is a compile error, and `cmd` is
   narrowed to your variant inside the handler. Ship-scoped commands should use the `withShip(...)` wrapper.
3. **Reject invalid input with `fail(state, message)`**, which pushes a `warn` log line and returns. Do not
   throw: a command is untrusted input and the sim must survive it.
4. **Send it from the UI** via the `send` function a panel receives (see `src/ui/panels/context.ts`).
5. **Test it** in `tests/commands.test.ts` — happy path, and that the rejection leaves state unchanged.

Handlers mutate `state.run` / `state.profile`. Anything the renderer or HUD should react to must be pushed to
`state.out.fx` or `state.out.log` — that outbox is the only channel out of the sim:

|           |                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------- |
| `out.fx`  | `crack`, `collect`, `dock`, `impact`, `explode`, `warp` — the renderer turns these into visuals |
| `out.log` | `info` (routine), `warn` (rejected command, danger), `major` (milestones, losses)               |

## Adding a tuning knob or content table

- Numbers that should be tunable in one place go in **`src/data/tuning.ts`**, each with a one-line comment.
- New game content goes in the matching data table (`components.ts`, `hulls.ts`, `perks.ts`, `refining.ts`,
  `contracts.ts`). Tables are pure data and drive both the sim and the HUD text, so keep labels user-facing.
- `src/data` is a leaf: a data module may import `resources.ts` for shared types and helpers, and nothing else.
- If you add a key to a table the sim indexes by string (like `MODIFIERS`), remember `fromData` in `save.ts`
  checks every persisted key is known — update that validation.

## Changing the save schema

A save is `{ version, profile, run }`. Two files, one rule: **an old save must always load**.

1. **`src/sim/create.ts`** — bump `SAVE_VERSION`.
2. **`src/sim/migrations.ts`** — add `migrations[oldVersion]`, which upgrades a save at that version to the
   next one. Entries run in order, so a save several versions old replays each step. The input is freshly
   parsed JSON, so a migration may edit nested objects in place.
3. **`src/sim/save.ts`** — if the new field is one the tick reads, add it to the `fromData` payload validation
   so a malformed save is rejected with `{ ok: false }` instead of throwing mid-tick. `migrate()` already
   downgrades a throwing migration to a rejection.
4. **`tests/migrations.test.ts`** — add a fixture under `tests/fixtures/save-vN.json` and assert the upgrade.
   Existing fixtures are the regression net for old saves; do not delete them.

Note the two shapes in play: `GameState` includes the transient `out`; the persisted and exported shape is
`Pick<GameState, 'version' | 'profile' | 'run'>`.

## Style

- One short header comment per module stating what it is and any non-obvious rule. The existing headers are the
  model — declarative, present tense, no marketing.
- `/** */` on exported functions and on non-obvious fields. Skip comments that restate the code.
- `oxfmt` enforces printWidth 120, single quotes, trailing commas. Run `npm run format`.
- `oxlint` denies warnings: `import/no-cycle` is an error, `typescript/no-explicit-any` is an error, and unused
  args/vars must be `_`-prefixed. `eqeqeq` is "smart".
