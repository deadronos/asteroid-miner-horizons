# Adaptive Render Scale Implementation Plan

**Goal:** Implement issue #160 with a user-controlled render scale and stable automatic quality adaptation.

**Architecture:** Add an allocation-light rolling frame-time controller in `src/render/autoQuality.ts`; add persistent `renderScale` and the `auto` quality option in `src/settings.ts`; connect the controller to rendered frames in `src/main.ts` and effective renderer settings in `src/render/Renderer.ts`; expose both controls in the Graphics tab.

**Tech Stack:** TypeScript, Three.js, Vitest, Vite, Oxc formatter/linter.

**Spec:** [`../specs/2026-10-21-adaptive-render-scale-design.md`](../specs/2026-10-21-adaptive-render-scale-design.md)

## Global Constraints

- Keep simulation behavior, RNG consumption and saves unchanged; this is renderer/preferences work only.
- Keep the adaptive helper pure with no DOM, three.js, or wall-clock reads.
- Do not add dependencies or modify `docs/balance.md` or `scratch.md`.
- Preserve Low, Medium and High behavior when Auto is not selected.
- Run `npm run check` before completion and review the whole diff.

## Review Focus

- Auto must not flap near its threshold; the rolling window and slower recovery must be directly tested.
- A manual render-scale choice must multiply DPR cap without changing preset semantics.
- Existing saved settings must merge to valid defaults; malformed render scales must be rejected.
- Auto must not persist its transient effective quality level or alter simulation state.

## Task 1: Add and test the adaptive controller (#160)

**Files:** Create `src/render/autoQuality.ts`, `tests/autoQuality.test.ts`.

**Build:** Implement a one-second rolling average, sampled in windows, with two consecutive overloaded windows required to downshift and six consecutive recovery windows required to upshift. Four levels correspond to High/full scale, High/75%, Medium/75%, and Low/75%. Keep state bounded and ignore non-finite/non-positive frame intervals.

**Tests:** Rolling average, window boundaries, downshift and upshift thresholds, middle-band reset, min/max clamping, invalid samples.

- [x] **Done when:** New tests showed the expected missing-module red, then passed; `npm run check` passes.

## Task 2: Add persisted graphics controls and effective settings (#160)

**Files:** Modify `src/settings.ts`, `src/render/Renderer.ts`, `src/main.ts`, `src/ui/menu/form.ts`, `src/ui/menu/SettingsTabs.ts`; modify `tests/settings.test.ts`; add focused pure helper tests as needed.

**Build:** Add `quality: 'auto'`; add a validated persisted render scale of 0.75 or 1.0; let Renderer apply an effective quality level without mutating SettingsStore; multiply DPR cap by render scale and adaptive scale. Auto uses High, then High at 75%, Medium at 75%, then Low at 75%. Feed measured rendered frame intervals to the controller and apply settings only on level transitions. Show Auto and the render-scale selector in Graphics.

**Tests:** Settings migration/default merge and rejected values; effective auto-level mapping and no mutation of user preference.

- [x] **Done when:** Preset and Auto behavior are unit tested; all checks pass; browser 4K/DPR smoke shows stable settling.

## Task 3: Review, iterate, and hand off (#160)

**Files:** Create this plan's run log.

**Build:** Read the full diff, ask an independent reviewer to inspect behavior and tests, fix accepted findings, run fresh verification, and open a PR against `main`.

- [x] **Done when:** The independent reviewer reported no actionable findings; `npm run check` passes; PR is opened and attached.
