# Station Contracts — Orchestration Run Log

- **Date:** 2026-10-18
- **Issue:** #35, branch `feat/contracts`
- **Plan:** `docs/superpowers/plans/2026-10-18-contracts.md` · **Spec:** `docs/superpowers/specs/2026-10-18-contracts-design.md`
- **Setup:** Claude (Opus) wrote the spec and plan, orchestrated, verified and committed. Each task was implemented by one opencode session and reviewed by a second, separate opencode session. Both used `opencode run --auto -m opencode-go/deepseek-v4.1-flash`, run non-interactively. Fix rounds went back to the implementer session with `-s <id>`.
- **Verification after every task (orchestrator):** `npm run check` and a full read of `git diff`. Before Task 7, I also ran a balance run to confirm the sim was unchanged while the bot ignored contracts.

## Deviation from the suggested order

I moved the save migration to Task 3, straight after `Run.contracts` was added in Task 2 (the suggestion had it fifth). That way, from the commit that first ticks the board (Task 4) onwards, there is never a commit where an old save can be loaded without a board.

## Per task

Times are wall-clock times for the `opencode run` call. "Rounds" counts the implement call plus fix calls; hung attempts are listed separately.

| # | Task | Implementer session | Reviewer session | Rounds (impl + fix) | Time impl / review / fix | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Data + types | `ses_eb3fba607ffezyQmOAhrtctekc` | `ses_eb3ed029fffeU0rxFI3zJbbyoN` | 1 + 1 | 50 s / 47 s / 15 s | `83a1fbc` |
| 2 | Seeded generation, `Run.contracts` | `ses_eb3d8df7dffer9BTDz1abJw70j` | `ses_eb3d7842dffeN1W2pnwhUhdOsg` | 1 + 1 | 77 s / 55 s / 24 s | `197a6ab` |
| 3 | Save migration v2→v3 | `ses_eb3d5e950ffeEfTxxOrXYC3ktE` | `ses_eb3d435acffeqa6NkwTUAD26RW` | 1 + 1 | 102 s / 81 s / 98 s | `ae57bfa` |
| 4 | Progress, payout, timers | `ses_eb3d0eec5ffemX7lG5AbJBRgdu` | `ses_eb3cf86a3ffe5DiZdOCW0ioTNL` | 1 + 1 | 81 s / 148 s / 36 s | `64b3afa` |
| 5 | accept/abandon commands | `ses_eb3cc1a58ffeL2wbz03lE68CQc` | `ses_eb3cb3ca5ffeQvd6AbiwiYTqxQ` | 1 + 1 | 47 s / 44 s / 19 s | `3f3eef1` |
| 6 | HUD panel | `ses_eb3c9ee9fffe3yIqFX1B4z10zw` | `ses_eb3c8fd6affemm7rJNB5zXlbt4` | 1 + 1 | 44 s / 76 s / 21 s | `feca40a` |
| 7 | Bot + balance + tuning | `ses_eb3c6cc8effeLJuMKGN0Wqpo3l` | `ses_eb3bed3d1ffedLJf9LwjM5zNpW` | 1 + 1 | 496 s / 104 s / 94 s | `e31a523` |
| — | `docs/balance.md` regenerated (orchestrator) | — | — | — | ~8 s | `303bf70` |

On every task, `npm run check` was green after the first implement round. No task needed a second fix round.

### Task 1 — data + types
- **Implementer:** matched the plan exactly. Nothing to fix.
- **Reviewer:** 2 nits: no reverse check that `CONTRACTS` keys are all in `CONTRACT_KINDS`, and the `breakLarge.describe` formatter is untested. **Real, but minor.** Sent back and fixed.
- **Orchestrator fixes:** none.
- **Failures:** see the hang section. Two reviewer attempts hung, and the first fix attempt hung for 540 s.

### Task 2 — seeded generation
- **Implementer:** correct on the first pass. It used a dedicated board RNG and `board.nextId`, and wired `newRun`.
- **Reviewer:** 3 minor test gaps, all **real**. (a) The reward-rounding tolerance only held while pay resources were worth ≤ 2. (b) The reward of a rolled contract at a higher system was never asserted. (c) The isolation test did not check that rocks were unchanged. It also raised 2 nits that I **rejected**: a guard for an empty eligible-kinds list (unreachable, because `deliverOre` is always eligible) and a cosmetic point about where the system number comes from. Unprompted, the reviewer loaded a code-review skill.
- **Fix:** all three test gaps closed, including a two-game test that ticks both games for 5 s.

