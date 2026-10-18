# Pause-aware Continuous Audio — Orchestration Run Log

- **Date:** 2026-10-18
- **Issue:** #67 (follow-up from #31 / #66), branch `fix/pause-audio-gating` (off `main` at `95e8bd1`)
- **Plan:** `docs/superpowers/plans/2026-10-18-pause-audio.md` · **Spec:** `docs/superpowers/specs/2026-10-18-pause-audio-design.md`
- **Setup:** Subagent-driven development. The controller wrote the spec and plan, asked the author the product question, orchestrated, ran the full gate and the browser smoke test, and committed the docs. A `reviewer` subagent critiqued the plan before any code; a fresh `worker` subagent implemented each task; a second `reviewer` subagent reviewed the whole code diff. Reviewer builtins have no shell in this harness, so the controller ran every `git`/`npm` command and the reviewer verified from the working tree.
- **Baseline:** 321 tests / 23 files green at `95e8bd1` (the branch adds 9 tests → 330).

## Ruling

The issue explicitly called the behavior a product decision, so the controller asked the
author with three policies and previews. The author chose **"Menu silent, alarm-only when
unfocused"**:

| Pause kind | hums | alarm |
| --- | --- | --- |
| running | on | on |
| `manual` | off | off |
| `menu` | off | off |
| `unfocused` | off | **on** |

Two secondary rulings, both recorded in the spec:

1. **No new setting.** The distinction is derivable from existing state; a toggle adds a
   fourth combination with no clear player story. *Cost if wrong:* a small settings + tests
   addition.
2. **An explicit pause dominates an unfocused window** (`menu` > `unfocused`), so opening a
   menu and then alt-tabbing stays silent. Pinned by the `prefers menu over unfocused` test.

## Per task

| # | Task | Implementer | Reviewer | Rounds | Commit |
| --- | --- | --- | --- | --- | --- |
| 0 | Spec + plan | controller | `reviewer` (plan review) | 1 + 1 (hardening) | `3862644`, `474fcef` |
| 1 | Pure pause kind + policy | `worker` (`ead3d4e5`) | `reviewer` (`77f0db50`, whole diff) | 1 + 0 | `2acbd17` |
| 2 | Engine + loop wiring | `worker` (`224b98c8`) | `reviewer` (`77f0db50`, whole diff) | 1 + 0 | `412f4c8` |
| — | Test hardening (review findings) | controller | — | — | (with Task 3) |
| 3 | README + browser smoke + gate | controller | — | — | (this commit) |

Plan-review mission `1de1ae20`. Reviewer missions ran without a shell; their artefacts are
under the session's `subagent-artifacts/` directory.

## Plan review (before code)

The `reviewer` read the plan against the source and confirmed: pause precedence and
settings gates preserved condition-for-condition; banner strings byte-identical; exactly one
`updateContinuous` caller; no import cycle with `pause.ts → audio/sfx.ts`; `nextAlarm`
suppression is stuck-state-free (`ALARM_INTERVAL` 1.1 s ≫ `MIN_GAP.alarm` 0.3 s, and
`updateAlarm` resets on `level <= 0`). It raised findings that were folded into the plan and
spec before implementation:

- **The "tabbed away" promise is not deliverable.** A hidden tab suspends the
  `AudioContext` and stops rAF, so the alarm can only sound while the window is *visible but
  unfocused*. Reworded everywhere; keeping a timer-driven alarm for a hidden tab is
  recorded as out of scope.
- **The smoke procedure assumed focus**, which CDP automation often leaves false. Hardened
  to override `document.hasFocus` in both directions and to probe the alarm by its actual
  start time (`limiter.last.get('alarm')`) rather than `nextAlarm`.
- **Banner tests used `toContain`**, too weak for a byte-identity constraint. Changed to
  `toBe` with the exact strings.
- **`silenceHums` description was wrong** (it clears the map immediately and fades over
  ~0.5 s). Corrected.
- **Policies could be mutated / allocated per frame.** Frozen module constants and a
  required (not defaulted) `policy` parameter, so a forgotten argument is a compile error.

## Code review (after both implementation tasks)

The whole-diff `reviewer` found **no code defects** (P0/P1 code: none) and confirmed:
the policy table is exact and unreachable-wrong; all policies frozen and read-only; the
`updateContinuous` early return and hum body are behaviorally unchanged; `nextAlarm` is not
written on the suppressed path; the required parameter has one, correctly-ordered call site;
`pause.ts` imports only `audio/sfx`; and the tests are discriminating. It raised two cheap
test gaps, which the controller closed (commit with Task 3):

- `pauseKind` parens unpinned (`researchOpen: true, pauseInMenus: false`) → added.
- Frozen/shared constant unpinned → `toBe(LIVE_CONTINUOUS)` + `Object.isFrozen`.

Its remaining note is pre-existing and out of scope: `updateAlarm` advances `nextAlarm` even
when the 12-voice cap rejects the `play()`.

## Browser smoke test (controller, mandatory)

`npm run dev` + agent-browser (Chrome via CDP), `window.__amh` debug hook, a keeper interval
that kept a real beam mining and the selected hull at 1, and `document.hasFocus` overridden
in both directions. AudioContext unlocked by a canvas click (`audio.state === 'running'`).
The alarm probe is `limiter.last.get('alarm')` (ctx seconds); hums probe is `hums.size`.

| Step | State | hums | alarm start | banner |
| --- | --- | --- | --- | --- |
| 1 | running | 1 | 64.79 → 65.91 over 1.6 s | hidden |
| 2 | ⚙ menu open | **0** | **72.58 → 72.58** over 2.1 s | `PAUSED: menu open` |
| 3 | resumed (Esc) at ctx ≈ 89.9 | **1** | 89.97 → 91.08 | hidden |
| 4 | `hasFocus = false` (visible) | **0** (beam still on) | 103.33 → 105.56 | `PAUSED: window not focused` |

- Step 2 is the direct evidence for the "no indefinite beeping in a pause menu" criterion:
  the alarm did not restart across a 2.1 s pause window.
- Step 3 shows the overdue alarm firing on the first resumed frame: the menu was open from
  ctx ≈ 76.5 to ctx ≈ 89.9 (each agent-browser command has CLI startup latency, so the
  pause itself lasted longer than the 2.1 s probe window), and the alarm started at ctx
  89.97 — within one frame of resume — then kept its normal 1.1 s cadence (91.08).
- Step 4 is the issue's key case: with `beamOn` still true, hums were silenced while the
  alarm kept its cadence.
- Console held only the two Vite `[debug]` lines; no errors.

## Caveats and deferred items (for the author, not blocking)

- **Hidden tab is silent by design** (context suspended); the alarm is deferred to the first
  resumed frame. A timer-driven alarm that survives a hidden tab is a separate issue.
- **The audio wiring is CI-invisible.** No unit test observes Web Audio; the browser smoke
  above is the only end-to-end check.
- Pre-existing: the 12-voice cap can defer the alarm by one `ALARM_INTERVAL`.
- A started one-shot (alarm buffer, UI click) finishes its ~0.4 s tail after a pause; only
  the continuous layers are gated.

## Verification artefacts

- Smoke screenshot: `.superpowers/sdd/pause-audio-smoke.png` (git-ignored).
- Full gate on the branch head: `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm test` (330), `npx vite build`.
