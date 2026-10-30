# Workflow

How an issue becomes a merged change here. The pattern is visible in `docs/superpowers/`: every substantial
feature has a spec, a plan, and a run log.

## The three documents

| Stage         | Path                                                   |
| ------------- | ------------------------------------------------------ |
| Spec (design) | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`  |
| Plan          | `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`         |
| Run log       | `docs/superpowers/plans/YYYY-MM-DD-<topic>-run-log.md` |

All three are committed alongside the code. Small fixes skip them; anything that adds a system, changes an
interface, or needs tuning gets the full set.

**Spec** — the design: goal, the state and data it adds, the rules, and the trade-offs taken. Written before
code, reviewed before the plan.

**Plan** — the spec turned into ordered, independently verifiable tasks. The established header shape:

- `Goal`, `Architecture`, `Tech Stack`, and a link to the spec.
- `## Global Constraints` — the invariants every task must respect (purity, determinism, subsystem RNG
  isolation, `npm run check`, no new dependencies, do-not-touch files).
- `## Review Focus` — the specific mistakes you expect a reviewer to look for, with the task that guards each.
- `## Task N: <title>` — `**Files:**`, `**Build:**` (what to write, referencing spec sections), `**Tests:**`,
  and `**Done when:**`. Tasks use `- [ ]` checkboxes so progress is trackable.

A task should be small enough to implement and review on its own, and should leave the tree green.

**Run log** — written after the work, recording what actually happened: date, issue, branch, links to the spec
and plan, the setup, the verification performed after each task, any deviation from the plan and why, a table of
per-task sessions/rounds/times/commits, and then per-task notes on what the reviewer found — and which findings
were accepted or rejected. The rejections are as useful as the fixes; they stop the same suggestion recurring.

## Implementation and review

The established model for a planned feature is **one session per task, reviewed by a separate session**:

- One implementer per plan task, working from that task alone.
- A separate reviewer that did not write the code, checking the diff against the spec and the Review Focus list.
- An orchestrator that owns the plan, commits, and re-runs verification.
- Fix rounds go back to the _original_ implementer session, so it keeps its context.

Findings get triaged, not applied blindly: accept the real ones, and say why you are rejecting the rest. The
run logs show this explicitly, and it is expected — a reviewer's suggestion to guard an unreachable branch
should be rejected, not implemented.

## Verification

After every task, before committing:

1. `npm run check` — green is the bar. It runs format:check, lint, typecheck and the tests.
2. Read the whole `git diff`. Do not commit a diff you have not read.
3. If the change could move balance numbers, run `npm run balance` and inspect the report. If the sim's
   behaviour is meant to be unchanged (bot ignores the feature), assert that explicitly and check
   `run.rng.s` is untouched.
4. Regenerate generated files (`docs/balance.md`) rather than hand-editing them.

## Branches, commits, PRs

- Start every branch from an up-to-date `main` (`git fetch && git switch -c ... origin/main`), and rebase on or
  merge `origin/main` before opening or updating a PR.
- Branch names are prefixed by intent: `feat/`, `fix/`, `perf/`, `balance/`, `refactor/`, `docs/`. Agent
  sessions run on the `claude/<topic>` worktree branch they were given; keep it rather than renaming. Always
  reference the issue number in the PR, whatever the branch is called.
- Commit subjects are imperative and specific: "Bucket rocks by kind and shape so each kind uses its own pools
  (#20)". Reference the issue where there is one, and follow the file's own history for the local voice.
- CI green is required, but a PR merges only after the owner approves it, and agents never merge on their own.
  Keep the diff to what the plan describes; unrelated refactoring belongs in its own change.

## Releasing

Publishing is tag-driven and deliberately narrow: a `v*` tag is the only thing that reaches the public URL, and
`main` is never deployed.

1. Bump `version` in `package.json` on `main` and commit it.
2. Tag that commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

`.github/workflows/release.yml` then repeats the CI gates, builds once, publishes that build to
<https://deadronos.github.io/asteroid-miner-horizons/> and cuts a GitHub Release with the build attached.

- **The tag must match `package.json`.** A suffix is allowed for a rehearsal — `v0.2.0-rc.1` passes and marks the
  release as a prerelease. Anything else (`v0.3.0` while `version` is `0.2.0`) fails before anything is built.
- **Tag pushes do not run `ci.yml`** — its push trigger is `branches: [main]` — which is why `release.yml`
  repeats format, lint, typecheck and test itself.
- **One-time setup:** **Settings → Pages → Source = "GitHub Actions"**. The workflow cannot do this itself:
  `actions/configure-pages` has an `enablement` input, but it needs a token other than `GITHUB_TOKEN`.
- **To redo a failed run,** re-run the failed job on the run page, or `gh run rerun <run-id> --failed`. Do not
  re-tag to retry; the tag is the source of truth.

## Local-only scratch

`.superpowers/` is git-ignored working space (plan pointers, review diffs, screenshots). `scratch.md` is tracked
but off limits; see AGENTS.md.
