# Automation tier implementation plan (#39)

- **Goal:** hauler hull and mining outposts, with idle play viable but under the #46 active-play gate.
- **Architecture:** a focused `src/sim/automation.ts` (outpost tick, deploy rules, hauler AI) called from
  `update.ts`; data in `hulls.ts` and `tuning.ts`; one new command; save v8 → v9.
- **Tech stack:** TypeScript, Vitest, three.js for the marker, the existing headless bot harness.
- **Spec:** [`2026-10-19-automation-design.md`](../specs/2026-10-19-automation-design.md)

## Global Constraints

- `src/core`, `src/data`, `src/sim` stay pure; nothing in the feature calls an RNG.
- A new command touches `commands.ts`, `handlers.ts` and a test; invalid input warns, never throws.
- Save shape change: bump `SAVE_VERSION`, add a migration and a fixture; old fixtures keep loading.
- `npm run check` green after every task. No new dependencies. Do not touch `scratch.md`; regenerate
  `docs/balance.md` with `npm run balance`, never by hand.

## Review Focus

- Units conserved through a hauler transfer (Task 3) and an outpost never touching its rock's units (Task 2).
- `run.rng.s` unchanged by outposts (Task 2).
- Host rocks skipped by every mining path: drone AI, chaining, Wide Beam splash, the `mine` command, the bot
  (Tasks 2, 5).
- Haulers not flying through the star's heat zone on cross-system trips (Task 3).
- A malformed `run.automation` rejected at load rather than throwing mid-tick (Task 4).

## Task 1: Data and state

**Files:** `src/data/hulls.ts`, `src/data/tuning.ts`, `src/sim/types.ts`, `src/render/shipView.ts`
**Build:** `role: 'hauler'` and the Hauler hull; automation knobs; `Outpost`, `Automation`, `run.automation`;
a hauler silhouette (the shape table is exhaustive over `HullId`).
**Tests:** typecheck.
**Done when:** - [x] tree compiles.

## Task 2: Outposts and the deploy command

**Files:** `src/sim/automation.ts`, `src/sim/commands.ts`, `src/sim/handlers.ts`, `src/sim/index.ts`,
`src/sim/pilot.ts`, `src/sim/update.ts`, `tests/automation.test.ts`, `tests/commands.test.ts`
**Build:** `outpostBlock`, `makeOutpost`, `updateOutposts`; `deployOutpost` handler; `SimIndex.outpostRocks`;
`minable` in the pilot; `mine` rejection; warp warning.
**Tests:** deploy happy path and each rejection; extraction rate, capacity stall, yield perk, dismantling, rock
untouched, `run.rng.s` unchanged; drones ignore host rocks; warp leaves outposts behind.
**Done when:** - [x] tests pass.

## Task 3: Hauler AI

**Files:** `src/sim/automation.ts`, `src/sim/update.ts`, `src/sim/index.ts`, `tests/automation.test.ts`
**Build:** `haulerThink` with source claiming, transfer, docking and waiting; `haulTo` detour round the star.
**Tests:** a drone's load reaches the bank with units conserved every tick; threshold respected; an outpost emptied
and dismantled; idle hauler waits by the station; an idle fleet with a parked flagship still earns.
**Done when:** - [x] tests pass.

## Task 4: Save v9

**Files:** `src/sim/create.ts`, `src/sim/migrations.ts`, `src/sim/save.ts`, `tests/migrations.test.ts`,
`tests/fixtures/save-v8.json`
**Build:** migration 8 → 9; `isAutomation` validation.
**Tests:** v2/v5/v7/v8 fixtures load with no outposts; v8 otherwise unchanged; round-trip; each malformed shape
rejected.
**Done when:** - [x] tests pass.

## Task 5: Balance bot and report

**Files:** `scripts/bot.ts`, `scripts/balance.ts`, `tests/bot.test.ts`, `docs/balance.md`
**Build:** hauler after two drones; outpost deploy beside a large rock once a hauler exists; host rocks skipped by
`pickRock`; report columns for hauler share and outpost units.
**Tests:** bot decisions; regenerate the report.
**Done when:** - [x] mid-game active-play share still passes ≥ 40 %.

## Task 6: Presentation

**Files:** `src/settings.ts`, `src/input.ts`, `src/ui/Hud.ts`, `src/ui/rockTooltip.ts`,
`src/ui/panels/FleetPanel.ts`, `src/render/outpostView.ts`, `src/render/Renderer.ts`, `README.md`,
`tests/tooltip.test.ts`
**Build:** `outpost` key action; tooltip, help line, fleet panel section and hauler statuses; outpost marker.
**Tests:** tooltip text (pure seam).
**Done when:** - [x] `npm run check` green.
