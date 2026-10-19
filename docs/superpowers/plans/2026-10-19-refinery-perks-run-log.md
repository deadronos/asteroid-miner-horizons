# Refinery perks run log (#84)

- **Date:** 2026-10-19
- **Issue:** #84 — Refinery perks: faster refining and bigger batches
- **Branch:** `claude/project-thread-4x2h5l` (base `abe918c`, which raised `baseFleetCap` to 5)
- **Spec:** [`2026-10-19-refinery-perks-design.md`](../specs/2026-10-19-refinery-perks-design.md)
- **Plan:** [`2026-10-19-refinery-perks.md`](2026-10-19-refinery-perks.md)

## Verification

- `npm run check` green: 35 files, 539 tests.
- Refinery conservation holds with both perks maxed (`tests/refining.test.ts`); partial final cycles and time
  carried across jobs are covered.
- `npm run balance -- --seeds 10 --warps 10` regenerated `docs/balance.md`. Systems 1–4 are byte-identical to the
  fleet-cap-5 baseline (no perk is bought yet); the mid-game active-play share is 60 % (target ≥ 40 %).

## Deviation from the plan and why

- **Bot perk timing.** With the perks simply added to the bot's perk order, it bought the cheap Catalytic Furnace
  in system 3–4 instead of yield and optics, and systems 4–9 got slower than the fleet-cap-5 baseline. Refining is
  only a bottleneck once the warp's fuel takes a while to crack, so the bot now researches refinery perks only when
  refining the next warp's fuel would take over 60 s. Against the baseline, the summed median time of systems 5–10
  went from 80:31 to 76:14 (about 5 % faster), the largest gains in systems 5, 8 and 10:

  | System                   | 5    | 6     | 7     | 8     | 9     | 10    |
  | ------------------------ | ---- | ----- | ----- | ----- | ----- | ----- |
  | Fleet cap 5, no perks    | 9:46 | 10:42 | 11:17 | 15:34 | 13:21 | 19:51 |
  | Perks, bought eagerly    | 10:46 | 11:36 | 11:51 | 14:11 | 13:47 | 18:18 |
  | Perks, bought when slow  | 8:14 | 11:23 | 12:59 | 12:50 | 13:16 | 17:32 |

- **Balance runner.** As in #39, the reports were produced by an uncommitted sequential copy of
  `scripts/balance.ts`, because its worker threads cannot load TypeScript in the cloud container.
