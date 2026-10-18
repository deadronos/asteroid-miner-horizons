# Testing

## Running

```bash
npm test                          # vitest run, all files
npx vitest run tests/sim.test.ts  # one file
npx vitest -t 'conserves resource' # one test by name
npx vitest                        # watch mode
npm run check                     # format:check + lint + typecheck + tests — the gate
```

There is no Vitest config file, so tests run in the default **node** environment: no jsdom, no real browser, no
WebGL. Tests still import three.js where it is useful, because geometry and math classes construct fine
without a renderer.

## Layout

All tests are `tests/*.test.ts`, named after the module or feature they cover (`contracts.test.ts`,
`refining.test.ts`, `pause.test.ts`, ...), with co-located helpers that are not themselves test files. A few have
special roles worth knowing before you change the code they guard:

| File                 | Role                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `sim.test.ts`        | Determinism (same seed + commands → same serialised state), save round-trip  |
| `commands.test.ts`   | Every command handler, including rejections                                  |
| `migrations.test.ts` | Each save version step, against the fixtures in `tests/fixtures/`            |
| `alloc.test.ts`      | Per-tick allocation; the regression net for hot-path changes                 |
| `stats.test.ts`      | Derived ship stats as a snapshot; update it only when the change is intended |
| `bot.test.ts`        | The balance bot's decisions                                                  |

Helpers: `tests/memStorage.ts` is an in-memory `Storage` (save slots and settings read
`globalThis.localStorage`, which tests swap in); `tests/fixtures/save-vN.json` are old saves for the migration
tests; `tests/__snapshots__/` holds snapshots.

## Conventions

- **Test the pure seam, not the DOM.** Panels and renderers keep their logic in exported pure functions —
  `topBarKey`, `refineryKey`, `addPickup`/`ageFloaters` — and those are what the tests import. If a UI change
  needs a test and there is no pure seam, extract one rather than adding a DOM dependency.
- **Determinism tests compare serialised state.** `sim.test.ts` runs the same seed and commands on two games and
  asserts `serialize(a)` equals `serialize(b)`. Any new source of randomness breaks this — that is the point.
- **Invariants get names.** "Units are conserved", "the bank delta equals the reward exactly once",
  "`run.rng.s` is unchanged" are asserted directly. When your change could break an invariant, add the assertion
  even if nobody asked.
- **Isolation matters.** New subsystems draw from their own RNG stream and id counter, so a test should assert
  `run.rng.s` and rock layout are unchanged by the new feature. This is what keeps `docs/balance.md` stable.
- **Sim tests drive the tick directly.** A local helper that builds `{ thrust, commands }`, constructs one
  `SimIndex` and loops `tick(state, DT, input, index)` is the standard shape — see `sim.test.ts` and
  `alloc.test.ts`. Do not spin up `main.ts`.
- **`alloc.test.ts` guards allocation.** Reuse buffers and instances rather than allocating per tick; that test
  is the regression net for hot-path changes.

## Headless bot harness

`scripts/` plays the game with no browser, through the same `Command`s the UI sends.

- `scripts/bot.ts` — the scripted player. `botCommands(state, opts)` returns the commands for the next tick.
- `scripts/harness.ts` — `runBot(state, opts)` steps the sim at a fixed 60 Hz, lets the bot decide every 15
  ticks, and drains `out.fx`/`out.log` so long runs don't grow memory.
- `npm run bench` — times the `tick()` call with a full fleet; over budget warns, never fails.
- `npm run balance` — plays seeds × warps and writes `docs/balance.md`.

`bot.test.ts` covers bot decisions. If you add a game system, consider teaching the bot to use it so the
balance report reflects it — otherwise the numbers silently ignore your feature.
