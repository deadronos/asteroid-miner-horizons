# Warp routes plan (#172)

**Goal:** let the player pick between candidate systems on warp.
**Architecture:** route-seeded `generateSystem`, a validated `route` on the `warp` command, pure preview helpers in
`src/sim/routes.ts`, a route-picker modal in the HUD, and a route-choosing bot.
**Tech Stack:** TypeScript, Vitest. **Spec:** [`2026-10-22-warp-routes-design.md`](../specs/2026-10-22-warp-routes-design.md)

## Global Constraints

- `src/sim` stays pure and deterministic; route candidates come from `(seed, number, route)` only.
- Route 0 reproduces the legacy system exactly (existing generator tests and snapshots unchanged).
- `run.rng`, contracts, hazards and traits keep their streams. No save shape change, no new dependency.
- `npm run check` green after every task; `docs/balance.md` only via `npm run balance`; `scratch.md` untouched.

## Review Focus

- Route 0 differs from the old generator (Task 1 test).
- A bad route is half-applied, e.g. data granted before the rejection (Task 2 test).
- Candidates the picker shows differ from the system the warp lands in (Task 2 test).
- The picker does not pause with _pause in menus_ or ignores Esc (Task 3).

## Task 1: Route-seeded generation and preview helpers

**Files:** `src/data/tuning.ts`, `src/sim/generate.ts`, `src/sim/routes.ts`, `tests/routes.test.ts`

- [x] **Build:** `TUNING.warpRoutes`; `generateSystem(seed, number, route = 0)`; `warpRoutes`, `isRoute`,
      `hazardRating`, `routeRocks`, `routeValue`.
- [x] **Tests:** same seed + route → same system; route 0 equals the default call; routes differ; hazard levels.
- [x] **Done when:** check is green.

## Task 2: `warp` carries a route

**Files:** `src/sim/commands.ts`, `src/sim/handlers.ts`, `src/sim/create.ts`, callers, `tests/commands.test.ts`

- [x] **Build:** `{ t: 'warp'; route }`, validation with `fail`, `newRun(profile, route)`.
- [x] **Tests:** warp lands on `warpRoutes(profile)[route]`; out-of-range / fractional routes rejected with nothing
      changed.
- [x] **Done when:** check is green.

## Task 3: Route picker

**Files:** `src/ui/panels/WarpPanel.ts`, `src/ui/panels/TopBar.ts`, `src/ui/Hud.ts`, `src/input.ts`?,
`src/pause.ts`, `src/main.ts`, `src/style.css`, `tests/pause.test.ts`, `tests/routes.test.ts`

- [x] **Build:** modal with one card per route; WARP opens it; Esc closes; counts as a menu for pausing.
- [x] **Tests:** the pure `routeCard` text; `pauseKind` with the picker open.
- [x] **Done when:** check is green and the picker is verified in the dev server.

## Task 4: Bot route choice and balance report

**Files:** `scripts/bot.ts`, `scripts/balance.ts`, `tests/bot.test.ts`, `docs/balance.md`, `README.md`

- [x] **Build:** `chooseRoute`, `BotOptions.route`; report states the policy; regenerate the report.
- [x] **Tests:** the bot picks the highest-value route.
- [x] **Done when:** check is green and the report is regenerated.