### Task 3 — save migration
- **Implementer:** correct per the spec.
- **Reviewer:** **1 major, confirmed real.** Before this change the production migration table was empty. The first real step dereferences `run.system.number`, so a malformed v2 payload now made `parseImport` **throw** instead of returning `{ ok: false }`. `readSlot` relies on `parseImport`, so a corrupt slot in localStorage would crash the `GameSession` constructor. I reproduced it with a `tsx` one-liner (`TypeError: Cannot read properties of undefined (reading 'number')`). It also found a real minor issue: `fromData` only validated `contracts.offers`.
- **Fix:** `migrate()` now catches a throwing step and returns null. A new `chainCovers()` lets `parseImport` keep the "Unsupported save version" message for genuine gaps in the migration chain. Board validation now also checks `nextId` and `rng.s`. Tests were added for each case.
- **Assessment:** this was the most valuable catch of the run, and the spec I wrote had missed it.

### Task 4 — progress / payout / timers
- **Implementer:** correct. Completion is checked before the timer and paid in one place, and no rewards go into `runValue`.
- **Reviewer:** 4 minor findings and 2 nits. **Real:** the `runValue` invariant was untested; the tick-order header comment was stale; the no-op test was vacuous; and the `setActive` helper used `reward: {}`, which hid the multi-resource payout path. The nit about a side effect inside `filter((o) => (o.timeLeft -= dt) > 0)` is also real; I had spotted it independently. The "+free" log-text nit is only reachable through the test helper, so I skipped it.
- **Fix:** all of the above were applied.
- **Orchestrator check:** the balance report with a bot that ignores contracts was **byte-identical** to the pre-contract baseline (apart from the header line). This proves the separate RNG stream does not disturb the sim.

### Task 5 — commands
- **Implementer:** correct and minimal. It grepped for other places that switch on `Command['t']` and found none.
- **Reviewer:** no critical or major findings; 4 nits. I sent 3 test-hardening ones: assert `run.rng` and `nextId` are unchanged, assert fields carry over from the offer, and assert the log text. The cosmetic one was skipped.

### Task 6 — HUD panel
- **Implementer:** matched the plan and the existing `Panel`/`bind` pattern; `npm run build` passed.
- **Reviewer:** no critical or major findings. One real minor: on wide but short viewports, `#fleet` and `#contracts` overlapped. The cause was the CSS numbers in **my** plan. A few nits; I sent the empty-state one.
- **Missed by the reviewer, found by the orchestrator (major):** the panel's structure key was `active id | offer ids`. Board ids restart at 1 on every new run, so after a quick warp or loading a different save the key can be identical (`-|1,2,3`) while the contracts differ. The panel would then keep stale goal text. The reviewer had explicitly called the key "Correct". I sent the fix to the implementer: the key now includes the seed and system number.
- **Browser smoke test (orchestrator, chrome-devtools on `vite` at 1280×800 and 1280×600):** the panel renders, Accept moves the offer to active (progress bar, 6:00 timer, Abandon), and other Accept buttons are disabled. At 600 px tall there is no overlap (fleet 64–184, contracts 190–390, log 519–590). **I observed a UX gap:** the board can show identical offers; one seed showed three "Deliver 90 ❄ ice".

### Task 7 — bot + balance + tuning
- **Implementer:** added the bot's accept step, contract-aware `pickRock`, the report columns and the CSV fields. It tuned on its own across about 11 balance iterations and documented each in a table (growth/mul against per-system share). Along the way it hit and fixed a zsh word-splitting bug in its own grid-search loop. Final values: `contractGrowth` 1.3→1.15, `contractRewardMul` 0.5→0.68, `deliverCrystal.base` 12→6, `breakLarge` base 6→5 and time limit 300→360 s.
- **Reviewer:** reproduced the report byte-for-byte and recomputed the medians from the CSV; no critical or major findings. Real minor: the bot test only asserted `completed >= 1` (fixed with 3 targeted tests). Nits left as known gaps: under a deliver contract, crystal still gets the 0.5 distance bonus; `contractRockValue: 25` underestimates a real large rock (~41 units at system 1), so `breakLarge` underpays; the bot can accept while its flagship is respawning; systems 4 and 5 sit near the 10 % floor.
- **Orchestrator:** committed the code, then regenerated `docs/balance.md` at that commit with the documented command, exactly as before.

## Balance: before vs after

The table shows per-system medians across 10 seeds, `--seeds 10 --warps 5`. "Before" is commit `0d1681c`, where no contracts exist (identical to the committed `ebdab29` report). "Untuned" is the plan's starting values with the bot playing contracts (from the implementer's iteration 1).

| System | Contract share: before | untuned | **final** | Contracts done (final) | Time in system: before → final | HD: before → final |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 % | 10 % | **18 %** (9–30) | 3 | 10:37 → 8:30 | 4 → 3 |
| 2 | 0 % | 12 % | **18 %** (5–26) | 3 | 12:27 → 9:55 | 5 → 4 |
| 3 | 0 % | 10 % | **16 %** (2–27) | 3 | 9:31 → 7:36 | 6 → 6 |
| 4 | 0 % | 7 % | **11 %** (0–22) | 3 | 11:05 → 10:16 | 6 → 6 |
| 5 | 0 % | 4 % | **12 %** (9–28) | 4 | 16:12 → 12:26 | 8 → 9 |

