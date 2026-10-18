# Hazard-aware AI — run log

- **Date:** 2026-10-19
- **Issue:** #37, follow-up to the hazards feature (PR #76)
- **Branch:** `feat/hazard-ai`
- **Spec:** [`../specs/2026-10-19-hazard-ai-design.md`](../specs/2026-10-19-hazard-ai-design.md)
- **Plan:** [`2026-10-19-hazard-ai.md`](2026-10-19-hazard-ai.md)

## Setup

One Claude Code session, started as a side session by the hazards orchestrator. It wrote the spec and plan, then
implemented and measured all four tasks itself. It worked in its own git worktree off `main`, because the shared
checkout had moved to `main` after #76 merged.

## Deviation from the plan

- **One session did all four tasks, with no separate reviewer.** Each task is small (two predicates and two call
  sites), so the orchestrator-reviewer split was skipped. Instead, the session read the whole diff and ran a
  mutation check: with `dodgeHazards` and `unsafe` stubbed to `false`, all four new pilot tests fail. Two of them
  passed vacuously at first, because the drone's default home was already near the station or off the path. They
  now anchor the drone to a flagship parked in the danger.
- **Comet mining was dropped from the AI.** This is a consequence of the spec, not a change to it: a live comet's
  body counts as its own path, so drones and the bot never target one. Drones (90–105 u/s) cannot keep pace with a
  comet (130+ u/s) anyway.

## Verification

- `npm run check` was green after each task. The suite grew from 391 to 403 tests.
- **Off is byte-identical.** `npm run balance -- --seeds 10 --warps 10` matches the committed `docs/balance.md`
  except for the commit hash in its header, so `docs/balance.md` was not regenerated. Every new predicate is
  false when no flare or comet is pending, which is always the case with hazards off.

## Measurement

`--seeds 10 --warps 10`, seeds 1000–1009. "Old AI" is `main` at `0234b07`, re-run here. It reproduces the hazards
run log's medians exactly.

| System | Off | Normal, old AI | Normal, new AI | Harsh, old AI | Harsh, new AI |
| --- | --- | --- | --- | --- | --- |
| 1 | 5:07 | 5:07 | 5:07 | 5:07 | 5:07 |
| 2 | 5:47 | 6:08 | 5:49 | 6:33 | 7:10 |
| 3 | 6:26 | 5:59 | 7:17 | 6:08 | 6:58 |
| 4 | 7:43 | 8:45 | 8:20 | 8:45 | 8:13 |
| 5 | 9:50 | 10:57 | 9:43 | 10:05 | 9:32 |
| 6 | 10:08 | 11:54 | 12:10 | 9:52 | 11:15 |
| 7 | 9:55 | 9:16 | 10:57 | 11:44 | 10:02 |
| 8 | 13:08 | 13:25 | 13:50 | 13:24 | 13:06 |
| 9 | 12:16 | 13:57 | 12:40 | 15:14 | 13:33 |
| 10 | 15:33 | 16:30 | 15:18 | 18:04 | 15:40 |
| **Sum of medians** | 95:53 | 101:58 | 101:11 | 104:56 | 100:36 |
| **Warps > 2× previous** | 3 | 7 | 11 | 11 | 7 |

Time shows the cost of hazards over Off shrinking from +6.3% to +5.5% on Normal, and from +9.4% to +4.9% on Harsh.
The per-system medians are noisy: any change to the AI reshuffles every later decision, and the count of warps
that took more than twice the previous one moves both ways. Time alone is weak evidence. The direct measure is
damage.

**Damage taken.** A scratch script (not committed) ran the same 10 seeds × 10 warps through `runBot` and summed
the hull and shield every ship lost per tick:

| Level | Old AI | New AI |
| --- | --- | --- |
| Off | 8 645 | 8 645 |
| Normal | 20 060 | 9 352 |
| Harsh | 27 670 | 9 750 |

Damage above the Off baseline (rock collisions and star heat) falls from 11 415 to 707 on Normal and from 19 025 to
1 105 on Harsh. That is about 94% less on both levels. No ship was destroyed in any run, before or after.
Mid-game active-play share is unchanged at 59–60% (PASS). No tuning was needed.

## Notes for a reviewer

- **Known oscillation, accepted:** a drone on the wrong side of a long-lived comet path cannot cross it until the
  comet has gone, so it hovers at the edge of the corridor. This is safe, and it lasts at most the comet's flight
  (about 50 s).
- **Manual orders still win.** A drone or flagship under a player order does what it was told, whatever the hazard.

## Follow-ups

- Pirates (the deferred part of #37).
