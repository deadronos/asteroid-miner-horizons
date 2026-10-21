# Adaptive Render Scale — run log

- **Date:** 2026-10-21
- **Issue:** [#160 — Add adaptive render scale and quality](https://github.com/deadronos/asteroid-miner-horizons/issues/160)
- **Branch:** `codex/issue-160-adaptive-render-scale`
- **Spec:** [`../specs/2026-10-21-adaptive-render-scale-design.md`](../specs/2026-10-21-adaptive-render-scale-design.md)
- **Plan:** [`2026-10-21-adaptive-render-scale.md`](2026-10-21-adaptive-render-scale.md)
- **Setup:** Isolated worktree from `origin/main` (`ef44f36`). No dependency changes.

## Verification

| Area | Verification | Result |
| --- | --- | --- |
| Controller | Disabling the controller's window decision guard made 4 behavior tests fail; restored code passes | 6 tests pass |
| Settings | Auto mode and valid/invalid render scale coverage | Included in full suite |
| Full checks | `npm run check` | 60 files, 876 tests pass; format, lint and typecheck pass |
| Production | `npm run build` | Vite production build succeeds |
| Diff | `git diff --check` and full diff review | Clean |
| Browser | Graphics tab at 3840×2160, DPR 4 | Auto and 75% scale controls render; no console errors |
| Browser stability | Active game under a sustained 24 ms/frame load, 24 samples at 500 ms intervals | Adapted through levels 1, 2 and 3; held level 3 with no oscillation during the following 12 seconds |
| Independent review | Separate read-only review, repeated after the pause-sampling fix | No actionable findings |

## Review notes

- The first self-review identified that the deliberate 12 FPS paused-menu renderer could look like overload. Auto now samples only while the game is active.
- Visible long frames remain part of the rolling average so severe stalls can still trigger adaptation.
- Bloom composer creation remains lazy as it already was: the Low preset skips it unless antialiasing requires the existing fallback path.
- The browser smoke used an emulated DPR 4 and simulated load; it verifies the adaptation and stability logic without representing a physical 4K GPU benchmark.
