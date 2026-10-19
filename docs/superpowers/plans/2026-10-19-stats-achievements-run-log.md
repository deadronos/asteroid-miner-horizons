# Stats and achievements run log (#40)

- **Date:** 2026-10-19
- **Issue:** #40 — Stats & achievements screen
- **Branch:** `claude/project-thread-idzpyo` (base `cb34e3b`)
- **Spec:** [`2026-10-19-stats-achievements-design.md`](../specs/2026-10-19-stats-achievements-design.md)
- **Plan:** [`2026-10-19-stats-achievements.md`](2026-10-19-stats-achievements.md)

## Verification

- `npm run check`: format, lint and typecheck clean; 568 tests, of which 565 pass in the cloud container. The
  three failures are 5 s timeouts in long simulation tests (`hazards off … 20000 ticks`, the bot's first-contract
  test, the autopilot cross-belt dock). The hazards one times out on the unchanged base commit too, and
  `npm run bench` gives the same tick cost on both (0.12–0.13 ms), so this is the container's speed, not the
  change.
- **Run unchanged.** Two seeds played by the bot for 40 sim minutes with hazards on hash to the same `run` and
  profile (minus the new fields) and the same `run.rng.s` on the base commit and on this branch. That is why
  `docs/balance.md` is not regenerated.
- **Pacing check.** In those 40 minutes (5 warps) the bot unlocked 13 of 21 achievements. It launched 13–15
  support ships, since every warp rebuilds the fleet, so Armada was raised from 10 to 25 launches to keep it a
  late unlock.

## Deviation from the plan and why

- **Fixture.** `tests/fixtures/save-v10.json` was produced on the base commit from a short system-3 game with
  non-zero warps, research, contracts, refined units and comets, so the migration's seeding is exercised.
