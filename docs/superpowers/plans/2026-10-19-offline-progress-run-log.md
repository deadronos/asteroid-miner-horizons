# Offline progress run log (#41)

- **Date:** 2026-10-19
- **Issue:** #41 — Offline / idle progress (optional)
- **Branch:** `claude/project-thread-urtx0c` (base `d7eaae5`)
- **Spec:** [`2026-10-19-offline-progress-design.md`](../specs/2026-10-19-offline-progress-design.md)
- **Plan:** [`2026-10-19-offline-progress.md`](2026-10-19-offline-progress.md)

## Verification

- `npm run check`: format, lint and typecheck clean; 593 tests pass in the cloud container.
- **Calibration.** A headless script (not committed) bought 1, 3 or 5 basic drones on seeds 1–4, left the
  flagship docked and ran the tick for 300 s and 1200 s. While alive, drones delivered about 0.03 units per second
  per point of laser dps (0.015–0.042 across seeds), which sets `offlineUnitsPerDps`. Over 1200 s most unattended
  drones were destroyed, which is one reason the estimate is not a replay.
- **Scale check.** Three basic drones (78 dps) earn 0.23 units/s offline: about 840 units an hour and 6,700 at the
  8 h cap, roughly one mid-game system's delivered value (`docs/balance.md`). Active drone income in the balance
  report is several times that rate, so playing stays the faster route.
- **Run unchanged.** The feature runs only in `GameSession` on load; the tick and the bot are untouched, so
  `docs/balance.md` is not regenerated.

## Deviation from the plan and why

None.
