# Refining — Orchestration Run Log

- **Date:** 2026-10-18
- **Issue:** #36, branch `feat/refining` (off `main` at `2c2b1ee`, which includes #35 contracts)
- **Plan:** `docs/superpowers/plans/2026-10-18-refining.md` · **Spec:** `docs/superpowers/specs/2026-10-18-refining-design.md`
- **Setup:** Claude (Opus) wrote the spec and plan, orchestrated, verified, smoke-tested the UI and committed. Each task was implemented by one opencode session and reviewed by a second, separate opencode session. Both used `opencode run --auto --standalone -m opencode-go/deepseek-v4.1-flash --format json … </dev/null`, wrapped in a watchdog script (kill after 480 s without output, retry up to 3 times on zero output). Fix rounds went back to the implementer session with `-s <id>`.
- **Verification after every task (orchestrator):** `npm run check` and a full read of `git diff`. I also ran balance reports myself for Tasks 6 and 7, did browser smoke tests for Tasks 5 and 6 (chrome-devtools on `vite`), and ran local bot experiments in Task 6.

## Applying the #35 recommendations

| #35 recommendation | What I did |
| --- | --- |
| `--standalone </dev/null`, watchdog, retry on zero output | Used on all 25 calls. **No hangs, no retries, no stderr output.** |
| Keep plan detail at the #35 level | Same format: exact signatures, start values, test lists and a "done when" line per task. |
| Lifecycle checklist for UI/save tasks | Added a "Lifecycle checklist" section to the plan, put it in every reviewer prompt, and spelled it out in the Task 2 and Task 5 implementer prompts. |
| Orchestrator, not reviewer, does the browser smoke test | Done for Task 5 (layout at 1280×800, 1280×600, 1024×700, 800×700; queue, merge, cancel, warp, load another slot, new game, migrated v3 save) and again after Task 6 (warp in fuel end to end). |
| Robust tuning | Two disjoint seed sets: A = `--seeds 20` (1000–1019) and B = `--seeds 10 --seed-start 2000`. Baselines for both were computed on `main` (for set B in a temporary worktree with the seed offset patched in). |

## Orchestrator-only setup

- Before Task 1 I generated a **frozen v3 save fixture** (`tests/fixtures/save-v3.json`). It is the v2 fixture migrated and ticked once at `2c2b1ee`, so the v3 → v4 migration could be tested against a real v3 save. It was committed with the spec and plan (`e378d38`).
- I put the save migration in Task 2, straight after the state change in Task 1, as #35 did. I put the HUD (Task 5) **before** the cost switch (Task 6), so that no commit makes warps cost fuel without a UI to refine it.

## Per task

Times are wall-clock times for the `opencode run` call. "Rounds" counts the implement call plus fix calls. No call hung or needed a retry.

| # | Task | Implementer session | Reviewer session | Rounds (impl + fix) | Time impl / review / fix | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Refined kinds, recipes, state | `ses_eb1d75c1cffeM50kLmreh2j6p0` | `ses_eb1d52854ffePJPZKLFzEFBZms` | 1 + 1 | 130 s / 111 s / 20 s | `c580f68` |
| 2 | Save migration v3 → v4 | `ses_eb1d2c880ffezLcuEgmpJYMzmL` | `ses_eb1d086e7ffeubP9IVGS4d64Yj` | 1 + 1 | 140 s / 270 s / 160 s | `7ee200c` |
| 3 | Queue logic + tick | `ses_eb1c9961cffeRndien54oOINK9` | `ses_eb1c714d5ffem5cWByH18LQNnN` | 1 + 1 | 150 s / 270 s / 261 s | `48ed844` |
| 4 | refine / cancelRefine commands | `ses_eb1be97e7ffeI20qYaEfbBo1vH` | `ses_eb1bbdf13ffeJruevuI2JWHZ5J` | 1 + 1 | 170 s / 151 s / 110 s | `8a96735` |
| 5 | HUD refinery panel | `ses_eb1b784acffeFLUkTKWshjzeWV` | `ses_eb1b55273ffe35VbFlVo39MTIQ` | 1 + 1 | 130 s / 380 s / 170 s | `ba92da8` |
| 6 | Costs → alloy/fuel, bot, report | `ses_eb1ac2952ffexn2Y5YJEDAN4Vq` | `ses_eb1a3facdffenUqEurBDWw6cFm` | 1 + 2 | 431 s / 792 s / 60 + 90 s | `e82e2c5` |
| 7 | Tuning (two seed sets) | `ses_eb1948257ffe5zLJu1QqaTl3bS` | `ses_eb180ffebffeq4sIzBu5zlfyrN` | 1 + 2 | 1233 s / 401 s / 611 + 130 s | `208e1aa` |
| — | `docs/balance.md` regenerated (orchestrator) | — | — | — | ~8 s | `c22e3cd` |

