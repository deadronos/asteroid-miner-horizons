# AGENTS.md

Instructions for coding agents in this repo. This file is deliberately short: it holds only what you need on
every task, and links to the deeper docs you read when the task calls for them.

**Asteroid Miner Horizons** is a top-down sci-fi mining sim. A pure, deterministic TypeScript simulation
(`src/sim`) is driven by a three.js renderer (`src/render`) and a DOM HUD (`src/ui`). Built with Vite, tested
with Vitest, linted and formatted with the Oxc toolchain.

## Commands

| Command                | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run check`        | format:check + lint + typecheck + tests. Run this before calling anything done. |
| `npm test`             | Vitest once. One file: `npx vitest run tests/sim.test.ts`                       |
| `npm run dev`          | Vite dev server on http://localhost:5173                                        |
| `npm run build`        | `tsc --noEmit` then a production build into `dist/`                             |
| `npm run bundle-size`  | Gzipped JS in `dist/` vs the 240 kB budget (run after a build)                  |
| `npm run bench`        | Headless tick benchmark: mean/p95 ms per tick                                   |
| `npm run bench:stress` | Opt-in stress run (2,000 rocks, 50 ships, 1,000 pickups); warn-only budget      |
| `npm run balance`      | Bot plays 30 seeds × 10 warps, rewrites `docs/balance.md`                       |
| `npm run balance:ci`   | Same, inside Docker on CI's platform; use this for the committed report         |

`npm run check` is the correctness gate CI runs first (plus a build, the bundle-size budget, a warn-only
bench and a balance-report freshness check that fails on drift). Green means done. Balance numbers depend
on CPU architecture, so commit
`docs/balance.md` from `npm run balance:ci` (Docker, linux/amd64 like CI), not a native `npm run balance`.

## Rules that bite

- **Keep `src/core`, `src/data` and `src/sim` pure.** No DOM, no three.js, and no `Math.random` or `Date`
  inside a tick. Randomness goes through `run.rng`, so a seed replays identically.
- **Never mutate `GameState` from input or UI.** Enqueue a `Command`; the tick applies it. Invalid commands are
  rejected with a log line, not an exception.
- **A new command touches at least three files:** the union in `src/sim/commands.ts`, the handler in
  `src/sim/handlers.ts` and a test. The handler map is typed, so a missing variant fails the typecheck.
- **Changing the save shape means bumping `SAVE_VERSION`** (`src/sim/create.ts`) and adding one entry to
  `src/sim/migrations.ts`. Old saves must keep loading.
- **Do not add dependencies** without asking. Node 22.12+ is required (Vitest's floor; see `engines`).
- **Do not touch `scratch.md`** — it is the maintainer's notebook of suggested next issues.
- **Never hand-edit `docs/balance.md`.** It is generated; run `npm run balance` to regenerate it.
- Match local style: one short header comment per module, `/** */` on exported functions and non-obvious
  fields, no comment noise. Formatter and lint rules are in [`docs/agents/style.md`](docs/agents/style.md).

## Read next

Read only the row that matches the task.

| When you are...                                        | Read                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| orienting yourself in the codebase                     | [`docs/agents/architecture.md`](docs/agents/architecture.md)       |
| looking for where something lives                      | [`docs/agents/repo-structure.md`](docs/agents/repo-structure.md)   |
| changing sim behaviour, data tables or the save schema | [`docs/agents/sim-conventions.md`](docs/agents/sim-conventions.md) |
| working on render, UI or audio (what it may import)    | [`docs/agents/repo-structure.md`](docs/agents/repo-structure.md)   |
| writing or fixing tests                                | [`docs/agents/testing.md`](docs/agents/testing.md)                 |
| unsure about comment style or a lint rule              | [`docs/agents/style.md`](docs/agents/style.md)                     |
| turning an issue into a spec, plan and PR              | [`docs/agents/workflow.md`](docs/agents/workflow.md)               |
| wanting the full index of agent docs                   | [`docs/agents/README.md`](docs/agents/README.md)                   |

Player and feature docs are in [`README.md`](README.md); generated balance numbers in
[`docs/balance.md`](docs/balance.md); per-feature designs and plans in [`docs/superpowers/`](docs/superpowers/).
