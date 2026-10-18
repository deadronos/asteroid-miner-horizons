# System Modifiers + Warp Pacing — Orchestration Run Log

- **Date:** 2026-10-18 (files dated 2026-10-19 to follow the plan series)
- **Issues:** #47 (system modifiers) and #44 (warp cost vs income), branch `feat/system-modifiers` (off `main` at `efc16f2`, which includes #35 contracts and #36 refining)
- **Plan:** `docs/superpowers/plans/2026-10-19-system-modifiers.md` · **Spec:** `docs/superpowers/specs/2026-10-19-system-modifiers-design.md`
- **Setup:** Claude (Opus) wrote the spec and plan, orchestrated, verified, smoke-tested the UI and committed. This is the third run of the experiment and the first with Claude Code CLI sessions instead of opencode. Each task was implemented by one non-interactive `claude -p --model sonnet --permission-mode acceptEdits` session (allowlist: Read, Edit, Write, Glob, Grep, `npm run`, `npx`, `git diff/status/log`, `ls`, `cat`). It was reviewed by a separate, read-only `claude -p --model opus --permission-mode default` session (Read, Glob, Grep, `git diff/status/log`, `npm run`). Both used `--output-format json </dev/null`. Fix rounds went back to the implementer with `--resume <session_id>`.
- **Watchdog:** a wrapper script killed a call when no Claude Code session transcript (other than the orchestrator's own) had changed for 10 minutes. **It never fired.**
- **Verification after every task (orchestrator):** `npm run check` and a full read of `git diff` and the untracked files. I also ran balance runs after Tasks 1, 5 and 6, a browser smoke test for Task 4, and a third seed set plus a 12-warp run for Task 6.

## Applying the recommendations from #35 and #36

| Recommendation | What I did |
| --- | --- |
| Same plan detail (exact signatures, values, tests, "done when") | Same format. I also added a **pre-change generation snapshot table**, captured by me at `efc16f2`, so the "RNG unchanged" test pins real numbers. |
| Lifecycle checklist for UI/save tasks | Added to the plan and included in every implementer and reviewer prompt. |
| Orchestrator does the browser smoke test | Done for Task 4 (details below). **It found the only real UI bug of the run.** |
| Robust tuning: `--seeds 20` plus a disjoint set, with margin | Set A = `--seeds 20` (1000–1019) and set B = `--seed-start 2000 --seeds 10`, both `--warps 10`. I also added set C (`--seed-start 3000 --seeds 20`) and set A at `--warps 12` for verification. The hard bar was 1.6×, against the criterion of 2×. |
| Tight, measurable "done when" for bot/tuning tasks; hard bar and aim separated, with the deciding one named | Task 6 had four numbered hard-bar items, aims that "only break ties", and a lever order. I gave the tuner a ready-made stats script and baseline reports, so it did not have to write its own (the #35 tuner lost time to a zsh loop). |
| Ask reviewers for measurements, treat causal claims as hypotheses | Done in the Task 6 review prompt. The reviewer reproduced a full report line for line and recomputed medians by hand. |
| Frozen fixture for the previous save version | I froze `tests/fixtures/save-v4.json` (the v3 fixture migrated and ticked once at `efc16f2`) and committed it with the spec. |

## Step 0 — finding the wall (orchestrator, before the plan)

The issue predicted a wall "around warp 5–7". The bot at `efc16f2` shows otherwise:

- **To warp 10 there is no wall** on either set. The median ratio between consecutive warps is 0.83–1.29 on set A and 0.83–1.51 on set B. Time per warp grows about ×1.14 from system 3 to 10.
- **The wall is just past the window.** Set A at `--warps 16` gives medians of 28:02, 38:12 and 52:27 for systems 11–13 (ratios ×1.34–1.37). Some seeds hit the 60-minute cap at warp 13 (5 of 20) and most do after it. Value per minute flattens from system 9 (650 → 761 by system 13) while fuel keeps growing ×1.35.
- **Per-seed spikes over 2× already existed:** 11 of 270 seed-warps. They are noise of the "short warp, then a normal one" kind.

This changed the #44 design. The criterion is judged on medians, with spikes reported separately. The plan adds a margin (a 1.6× hard bar, plus a 12-warp check) so that the wall does not sit just outside the measured window.

## Per task

Times are wall-clock seconds per `claude -p` call, at the wrapper's 20 s polling granularity, so they are approximate. Cost is `total_cost_usd` from the CLI's JSON output.

| # | Task | Implementer session | Reviewer session | Rounds (impl + fix) | Time impl / review / fix | Cost impl + fix / review | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Data, rolling, generation | `19a16c1a` | `b21cd68c` | 1 + 1 | 100 / 81 / 20 s | $0.91 / $0.46 | `1cde87a` |
| 2 | Save migration v4 → v5 | `ac875ee7` | `3a382fbc` | 1 + 1 | 60 / 60 / 40 s | $0.65 / $0.42 | `1a737cd` |
| 3 | Per-tick effects + warp log | `5e7442e8` | `38aa6361` | 1 + 1 | 80 / 80 / 20 s | $0.63 / $0.41 | `2c47879` |
| 4 | HUD chips + MAG | `4c44afa9` | `3ff56a31` | 1 + 2 | 40 / 60 / 40 + 20 s | $0.85 / $0.34 | `a008b15` |
| 5 | Balance report columns | `0dffc39e` | `0f96bcd4` | 1 + 1 | 160 / 80 / 20 s | $0.57 / $0.37 | `b129d88` |
| 6 | #44 tuning | `804eeb49` | `4fdf8ec2` | 2 + 2 | 20 + 1562 / 221 / 40 + 120 s | $2.53 / $1.18 | `0537d05` |
| — | `docs/balance.md` regenerated (orchestrator) | — | — | — | ~60 s | — | `07b7736` |

Session ids are abbreviated to their first 8 hex digits. Task 6's first implement call stopped after 20 s because its shell commands were denied (see "Infrastructure"). On every task `npm run check` was green after the first implement round.

### Task 1 — data, rolling, generation
- **Implementer:** correct on the first pass and minimal. It used its own RNG stream, applied the modifiers after the third belt, and drew nothing new from the generator's `r`. Its python heredoc edits were denied and it fell back to Edit/Write without being told. It noted honestly that it had not done the balance identity check.
- **Orchestrator check:** a set-A balance run had system 1–2 CSV lines **byte-identical** to the baseline (40/40). At this point modifiers already made systems 3+ slower and spikier: the >2× count on set A rose from 6 to 16.
- **Reviewer:** no critical or major findings. It raised one minor and five nits.
  - Minor: the systems-3+ belt-scaling assertion "may be vacuous". **I checked this:** 6 of the 9 rows roll `dense`, so it was not vacuous today, but a guard is cheap. Sent.
  - Nits **sent**: a `readonly` type (the spec said so), a missing `/** */`, `pct(1)` rendering "−0%", and import order.
  - Nit **rejected**: rewriting a conditional `expect`. The lint rule `no-conditional-expect` is the reason it was written that way.

### Task 2 — save migration
- **Implementer:** correct. It renamed the "v4" test helpers to `currentRun`/`saveCurrent` rather than weakening any assertions, and added extra rejection cases (`[1]`, `['toString']`).
- **Reviewer:** **one real minor that both the spec and I had missed.** Duplicate ids (`['nebula','nebula']`) passed validation, and from Task 3 on they would apply the nebula effect twice. It also flagged stale "v4 save" test titles and import order (real nits). All three were fixed.

### Task 3 — per-tick effects and the warp log
- **Implementer:** a three-line source diff, plus tests for index stats, pickup pull, regrow timing and the warp log. It correctly read the modifiers from `state.run` (the new run) rather than the handler's stale `run`.
- **Orchestrator check:** the renderer's `shipStats` call does not draw the magnet radius, so the index and the panel are the only two consumers.
- **Reviewer:** no defects. It traced every `shipStats` caller to confirm the magnet multiplier is never applied twice. Its nits were all test hardening, and I **sent** three: assert the log index is ≥ 0, assert the warp happened (the test could otherwise pass vacuously), and add a doc comment on `SimIndex.stats`.

### Task 4 — HUD chips and MAG
- **Implementer:** followed the plan. It added a pure `topBarKey` with tests, chips with tooltips, the MAG readout through `applySystemStats`, and the CSS.
- **Orchestrator browser smoke test** (chrome-devtools on `vite`; saves generated with `tsx` and injected into `localStorage` through a temporary served file):
  - **Old save:** the v4 fixture loads with no chips and MAG 70.
  - **Load another slot:** seed 2, system 4 (nebula + ice-poor) shows two chips with the right tooltips and MAG 49. A different seed at the **same system number** (dense + nebula) **rebuilds the chips**, which confirms the key.
  - **Warp:** the chips change to ice-poor + dense, the `System modifiers: …` log line follows the warp line, and MAG is back to 70.
  - **New game:** system 1, no chips. No console errors.
  - **Real layout bug found at 800 px.** With two chips, `#topbar` overflowed (scrollWidth 901 > clientWidth 778), so Research and the menu gear scrolled off-screen. Without chips it fit (748). **The root cause was my plan**, which claimed that "the top bar already scrolls horizontally when too wide; nothing else moves".
- **Reviewer:** no findings, and it **missed the overflow**. It accepted the plan's claim ("it already scrolls horizontally at 800px"). It did reason correctly about the key and every lifecycle item.
- **Fix round 1 (my design):** a pure-data `icon` per modifier. Below 1200 px the chips collapse to icons, with an `aria-label`. I also sent the reviewer's two nits (do not mutate the stats object in the template string; add a non-empty equal-key test). The re-test still overflowed by 8 px. **Fix round 2:** I measured tighter spacing live by injecting a test style in the browser (752 ≤ 778) and sent those exact values. The final checks at 800, 1024 and 1280 px all fit.
- **Orchestrator interference:** my temporary `_smoke.json` in the repo root made `format:check` fail during fix round 1. The implementer reported this correctly and did not touch the file. I removed it.

### Task 5 — balance report columns
- **Implementer:** correct. It could not run `diff` (not in its allowlist), so it checked only 6 of the 40 system 1–2 CSV lines and said so.
- **Orchestrator check:** both sets' system 1–2 lines are byte-identical to `efc16f2` (60/60). This run also became the **post-modifier baseline** for Task 6:
  - Set A system 3 rose from 8:26 to 11:13.
  - Set B system 3 rose from 7:37 to 13:28, a median ratio of 1.72 that already fails the 1.6 bar.
  - The >2× count rose from 11 to 36.
- **Spec bug (mine):** the `None (system ≥ 3)` control row can never have data, because every system from 3 rolls at least one modifier. Removed in the fix round.
- **Reviewer:** no defects. It found one real nit (the note should say the median excludes walls), which was sent.

### Task 6 — #44 tuning
- **First call:** it stopped after 20 s. Its compound shell commands (`… && …`, `sed -i`, `sh /tmp/…`) were denied, so it asked for approval. I resumed it with one narrow extra allowance, `Bash(sh /tmp/amh-tune/*)`.
- **Tuner (1562 s, 68 turns):** 15 documented iterations, plus a modifiers-off **probe** to diagnose. The probe showed that nearly all of the system-3 slowdown comes from the modifiers, mainly nebula and ice-poor. Items 1–3 passed from iteration 6 on. Its best candidate missed item 4 (systems 1–3 within ±10 % of the pre-modifier time) **by 2 s** on set B system 3. It **reported the miss honestly** and stopped at 15 iterations, saying further tweaks "looked like seed lottery".
- **Orchestrator diagnosis:** the tuner's own table showed that its last moves were noise. `modifierTwoChance` 0.25 → 0.1 left system 3 unchanged (A 9:02 → 9:00, B 8:39 → 8:39), and nebula regrow 0.3 → 0.1 moved set B by 15 s on 10 seeds. Both changes made the modifiers blander: two modifiers became rare, and belts regrew 10× faster.
  - I ran a third seed set: the candidate and iteration 9's values gave **the same set C system 3 (9:01, against 8:06 before modifiers)**. The gap is the systematic cost of system 3 being the first modified system, not noise.
  - **Orchestrator decision:** use iteration 9's values (two-chance 0.25, regrow 0.3) and override item 4 for system 3. I measured these on A, B, C and A at 12 warps as a temporary local edit and reverted it, then sent the change to the implementer (fix 1).
- **Reviewer (221 s, $1.18):** it reproduced set B **line for line**. Its `stats.ts`/`diff` calls on `/tmp` were denied, so it recomputed medians by hand from the CSV. Four minors and two nits:
  - **Real, documented here:** set A **system 2** is also −10.08 %, just outside item 4. Nothing modifies system 2, so this is purely the warp-cost change, which also shows that ±10 % is at the noise floor.
  - **Real, design:** ice-poor at 0.85 measured as noise (0.99× / 1.07× / 0.97×), against a chip that says "−15%". Softening it had not been required by the plan.
  - **Real, documented:** `modifierTwoChance` is a count, not a "magnitude", and spikes are compared against the post-modifier baseline rather than the pre-modifier one.
  - **Real test gap:** the regrow test only proved "≥ 2.5× faster".
  - It agreed with the item-4 override, on condition that the override is recorded and the ice-poor point is settled.
- **Fix 2:** ice-poor 0.85 → 0.7 under an explicit keep/revert rule, and the regrow test now pins the 0.3 interval. The tuner kept 0.7: ice-poor now measures 1.09× / 1.10× on A/B. **I verified on set C and set A at 12 warps**; my set A run reproduces the tuner's set A exactly. On set C, system 3 is 9:20 against 8:06 (+15 %), just over the +15 % rule I gave for A/B. Accepted and recorded below.

## Balance: before vs after (#44)

Per-system medians at `--warps 10`. "Pre" is `efc16f2` (no modifiers); "post-mod" is `b129d88` (modifiers, untuned); "final" is `0537d05`. Ratio = median time ÷ previous median time.

**Set A (20 seeds)**

| System | Pre | Ratio | Post-mod | Ratio | **Final** | **Ratio** |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8:25 | — | 8:25 | — | 8:25 | — |
| 2 | 9:02 | 1.07 | 9:02 | 1.07 | 8:07 | 0.96 |
| 3 | 8:26 | 0.93 | 11:13 | 1.24 | 8:44 | 1.07 |
| 4 | 10:23 | 1.23 | 15:33 | 1.39 | 10:48 | 1.24 |
| 5 | 13:04 | 1.26 | 17:06 | 1.10 | 12:20 | 1.14 |
| 6 | 15:48 | 1.21 | 18:45 | 1.10 | 14:48 | 1.20 |
| 7 | 13:09 | 0.83 | 16:07 | 0.86 | 12:02 | 0.81 |
| 8 | 16:08 | 1.23 | 18:02 | 1.12 | 14:21 | 1.19 |
| 9 | 16:13 | 1.01 | 23:28 | 1.30 | 14:32 | 1.01 |
| 10 | 20:52 | 1.29 | 28:55 | 1.23 | 18:33 | 1.28 |
| 11 | 28:02 | 1.34 | — | — | 22:35 | 1.22 |
| 12 | 38:12 | 1.36 | — | — | 27:02 | 1.20 |
| > 2× (sys 2–10) | 6 | | 25 | | 14 | |

**Set B (10 seeds, `--seed-start 2000`)**

| System | Pre | Ratio | Post-mod | Ratio | **Final** | **Ratio** |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 9:26 | — | 9:26 | — | 9:26 | — |
| 2 | 7:50 | 0.83 | 7:50 | 0.83 | 8:06 | 0.86 |
| 3 | 7:38 | 0.97 | 13:29 | **1.72** | 8:39 | 1.07 |
| 4 | 11:33 | 1.51 | 14:48 | 1.10 | 12:24 | 1.43 |
| 5 | 13:24 | 1.16 | 16:39 | 1.13 | 12:44 | 1.03 |
| 6 | 15:09 | 1.13 | 17:02 | 1.02 | 13:36 | 1.07 |
| 7 | 14:19 | 0.95 | 17:25 | 1.02 | 14:39 | 1.08 |
| 8 | 15:25 | 1.08 | 18:41 | 1.07 | 13:41 | 0.93 |
| 9 | 16:59 | 1.10 | 21:38 | 1.16 | 14:24 | 1.05 |
| 10 | 21:36 | 1.27 | 29:18 | 1.35 | 18:54 | 1.31 |
| > 2× (sys 2–10) | 5 | | 11 | | 7 | |

- **Acceptance (#44), judged on medians:** no warp takes more than 2× the previous one up to warp 10. The worst final median ratio is 1.43 (B system 4), and the worst median of per-seed ratios is 1.27. **No walls** on A, B or C, nor on A at 12 warps (the slowest seed at system 12 takes 41:34).
- **Gentle growth:** system 3 → 10 grows ×1.114 (A), ×1.118 (B) and ×1.109 (C) per warp, inside the 1.08–1.22 aim. The "about ×1.2" in the issue is the upper end; the late game is now faster than before (A system 10: 20:52 → 18:33).
- **Wall pushed back:** warps 11–12 are ×1.22 / ×1.20 against ×1.34 / ×1.36 before. Value per minute still flattens late, so a wall will reappear further out (not measured past 12).
- **Per-seed spikes:** 21 on A + B, against 36 post-modifier and 11 pre-modifier. Modifiers add variance, which tuning only partly removes. Set C has 5, against 4 pre-modifier.
- **Item-4 override, recorded:** system 1 and the opening table are unchanged. System 2 is −10 % on A, +3 % on B and 0 % on C (the warp cost only). System 3 is +4 % (A), +14 % (B) and +15 % (C) against the pre-modifier time. That is the measured cost of the first modified system, and its ratio to system 2 stays at 1.07 / 1.07 / 0.98.
- **Modifiers (final, time vs system median, A / B / C):** dense 0.92 / 0.86 / 1.01, metal-rich 1.05 / 0.98 / 0.97, ice-poor 1.09 / 1.10 / 1.02, nebula 1.08 / 1.05 / 1.02.

Final values: `warpCostGrowth` 1.35 → 1.3; `modifierTwoChance` 0.5 → 0.25; nebula magnet 0.7 → 0.85 and regrow 0.5 → 0.3; ice-poor 0.55 → 0.7; metal-rich 1.6 → 1.3; dense unchanged at 1.4.

## Infrastructure and quirks

- **No hangs; the watchdog never fired.** All 21 calls returned JSON with `rc=0`. The longest was the tuner at 1562 s, which kept its transcript growing the whole time.
- **The permission model shaped behaviour.**
  - Implementers' python/heredoc/`sed -i` edits were denied 2–4 times per task; each time they fell back to Edit/Write on their own.
  - The Task 6 tuner instead **stopped and asked for approval** after 20 s, because its whole workflow (an iteration shell script) was blocked. That cost one round trip.
  - Reviewers could not run `diff` or `npx tsx` on `/tmp`. The Task 5 implementer therefore checked only 6 of 40 lines, and the Task 6 reviewer recomputed medians by hand.
  - Lesson: give the tuner a pre-approved iteration script from the start, and give reviewers `Bash(diff:*)`.
- **My own runner bug:** I passed the extra allowance through an unquoted variable, so the CLI received literal quote characters. Fixed by passing it as an array element.
- **My zsh word-splitting slip:** a `set -- $s` loop in my Task 6 experiment did nothing in zsh, which is the same trap the #35 tuner fell into. I reran the commands explicitly.
- **Browser tooling:** the chrome-devtools MCP cannot read or write the session scratchpad (`sourcePath` and `filePath` were denied). I served save fixtures through `vite` from a temporary repo file, which broke `format:check` once (see Task 4).
- **Resumes are not cheap.** A `--resume` fix round re-reads the whole session, so a 20-second, 4-turn fix still cost $0.30–0.48. The Task 6 resumes cost $0.80–0.88 each. In total, fix rounds cost **more than implementation** ($3.81 against $2.32).
- **No session** committed, pushed, touched `scratch.md`, or edited files outside its task. Sessions only wrote to `/tmp` where told to.

## Interventions summary

| Kind | Count | Details |
| --- | --- | --- |
| Sonnet implement rounds | 7 | one per task, plus the denied 20 s first call in T6; all green on the first `npm run check` |
| Sonnet fix rounds | 8 | 1 each on T1, T2, T3, T5; 2 each on T4 and T6 |
| Opus review rounds | 6 | 0 critical, 0 major. Real: T2 duplicate ids; T6 system 2 also misses item 4, ice-poor too weak, regrow test gap. ~15 real nits. 3 rejected (T1 conditional expect, T3 two cosmetic nits). Missed: the T4 overflow |
| Orchestrator code edits committed | 0 | every committed code change was written by Sonnet |
| Orchestrator doc commits | 4 | spec + plan + v4 fixture; `docs/balance.md`; tuned-values note in the spec and this log |
| Orchestrator temporary experiments | 1 | T6 iteration-9 values on A/B/C/A12 (local edit, reverted) |
| Orchestrator-found issues routed to Sonnet | 3 | T4 800 px overflow (browser); T5 empty control row (my spec); T6 noise-chasing knob values |
| Bugs that were my own spec/plan mistakes | 3 | the "top bar already scrolls" claim (T4), the `None` control row (T5), and a ±10 % system-1–3 band at the noise floor (T6) |
| Orchestrator verification beyond check/diff | 7 | sys 1–2 identity after T1 and T5 (both sets); browser smoke (4 lifecycle items, 3 widths); set C baseline in a worktree; set C and A12 for two candidates |
| Orchestrator decisions overriding Sonnet | 1 | T6: iteration 9 values instead of the tuner's last candidate, and the item-4 override |
| Infrastructure failures | 0 hangs | 1 permission stall (T6), 1 runner quoting bug (mine), 1 fixture file breaking format (mine) |

## Cost and time

- **CLI cost: $9.31 in total** (from `total_cost_usd`): implement $2.32, review $3.18, fix $3.81. A one-off $0.06 CLI smoke call before Task 1 is excluded. Task 6 alone was $3.71 (40 %).
- **Model time** (sum of calls): about 49 min, made up of implement 34 (the tuner alone 26), review 10 and fix 5.
- **Wall time:** about 1 h 45 min end to end:
  - about 25 min of reading and baselines (including the 16-warp wall search) before the spec;
  - 16:06 spec and plan committed;
  - Tasks 1–5 committed by 16:28, about 22 min for five tasks including the browser test;
  - Task 6 from 16:29 to 17:18, with the tuner, my experiment and the review;
  - the log after that.

## Comparison with the opencode runs

| | #35 contracts (opencode, deepseek flash) | #36 refining (opencode, deepseek flash) | **#47 + #44 (claude CLI: Sonnet impl, Opus review)** |
| --- | --- | --- | --- |
| Tasks | 7 | 7 | 6 |
| Hangs / time lost | 5 hangs, ~35 min | 0 | 0 |
| Fix rounds | 7 | 11 | 8 |
| Successful model time | ~29 min | ~107 min | ~49 min (tuner 26) |
| Wall time (tasks only) | not recorded | not recorded | ~72 min (T1–T5 22 min, T6 50 min) |
| Cost (USD) | not recorded by opencode | not recorded by opencode | **$9.31** |
| `npm run check` green after first impl round | 7/7 | 7/7 | 6/6 |
| Reviewer majors (real) | 1 | 3 (+1 rejected) | 0 |
| Reviewer misses found later | T6 stale key | — | T4 overflow |
| Wrong causal diagnoses by reviewer | — | 2 (T6, T7) | 0 |
| Orchestrator-found bugs | 1 | 5 | 3 |
| Orchestrator code edits | 0 | 0 | 0 |

- **Quality.** It was comparable to or slightly better than the earlier runs on code tasks, and clearly better on the tuning task.
  - **Code tasks.** Sonnet's diffs were small, idiomatic and followed the plan exactly. Its fix rounds were precise. When an instruction was ambiguous or blocked, it said so and did not improvise (T5 partial check, T6 "I need approval").
  - **The tuning task:**
    - It ran a diagnostic probe on its own initiative.
    - It reported a miss instead of arguing "noise". The #36 tuner did argue noise.
    - It stopped when its iterations became seed lottery.
    - Its weak spot is the one #36 showed: in the last iterations it optimised the hard-bar metric with knobs that had no measured effect.
- **Reviewer accuracy (Opus vs deepseek).** Opus found fewer severe issues, but there were also fewer to find: no task had a crash-class bug like the #35 migration throw. Its signal-to-noise was high:
  - every finding was correct, and the 3 I rejected were style calls, not errors;
  - it never gave a wrong causal diagnosis (deepseek gave two in #36), and on T6 it reproduced the data before judging;
  - its blind spot matched deepseek's: runtime UI layout. It took the plan's claim about the top bar on trust instead of measuring, just as deepseek's #35 reviewer called a stale key "Correct". The browser test remains the orchestrator's job.
- **Rounds.** This run had 8 fix rounds, against 7 and 11. Four tasks needed only nit-level fixes.
- **Speed and cost.** The CLI was fast and stable: no hangs, and T1–T5 averaged about 4.5 minutes per task including review. Cost is now visible ($9.31). The surprise is that `--resume` makes small fix rounds about as expensive as the original implementation.

## Recommendations

1. Pre-approve the iteration command for tuning tasks, e.g. `Bash(sh /tmp/<dir>/*)` plus a script the orchestrator writes. Give reviewers `Bash(diff:*)` so they can compare reports byte for byte.
2. Keep the browser smoke test with the orchestrator, and **measure overflow numerically** (`scrollWidth` against `clientWidth`) at 800 px as well as 1024 px. Never state layout facts in a plan without measuring them first.
3. For a tolerance band on a median, check the band against seed noise first. This run's ±10 % was crossed by a system that nothing had changed (system 2, −10 %). Use a third seed set before overriding a hard-bar miss.
4. For small nit-only fix rounds, consider a fresh short session with the diff instead of `--resume`. It is cheaper, because a resume re-reads the whole transcript.
5. Tell tuners explicitly that a knob change with no measured effect must be reverted, not kept.

## Known gaps (follow-ups)

- **Binary star and comet showers** were cut from #47 (see the spec's non-goals). Comet showers belong with the hazard work in #37.
- **No 3D visual cue** for modifiers (nebula haze, belt tint); only the HUD shows them.
- **System 3 is 4–15 % slower** than before modifiers (A/B/C). Item 4 was overridden; see the balance section.
- **Per-seed spikes over 2×** remain: 21 on A + B against 11 before modifiers. The medians meet the criterion; individual seeds sometimes take more than twice their previous warp.
- **The wall is pushed back, not removed.** Value per minute still plateaus late, so a wall will reappear beyond warp 12 (not measured).
- The bot's own pickup-chase threshold reads the unmodified `shipStats` magnet (cosmetic for the bot; the sim uses the modified one).
- Saves made on this branch before tuning keep belts generated with the old magnitudes, while tooltips show the new numbers (unreleased dev saves only).