On every task `npm run check` was green after the first implement round. Tasks 6 and 7 used the maximum of two fix rounds.

### Task 1 — refined kinds, recipe data, refinery state
- **Implementer:** matched the plan. Unprompted, and correctly, it narrowed `Fx` crack/collect kinds and the renderer's `ROCK_TINT` to `RawResource` rather than inventing tints for alloy/fuel.
- **Reviewer:** "Major": old saves load with `NaN` banks. **Rejected as a defect of this task:** this is the planned split, where Task 2 adds the migration, exactly as in #35. Real minor: the top bar showed `▣ 0 ◉ 0` from system 1. Real nit: the module header promised logic that only arrived in Task 3. Both were sent back and fixed.

### Task 2 — save migration v3 → v4
- **Implementer:** correct. Both frozen fixtures migrate; it reworked the test helpers so the "v4 without X" rejection tests build genuine v4 shapes.
- **Reviewer:** no critical or major findings. **Real:** `fromData` did not check wallet completeness, so a hand-edited v4 save without `fuel` would poison the bank with `NaN` forever; a stale comment; `produced: []` was accepted; the helper save was not truly v4-shaped; the malformed-save test should assert the exact error. **Rejected:** "v3 saves from the interim build lose refined goods" (that build was never released, and the spec prescribes this) and a wording nit.
- **Orchestrator addition:** I also asked for validation of queued jobs (a known recipe and numeric counters), because the Task 3 tick indexes `RECIPES[job.recipe]`.

### Task 3 — queue logic and the tick
- **Implementer:** correct, with leftover time carried across batches and jobs. One big `dt` equals 1800 small ones.
- **Reviewer:** no critical or major findings; 4 minors and 1 nit, **all real**. (M1) A `NaN` count passed `refineBlock` and queued a job that produced output forever. (M3) A saved job with `count <= 0` also produced output forever. (M2) `pay()`'s result was ignored. (M4) The `maxBatches` merge-headroom branch was untested. (N1) The big-vs-small-`dt` test compared two empty queues. **I had spotted M1 and M3 independently before the review**; the reviewer confirmed both with probes. All were fixed, including stricter `isQueue` validation in `save.ts`.

### Task 4 — commands
- **Implementer:** correct and minimal. It reused `queueRefine`'s clamped count for the log.
- **Reviewer:** no critical or major findings; 5 real findings, all sent back. The "clamped amount" test never clamped; the refund for the log was recomputed rather than reused (latent divergence); log ordering after a warp was unasserted; out-of-range cancel tests were thin; an import was out of order. One "observation" (the warp warning logs remaining rather than paid batches) is the intended behaviour.

