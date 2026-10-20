# Audio Event Cues — Run Log

**Date:** 2026-10-20/21 · **Issue:** #168 (child of umbrella #154) · **Branch:** `feat/audio-event-cues`
**Spec:** `docs/superpowers/specs/2026-10-20-audio-event-cues-design.md`
**Plan:** `docs/superpowers/plans/2026-10-20-audio-event-cues.md`

## Setup

Subagent-driven execution per the plan: a fresh implementer per task (glM/deepseek free-tier models per the skill's model selection), a separate reviewer session per task, controller-owned browser verification for Task 4. Base branch `feat/audio-event-cues` from `main` (spec/plan committed there first), `npm run check` as the gate before every commit.

## Verification performed

| Command                                                                                           | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (after every task and at branch head)                                             | green — 59 files, 861 tests                                                                                                                                            |
| `npx vite build` (Tasks 3 and 4)                                                                  | green                                                                                                                                                                  |
| `git diff main --stat -- docs/balance.md src/sim/create.ts src/sim/migrations.ts src/sim/save.ts` | empty — no balance drift, no save-format change; the plan's Global Constraint "no sim behaviour change beyond the stamped field" holds by inspection of the task diffs |

### Task 4 browser probes (dev server + Playwright, Chrome)

Audio unlocked via the boot screen's `Continue` click; `__amh.audio.state === 'running'`; `settings.set({ volMaster: 0.9, volSfx: 0.9, volMusic: 0.2 })`. A wrapper around `audio.play` recorded every call (`id, gain, pan, rate, cutoff, t`); a second wrapper recorded `limiter.allow` decisions directly.

1. **Three-loss same-batch collapse → one voice.** `consumeLog` with three `shipLoss` lines produced **one** `loss` play (`gain 0.7, pan 0, rate 1, cutoff 18000`). A second single-loss batch dispatched immediately after called `play` a second time, but the limiter blocked it (`allow → false`) — only one sounding voice. (Instrumentation note for the next reader: the first wrapper counted _calls_, so "2" there means two `play` invocations, one blocked; the `allow` log is the truth of whether a voice started.)
2. **Rate limit across batches.** A repeat `loss` batch that arrived 512 ms after the first fired again (gap ≥ `MIN_GAP.loss` 0.4 s) — correct pacing, not a bug. Direct `limiter.allow('outpost', now)` probes returned `false, false` for immediate repeats (0.3 s gap).
3. **Mixed batch: deny first, then every identity.** One batch carrying a warn line plus all six identities produced `uiDeny` then `research (0.5) → achievement (0.7) → contractDone (0.6) → contractFail (0.45) → outpost (0.55) → loss (0.7)`, in first-seen log order, all centre-panned at `cutoff 18000`.
4. **Real-path deny.** Accepting a second contract over the active one via the debug hook's command queue produced the game's own warn line and a `uiDeny` buzz through the real `main.ts → consumeLog` path (dedupe with the HUD's `splice(0)` drain confirmed: the warn text was already visually drained when queried seconds later, while the deny still fired in the ~0.1 s window).
5. **Distinctness (objective proxy).** Rendered every new preset plus its three nearest neighbours through the page's `zzfxSamples` and compared duration and dominant-window zero-crossing rate (crude pitch proxy): `research 0.29 s/1751 Hz-proxy`, `achievement 0.68 s/2884`, `contractDone 0.51 s/2584`, `contractFail 0.39 s/667`, `outpost 0.26 s/367`, `loss 0.69 s/417`, against `dock 0.57/1984`, `uiDeny 0.15/917`, `alarm 0.44/934`. No pair shares a duration/frequency neighbourhood. **Subjective ear check was not possible in this environment** — a human should confirm the six read as intended (especially `achievement` vs `contractDone`, the closest pair); the empirical fingerprint suggests they are distinguishable.
6. **Pause sanity.** Opening the settings menu showed `PAUSED: menu open`, `hums.size === 0`, `nextAlarm === 0` — the #67 policy surface is untouched and no stuck alarm. Console: **0 errors** for the whole session.

## Deviations from the plan

- **Probe instrumentation interpretation:** the plan said to count voices; "calls to `play`" overcounted by one whenever the limiter vetoed a call. Resolved by also logging `allow` decisions (the veto record). No code change needed.
- **Ear-tuning pass did not retune literals:** no retuning was made because two independent objective probes (unit render bounds + fingerprint table) showed distinct, in-spec sounds; the subjective listen remains open for the maintainer.
- **Task 1 implementer used `isFlagship`** in the ship-loss test instead of the plan's hull-id guess — the plan itself ranked `isFlagship` higher ("Use the hull that is actually the flagship on this seed").
- **`logVerbosity` does not gate cues** (found by the Task 3 reviewer): the HUD hides info-level text under the "important" setting, but audio still cues research/outposts. Ruled intentional by the controller (see below).

## Rulings made

- `logVerbosity` gates text only; cues play regardless (audio feedback is not a `log`verbosity slider). Cost if wrong: a player who silences info text still hears small cues; reversible via a later settings issue.
- The task-branch-in-main-checkout approach over an extra worktree (clean tree, npm preinstalled, nothing else in flight).

## Per-task notes

| Task                  | Session     | Review           | Commit      | Rounds | Notes                                                                                                              |
| --------------------- | ----------- | ---------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 1 (stamp identities)  | implementer | clean, Approved  | `c1f3489`   | 0/5    | 2 cosmetic minors deferred                                                                                         |
| 2 (pure cue rules)    | implementer | clean, Approved  | `86d0f41`   | 0/5    | 2 lint workarounds (`satisfies`, one-line `no-array-sort` guard); 5 minors deferred, 2 plan-mandated coverage gaps |
| 3 (engine wiring)     | implementer | clean, Approved  | `2b65f44`   | 0/5    | README rewrap unavoidable; header-comment omission deferred                                                        |
| 4 (browser + run log) | controller  | controller-owned | this commit | —      | probes above                                                                                                       |

Deferred minors ride to the final whole-branch review for triage: none gate merging beyond what that review decides.
