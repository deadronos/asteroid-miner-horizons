# Testing

## Running

```bash
npm test                          # vitest run, all files
npx vitest run tests/sim.test.ts  # one file
npx vitest -t 'conserves resource' # one test by name
npx vitest                        # watch mode
npm run check                     # format:check + lint + typecheck + tests — the gate
```

Vitest is configured by the `test` block in `vite.config.ts`: it collects only `tests/**/*.test.ts` (never the
copies under `.claude/worktrees/`) and keeps the default **node** environment: no jsdom, no real browser, no
WebGL. Tests still import three.js where it is useful, because geometry and math classes construct fine
without a renderer.

## Layout

All tests are `tests/*.test.ts`, named after the module or feature they cover (`contracts.test.ts`,
`refining.test.ts`, `pause.test.ts`, ...), with co-located helpers that are not themselves test files. A few have
special roles worth knowing before you change the code they guard:

| File                 | Role                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `sim.test.ts`        | Determinism (same seed + commands → same serialised state), save round-trip    |
| `commands.test.ts`   | Every command handler, including rejections                                    |
| `migrations.test.ts` | Each save version step, and a fixture for every version through `SAVE_VERSION` |
| `alloc.test.ts`      | Mean bytes allocated per tick with a full fleet, against a fixed budget        |
| `inPlace.test.ts`    | `ships`, `rocks` and `pickups` are compacted in place, never reassigned        |
| `stats.test.ts`      | Derived ship stats as a snapshot; update it only when the change is intended   |
| `bot.test.ts`        | The balance bot's decisions                                                    |

Helpers: `tests/helpers.ts` drives the sim (`runTicks`, `runFor`, `send`, and the shared `DT`); `tests/memStorage.ts` is an in-memory `Storage` (save slots and settings read
`globalThis.localStorage`, which tests swap in); `tests/fixtures/save-vN.json` are frozen saves for the migration
tests, one for every version from 2 through `SAVE_VERSION` (the suite fails when the current version has none);
`tests/__snapshots__/` holds snapshots.

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
- **Sim tests drive the tick directly** through `tests/helpers.ts`: `runTicks(state, n, opts)` for an exact tick
  count, `runFor(state, seconds, opts)` for sim time (it accumulates `t += DT`, so it can run one tick more than
  `seconds / DT`), with `commands`, `hazards`, `assists` or a shared `index` in `opts`. Do not spin up `main.ts`.
- **Reuse buffers and instances rather than allocating per tick.** `alloc.test.ts` fails when the mean
  allocation per tick grows past its budget; that catches a new per-rock or per-ship allocation, but not a single
  extra array copy. `inPlace.test.ts` catches a `filter`/`map` that reassigns `run.ships`, `rocks` or `pickups`.

## Headless bot harness

`scripts/` plays the game with no browser, through the same `Command`s the UI sends.

- `scripts/bot.ts` — the scripted player. `botCommands(state, opts)` returns the commands for the next tick.
- `scripts/harness.ts` — `runBot(state, opts)` steps the sim at a fixed 60 Hz, lets the bot decide every 15
  ticks, and drains `out.fx`/`out.log` so long runs don't grow memory.
- `npm run bench` — times the `tick()` call with a full fleet; over budget warns, never fails.
- `npm run balance` — plays 30 seeds × 10 warps at hazards `normal` (the game's default; `--hazards off` for
  calm play) and writes `docs/balance.md`. CI regenerates it and warns
  (does not fail) when the committed report differs; the header line is ignored.

`bot.test.ts` covers bot decisions. If you add a game system, consider teaching the bot to use it so the
balance report reflects it — otherwise the numbers silently ignore your feature.