### Task 5 — HUD refinery panel
- **Implementer:** followed the `Panel` + `bind` pattern; the structure key includes seed and system (the #35 lesson); `npm run build` passed.
- **Orchestrator browser smoke test:** I loaded the frozen v3 fixture into a save slot (an old save migrating in the browser), then checked queue +10/+1/Max, merge, cancel with refund (`refunded 80⬢`), the progress bar, the done/total label, a warp with a queued job (warning logged after the warp line, panel rebuilt, "Queue empty."), loading another slot, and a new game. No console errors except a 404 (most likely the favicon). **Found a real layout bug:** at 1024×700, `#help` (x 293–704) overlapped `#log` (x 10–450). The cause was the CSS numbers in **my** plan, which moved help to `right: 320px`.
- **Reviewer:** this session reported that **no shell tool was available**, so it reviewed by reading files and doing layout arithmetic by hand. Even so, it **independently found the same help/log overlap** (as its one major), plus an index-based-cancel race and the untested structure key. **Sent:** the overlap fix (help hidden below 1200 px), an exported pure `refineryKey` with tests, and Max never sending 0. **Not fixed, logged as a known gap:** the cancel race (bounded to one 100 ms HUD refresh; a stable job id would need a state and save-shape change). Also skipped: `min-height` on viewports under 480 px tall, and a missing `/** */` (the sibling panels have none either).
- **Re-check in the browser after the fix:** help is hidden at 1024 px; at 1280 px nothing overlaps.

### Task 6 — costs to alloy/fuel, bot, report
- **Implementer:** the costs, warp, top bar, report column, `--seed-start` and tests were all correct. Its first balance run showed the opening badly broken: **first purchase 0:00 → 5:22**.
- **Orchestrator-found bug (fix round 1, before review):** `ok()` applied the ice reserve to *every* purchase, but the old bot exempted ice-free ones (`!c.ice || …`). **The root cause was the wording of my spec §11**, which the implementer followed faithfully. After this fix, the opening was **faster** than the baseline (first drone 4:38 against 5:42 on 20 seeds).
- **Orchestrator diagnosis:** I ran local experiments (temporary edits to `bot.ts`, reverted afterwards). (a) Without pre-refining the reserve, the opening matched the baseline exactly. (b) A probe showed the reserve rule is obeyed (the drone is bought at 192 ice-equivalent, above the 150 required). (c) Sending the refine *alongside* the normal command restored the baseline opening. **Cause:** `[refine]` replaced that 0.25 s decision cycle's move/mine/contract command, which changed the bot's mining pattern.
- **Reviewer:** it called the opening drift a real **major**, but attributed it to a "looser" fuel-counted reserve. **That diagnosis was wrong** (see the probe in (b)). Its controlled variants did not isolate pre-emption. Real minors: the report's table delimiter row was one cell short; the value-equivalence test tolerated drift that is exactly 0; the warp button lost its `(+N HD)` readout, **which my plan had dropped**. One nit (installs in the alloy walk) is inert.
- **Note:** my local `bot.ts` experiments ran while this reviewer session was active, so it may have read my temporary `EXP_*` edits. Its findings do not mention them, and it only wrote to `/tmp` files.
- **Fix round 2:** refines ride alongside the flagship order, and a refine cycle skips purchases; plus the three minors.

### Task 7 — tuning on two seed sets
- **Implementer:** 1233 s, the longest call of the run. It found the one real lever on its own: the bot refines the second half of a warp's fuel at the end, so the fuel batch time sits on the critical path. Fuel time 1 → 0.5 s brought every per-system time within ±10 % on both sets. It ran 8 documented iterations: no-skip variants, reserve 0.4, buy-first, warp fuel 45/55. It reported two opening misses (+13 %) honestly, but **argued they were seed noise**.
- **Reviewer:** reproduced every number byte for byte (including main's baselines). It **proved the noise argument wrong for this change**: the opening table is identical at fuel time 1 and 0.5, so the misses came from the Task 6 bot policy. Its proposed mechanism was again off, but the conclusion was right.
- **Orchestrator hypothesis (fix round 1):** the Task 6 "skip purchases in a refine cycle" rule loses a whole docking visit. `nextPurchase` only runs while docked, a refine typically fires right after an unload, and the same cycle sends the ship out again. The fix to test: price the purchase against the bank as it will be after the refine, and issue both. **Confirmed:** the opening came back within 0–9 % on both sets (first drone and fleet full exactly at baseline). The implementer then **reverted it**, because I had told it to keep the fix only if every time stayed within ±10 %, and set A system 5 was +13.8 %.
- **Orchestrator decision (fix round 2):** keep the projected-bank fix. It is the faithful bot (the skip variant only looks faster because it loses purchases), and +13.8 % is within the plan's hard ±15 % target, with no walls and HD within ±1. I declined the implementer's offer to also tune warp fuel to 48/49: one unit there moved a cell by 5 points, which is chaotic.

## Balance: before vs after

Medians from `--warps 5`. "Before" is `main` (`2c2b1ee`). Set A = seeds 1000–1019 (`--seeds 20`); set B = seeds 2000–2009 (`--seed-start 2000`).

**Opening (system 1)**

| Milestone | A before | A after | B before | B after |
| --- | --- | --- | --- | --- |
| First purchase | 0:00 | 0:00 | 0:00 | 0:00 |
| First tier-2 upgrade | 7:26 | 7:46 (+4 %) | 7:33 | 8:16 (+9 %) |
| First drone | 5:42 | 5:42 | 6:36 | 6:36 |
| Fleet full | 5:42 | 5:42 | 8:10 | 8:10 |

**Per system: time in system / HD**

| System | A before | A after | B before | B after |
| --- | --- | --- | --- | --- |
| 1 | 8:12 / 3 | 8:25 (+3 %) / 3 | 9:13 / 3 | 9:26 (+2 %) / 4 |
| 2 | 8:39 / 5 | 9:02 (+4 %) / 5 | 7:36 / 4 | 7:50 (+3 %) / 4 |
| 3 | 8:03 / 5 | 8:26 (+5 %) / 5 | 8:04 / 5 | 7:38 (−5 %) / 6 |
| 4 | 10:26 / 7 | 10:23 (−0 %) / 7 | 11:15 / 7 | 11:33 (+3 %) / 7 |
| 5 | 11:29 / 8 | 13:04 (**+14 %**) / 8 | 12:15 / 7 | 13:24 (+9 %) / 8 |

- No walls in any run. Fuel refined per system: 50 / 68 / 91 / 113 / 153 (the warp cost). Alloy is smelted only in systems 4–5 (median 0, up to 100–164; 12 of 100 warps on set A) when the bot reaches tier-3 parts.
- Contract and drone share are essentially unchanged; in the committed 10-seed report, contract share is 21 / 19 / 14 / 13 / 16 % against 21 / 20 / 16 / 12 / 13 % before, and drone share is 37–46 %.
- In the committed `docs/balance.md` (the original 10 seeds), system 5 reads 14:16 against 12:25 (+15 %), right at the edge. The 20-seed figure (+14 %) is the more robust one. Late warps get slightly slower because tier-3 alloy and late-warp fuel compete with ice purchases. This is the intended "refining costs time" trade, but it is the number to watch.

| Stage | Set A sys-5 time | Opening (A, first drone / fleet full) |
| --- | --- | --- |
| Task 6 first cut (reserve on all purchases) | 13:44 (10 seeds) | first purchase 5:22 |
| Task 6 final (refine pre-empts nothing, skip purchases) | 11:45 | 5:54 / 6:28 |
| Task 7 fuel 0.5 s, skip | 12:15 | 5:54 / 6:28 |
| **Task 7 final (fuel 0.5 s, projected bank)** | **13:04** | **5:42 / 5:42** |

## opencode failures and quirks

- **Hangs: none.** All 25 calls (7 implement, 7 review, 11 fix) finished on the first attempt with output, and every `.err` file is empty. Compared with #35 (5 hangs, about 35 minutes lost, all before `--standalone </dev/null` was adopted), the setup **removed the hangs completely in this run**. I still can't separate the two causes (standalone server vs stdin inheritance), because both were applied together from the start.
- **Tool environment varied between sessions.** The Task 5 reviewer reported "Shell is not available" and used a Playwright `execute` tool and file reads instead; all other sessions had a shell. Its review quality did not suffer (it still found the major overlap).
- **Reviewers wrote only scratch files.** The Task 6 reviewer created `/tmp/variant.ts` and `/tmp/runvariant.ts`; the Task 7 implementer created and removed a `/tmp` worktree of main. No session ever edited a repo file it wasn't supposed to, committed, or touched `scratch.md`.
- **`-s` continuation** kept the same session id across up to three calls (Task 7).
- **Long calls:** the Task 7 implementer took 1233 s and its first fix round 611 s, because they ran many balance iterations themselves. Both stayed under the watchdog because output kept flowing.
- **Housekeeping:** my scratchpad held files from the #35 run; my new runner script initially overwrote the old `run.sh` there before I moved everything to a fresh subdirectory. This had no effect on the repo.

## Interventions summary

| Kind | Count | Details |
| --- | --- | --- |
| opencode implement rounds | 7 | one per task; all green on the first `npm run check` |
| opencode fix rounds | 11 | 1 each on T1–T5, 2 each on T6–T7 |
| opencode review rounds | 7 | majors: T5 overlap (real), T6 opening drift (real, wrong diagnosis), T7 opening miss (real, wrong mechanism); T1 "major" rejected (planned split); ~25 real minors/nits; 4 rejected |
| Orchestrator code edits committed | 0 | every committed code change was written by opencode |
| Orchestrator temporary experiments | 3 | T6 `bot.ts` variants (no pre-refine; refine alongside) and a drone-time probe; all reverted |
| Orchestrator-found bugs routed to opencode | 5 | T2 queue-job validation; T3 NaN count and `count <= 0` (also found by the reviewer); T5 help/log overlap (also found by the reviewer); T6 reserve on ore-only purchases; T6/T7 refine pre-emption and the lost docking-visit purchase |
| Bugs that were the orchestrator's own spec/plan mistakes | 3 | spec §11 reserve wording (T6), the help CSS position (T5), the dropped `(+N HD)` label (T6) |
| Orchestrator verification beyond check/diff | 6 | 2 browser smoke tests, 20-seed and set-B balance runs at T6 and T7, a main worktree baseline for set B, the drone probe |
| Orchestrator-only commits | 2 | spec + plan + v3 fixture (`e378d38`), regenerated `docs/balance.md` (`c22e3cd`) |
| Orchestrator decisions overriding opencode | 1 | T7: kept the projected-bank bot despite the strict ±10 % keep rule I had set |
| Infrastructure failures | 0 | — |

## Comparison with the #35 run

| | #35 contracts | #36 refining |
| --- | --- | --- |
| Hangs / retries | 5 hangs, ~35 min lost | 0 |
| Successful model time | ~29 min | ~107 min (impl 40, review 40, fix 27) |
| Fix rounds | 7 (1 per task) | 11 (2 on T6 and T7) |
| Reviewer majors (real) | 1 | 3 (+1 rejected) |
| Orchestrator-found bugs | 1 | 5 |
| Orchestrator code edits | 0 | 0 |

The extra time went almost entirely into balance work: the bot and tuning tasks (6, 7) took 61 % of model time. Refining touches the bot's core economy (warp reserve, purchase timing), so the bot became a first-class part of the feature rather than an add-on.

## Overall assessment

- **Quality.** For tasks 1–5 (data, migration, sim, commands, UI), implementation quality was again high. Every task compiled and followed house patterns; the only real bugs were edge cases (NaN counts, corrupt saves) that the reviewer caught. The plan's precision did most of the work again.
- **Reviewer value.** It was strong on code (T3: every finding real; T2 wallet validation) and on layout arithmetic, even without a shell (T5). It is weaker at **causal diagnosis of behaviour**: twice (T6, T7) it correctly flagged a balance regression but named the wrong mechanism. Its measurements were reliable and its explanations were not.
- **Where the model struggled.** Bot behaviour is subtle and emergent. The implementer translated my reserve rule literally (including my mistake), and argued "noise" for a systematic effect. Distinguishing a policy artefact from seed noise took controlled experiments, which the orchestrator ended up doing.
- **Recommendations.**
  1. Keep `--standalone </dev/null` with a watchdog; it was flawless here.
  2. For bot or balance tasks, write the bot policy as **invariants with a test** (e.g. "the first purchase happens in the first second"; "a refine never replaces the flagship order"; "a docked visit never loses a purchase") rather than as formulas. My formula-level spec was where the T6 bug came from.
  3. Ask the reviewer for measurements and reproductions, and treat its causal explanations as hypotheses to test.
  4. When giving a keep/revert rule to the tuner, give the hard bar and the aim separately and say which one decides. My stricter aim made it revert the right fix.
  5. Browser smoke tests should include an intermediate width (1024 px): that is where the overlap was, and none of the planned sizes would have shown it.

## Known gaps (follow-ups)

- **Late-game time:** system 5 is +14 % (20 seeds) and +15 % (committed 10 seeds) over baseline. It is within the hard target, but at its edge.
- **Index-based cancel race:** the ✕ button sends a queue index captured at the last 100 ms HUD refresh; if the front job finishes in between, the wrong job can be cancelled (and refunded). A stable job id needs a small state and save change.
- **The bot rarely uses alloy** (only for tier-3 parts in systems 4–5; 12 of 100 warps on set A, 6 of 50 on set B), so the alloy prices are only lightly exercised by the balance report.
- No refinery upgrades (perk or station tier), no refined-goods contracts, no ship refining component (all non-goals in the spec).
- `#help` is now hidden below 1200 px wide (it used to show down to 820 px).
- The spec and plan still state the starting fuel time (1 s); the tuned value is 0.5 s (`src/data/refining.ts`).
