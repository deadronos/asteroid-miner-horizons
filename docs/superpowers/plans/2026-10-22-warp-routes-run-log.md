# Warp routes run log (#172)

- **Date:** 2026-10-22
- **Issue:** [#172](https://github.com/deadronos/asteroid-miner-horizons/issues/172)
- **Branch:** `claude/issue-172-b34d58`
- **Spec:** [`2026-10-22-warp-routes-design.md`](../specs/2026-10-22-warp-routes-design.md)
- **Plan:** [`2026-10-22-warp-routes.md`](2026-10-22-warp-routes.md)

## Setup

One session implemented all four tasks inline (no separate implementer/reviewer sessions); each task was checked
with the targeted test files, and `npm run check` ran green before the balance run and again before the commit.

## Verification

- Task 1: `tests/routes.test.ts` plus the existing `generateSystem` snapshot in `tests/modifiers.test.ts`, which is
  what pins route 0 to the pre-#172 systems.
- Task 2: `tests/commands.test.ts`: every route lands in exactly the system `warpRoutes` previews; `-1`, `3`, `0.5`
  and `NaN` are rejected with `Unknown warp route.` and the profile and run are deep-equal to before.
- Task 3: `tests/pause.test.ts` and the `routeCard` / `warpPanelKey` tests; then in the dev server: the WARP button
  opens three cards, the sim shows _PAUSED: menu open_, and a card's button warped into that card's system and
  closed the picker.
- Task 4: `tests/bot.test.ts`; `npm run balance` regenerated `docs/balance.md`.

## Deviations from the plan

- The route scoring started in `scripts/bot.ts` and moved to `richestRoute` in `src/sim/routes.ts` so the picker's
  "richest" badge and the bot cannot disagree.
- The README's "Ideas for later" entry for #172 was removed and the warp paragraph describes the picker.

## Tasks

| Task                         | Sessions | Rounds | Commit       |
| ---------------------------- | -------- | ------ | ------------ |
| 1 Route-seeded generation    | 1        | 1      | single squash |
| 2 `warp` carries a route     | 1        | 1      | single squash |
| 3 Route picker               | 1        | 1      | single squash |
| 4 Bot route choice + balance | 1        | 1      | single squash |

## Notes

- Lint flagged a test helper that captured nothing (`consistent-function-scoping`); hoisted to module scope.
- Rejected for now: forcing candidates to differ (distinct star classes). It would make route 0 diverge from the
  legacy system and couple the routes' rolls. The tests check that each of 20 seeds offers distinct systems, and that all three star classes and differing
  modifier sets appear across 40 seeds.
