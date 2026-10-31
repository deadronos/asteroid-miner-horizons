# Doctrine pairs implementation plan (#50)

- **Goal:** exclusive doctrine pairs with a bonus and a cost, locked until the next warp's respec window.
- **Architecture:** a data table drives `writeShipStats` and `fleetCap`; `chooseDoctrine` enforces the window and
  the pair; save v15; the research panel renders a pure view.
- **Spec:** [`2026-10-31-doctrine-perks-design.md`](../specs/2026-10-31-doctrine-perks-design.md)

## Global Constraints

Pure, deterministic sim; no new RNG stream (doctrines roll nothing); `SAVE_VERSION` 15 with a migration and a
frozen fixture; no new dependencies; `npm run check` green; `docs/balance.md` regenerated, never hand-edited.
Do not touch `scratch.md`. Do not implement #177 or #38.

## Review Focus

- A side's numbers come from the data table and land in `writeShipStats` / `fleetCap`, not a one-off in the tick
  (Task 1).
- The handler and the save validator both reject the other side of a pair (Task 2).
- A v14 save loads with every pair null, and a v15 save round-trips (Task 2).
- The panel's trade-off is words, and locked buttons stay in the keyboard and gamepad focus order (Task 3).

## Task 1: Data, stats, command

**Files:** `src/data/doctrines.ts`, `src/data/tuning.ts`, `src/sim/ships.ts`, `src/sim/commands.ts`,
`src/sim/handlers.ts`, `src/sim/economy.ts`, `tests/doctrines.test.ts`
**Build:** three pairs; `doctrineWindow` 45s; `chooseDoctrine`; effects folded after the perk multipliers.
**Tests:** one headless case per side; swap; lock message; no Horizon Data cost; rng untouched.
**Done when:** - [x] tests pass.

## Task 2: Save v15

**Files:** `src/sim/create.ts`, `src/sim/types.ts`, `src/sim/migrations.ts`, `src/sim/validate.ts`,
`tests/migrations.test.ts`, `tests/fixtures/save-v15.json`
**Build:** migration 14 → 15 sets every pair to null; validator requires one side-or-null per pair.
**Tests:** v14 migrates empty; v15 fixture round-trips; a side on the wrong pair is rejected.
**Done when:** - [x] tests pass.

## Task 3: Research panel, bot, docs

**Files:** `src/ui/doctrines.ts`, `src/ui/panels/ResearchPanel.ts`, `src/input.ts`, `src/style.css`,
`scripts/bot.ts`, `scripts/balance.ts`, `README.md`, `docs/balance.md`, `tests/alloc.test.ts`
**Build:** panel shows pairs, picked/locked, and the respec hint; Tab and arrows cycle real buttons; the bot
picks one pair per seed (`seed % 3` chooses the pair, seed parity the side) inside the window.
**Done when:** - [x] `npm run check`, build, and the bundle budget pass, and the balance report is regenerated.
