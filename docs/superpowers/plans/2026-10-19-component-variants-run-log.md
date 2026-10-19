# Component variants run log (#49)

- **Date:** 2026-10-19
- **Issue:** #49 — Component variants (sidegrades, not just tiers)
- **Branch:** `feat/component-variants` (base `e8be5da`)
- **Spec:** [`2026-10-19-component-variants-design.md`](../specs/2026-10-19-component-variants-design.md)
- **Plan:** [`2026-10-19-component-variants.md`](2026-10-19-component-variants.md)

## Setup

Orchestrated subagent-driven build, same shape as #48: one implementer subagent per plan task, a
separate reviewer per task against that task's diff, the orchestrator owning the plan, commits and
rulings. Spec and plan written and committed first; then six tasks; then a whole-branch review and
one fix wave. Ran on `feat/component-variants` in the main worktree (a normal repo, no worktree).

## Verification

- `npm run check` green after every task and after the fix wave: 31 files, 468 tests; `tsc --noEmit`
  for `src` and `scripts` clean.
- `npm run balance` was regenerated in Task 6; the bot uses **default** variants, so the report is a
  regression signal for the refactor. The delta is ≈ neutral; the few late-game cells that moved are
  #48 drift (the polished-bot commits `f03c2f5` landed after #48's own balance regeneration), not
  variant drift — verified independently in the final review.
- Default-variant numbers and prices are unchanged end-to-end: the `refining.test.ts` T1/T2/`OLD_T3`
  table and the `stats.test.ts` snapshot both pass on the default variants.

## Task table

| Task | Commits | Implementer rounds | Reviewer |
| --- | --- | --- | --- |
| 1 Variant model + behaviour-preserving refactor | `9a11a12` | 1 | Approved, 1 plan-mandated + 3 minor |
| 2 `install` chooses a variant | `a6a9a17` | 1 | Approved, 3 minor |
| 3 Wide-beam splash | `20115c3` | 1 | Approved, 4 minor |
| 4 Save v7 → v8 | `f256584` | 1 | Approved, 3 minor |
| 5 Refit UI variant choice | `04e84cd` | 1 | Approved, 3 minor |
| 6 Bot variant order + balance | `5e9ddb8` | 1 | Approved, 3 minor |
| Final whole-branch review + fix wave | `b99c289` | 1 | All 4 addressed, no new breakage |

No fix rounds were needed inside the tasks; the one fix wave followed the whole-branch review.

## Deviation from the plan and why

- **Task 1 (ruling).** `Fitted.variant` is required, so the typecheck rippled into four test files
  (`traits`, `audio`, `bot`, `hazards`) the brief did not list; the implementer added variant
  literals to keep the tree green. The `SAVE_VERSION` bump was deliberately left to Task 4 (spec §3
  assigns it there) and was runtime-safe until then because `variantDef` falls back to the default.
  Guarded by a standing constraint: the branch must not ship before Task 4.
- **Task 2 (accepted).** The variant payload is validated before the docking/slot check, so a bad
  variant on an undocked ship logs the variant warning rather than the docking message — untrusted
  payload first, consistent with rejecting invalid input.
- **Task 3 (accepted).** Splash fires whenever a Wide Beam is fitted, without gating on the target
  taking damage (spec §2's rule); `workRock` returns the union of target and neighbour fragments, so
  `runOrder` can chain onto a neighbour's fragment.
- **Task 6 (accepted).** The bot intentionally uses default variants so `npm run balance` isolates the
  refactor; the balance delta is #48 drift, recorded above.

## Reviewer findings accepted

- **Final review (Important):** the non-default-variant refund path had no test. Fixed in the wave:
  `tests/commands.test.ts` now installs `laser`/`wide`, removes it, and asserts the bank delta equals
  `halve(investedCost('laser','wide',1))` and differs from the focused refund — the assertion fails if
  `investedCost` ignores the variant.
- **Final review (Minor):** restore the tier-1 price in the empty-slot install labels; guard `install`
  against an unknown component id (`Object.hasOwn(COMPONENTS, cmd.comp)`) so a hand-built command is
  rejected rather than thrown; one README sentence about the laser/engine sidegrades. All fixed.

## Reviewer findings rejected or deferred

- **`install`'s `cur?.type === cmd.comp` guard ignores the variant.** Parked: unreachable from the UI
  (the Task 5 picker offers variants only on empty slots) and consistent with the spec's "remove +
  reinstall to change variant"; a latent trap worth a follow-up if a scripted sender is added.
- **Splash does not gate on the target taking damage.** Parked: spec §2 sanctions it, and the reachable
  case needs a stale order (the `mine` handler rejects a dense target below the gate).
- **`fromData` runs `isWallet(s.cargo)` before the new slot check, so `ships: [null]` throws via
  `parseImport`.** Parked: pre-existing, reported by the reviewer as out of scope.
- **`migrations[7]` overwrites any stored variant unconditionally.** Parked: a real v7 save never
  stored one; documented by a test.
- **Bot test guards only the laser entry; balance artifact generator-parameter drift (5- vs 10-warp).**
  Parked as housekeeping.
- **`TRAIT_INDEX`/threshold-style coupling, the `components.test.ts` splash test's weak assertions, and
  the `variantDef` fallback.** All minor; logged in the ledger.

## What landed

8 commits: the spec and plan, six task commits, and the final-review fix wave. The variant layer
(`VariantDef` under `ComponentDef`), `Fitted.variant`, the `install.variant` command, wide-beam
splash, save v8 with a fixture, the refit UI's variant picker, and a variant-carrying bot install
order — with default variants keeping today's numbers and prices.