No walls appeared. Contracts make systems faster, mostly because ice rewards bring the warp forward. As a side effect, HD is lower in systems 1 and 2: a run warps earlier, so `runValue` is smaller. Whether that trade is wanted is a design call.

## opencode failures and quirks

- **Hangs before a session was created (5 occurrences).** `opencode run` printed nothing, created no session (it was absent from `opencode session list`), and the server log showed `cli starting` with no request afterwards. The affected calls:
  - Task 1 review: twice through the background service, killed after 611 s and 264 s.
  - Task 1 fix 1: `--standalone -s`, killed by the watchdog after 540 s.
  - Task 2 implement: twice; 480 s (watchdog) and 141 s (killed while diagnosing).
- **Mitigation.** I added `--standalone`, `</dev/null` on stdin and `--print-logs`, plus a watchdog that retries a run with zero output. After this, all 17 remaining calls succeeded on the first attempt. I can't tell whether the cause was stdin inheritance or the shared background service: both changed together, and a trivial standalone `-s` continuation had already worked before `</dev/null` was added. **About 35 minutes of wall-clock time were lost to hangs**, more than all successful implement calls combined.
- **`-s` continuation works**, and in the JSON stream the session id stays the same across fix rounds.
- The models sometimes load skills unprompted (the code-review skill). It did no harm.
- No implementer ever committed, touched `scratch.md`, or strayed outside its task scope. All of them ran `oxfmt` and `npm run check` themselves.

## Interventions summary

| Kind | Count | Details |
| --- | --- | --- |
| opencode implement rounds | 7 | one per task, all green on first `npm run check` |
| opencode fix rounds | 7 | one per task, all accepted |
| opencode review rounds | 7 | 1 major real (T3), ~16 real minors/nits, 4 nits rejected |
| Orchestrator code edits | 0 | none; every code change was written by opencode |
| Orchestrator-found bugs routed to opencode | 1 | T6 stale panel key (missed by the reviewer) |
| Orchestrator verification beyond check/diff | 3 | T3 `tsx` repro of the crash, T4 balance identity check, T6 browser smoke test |
| Orchestrator-only commits | 2 | spec + plan (`a5a3b88`), regenerated `docs/balance.md` (`303bf70`) |
| Infrastructure failures | 5 hangs | see above |

## Overall assessment

- **Quality.** It was high for a "flash" model given a tight plan. Every implementation compiled, followed the house patterns (handler map, `Panel` + `bind`, migrations table) and had sensible tests. The code needed no orchestrator edits. The plan's detail (exact signatures, values and test lists) clearly carried most of the weight; the model filled in rather than designed.
- **Reviewer value.** It was good but uneven. It caught one real major bug that both the spec author and the implementer missed (T3: throwing migration), and many legitimate test gaps. It missed a UI state bug (T6), which it judged correct, and it under-weights non-sim, runtime-lifecycle issues (warp or load reusing ids). Its findings skew towards test hardening.
- **Cost in rounds.** The run was cheap: exactly 1 implement + 1 fix per task, about 29 minutes of successful model time overall (sum of the timed runs: 15 min implement, 9 min review, 5 min fix). Task 7 was the most expensive single call (8 min) because it ran 11 balance iterations itself. Infrastructure hangs cost more time than the model did.
- **Where the model struggled.**
  - Seeing state across contexts (the UI key reuse).
  - Spotting that the first real migration step creates a new failure mode (only the reviewer saw it, not the implementer).
  - Shell scripting (the zsh loop).
  - Tuning: it chased an exact 10–20 % band per system on 10 seeds, which is mild overfitting (system 4 sits at 10.9 %).
- **Recommendations.**
  1. Always run opencode with `--standalone </dev/null`, a watchdog, and retry on zero output.
  2. Keep plans at this level of detail. The model executes specs faithfully but rarely questions them; spec bugs (the CSS overlap numbers) came through unchanged until review.
  3. Add a short "lifecycle checklist" to UI and save tasks: warp, load another slot, new game, old save. Both reviewer misses and spec gaps came from there.
  4. Have the orchestrator, not the reviewer, run a browser smoke test for UI tasks.
  5. For tuning, ask for robustness (e.g. more seeds or a margin inside the band) instead of a band hit on one seed set.

## Known gaps (follow-ups)

- Duplicate offers on the board (e.g. three identical "Deliver 90 ice"). Rolls are uniform with replacement; consider excluding kinds already offered.
- `contractRockValue: 25` underprices `breakLarge` compared with a real large rock (~41 units).
- Contract shares in systems 4 and 5 (11 % and 12 %) are close to the 10 % floor on this seed set.
- An active contract is silently dropped on warp (new run, new board); no log line says so.
- No reward types beyond resources and HD ("rare parts" is out of scope until a parts inventory exists).
