# Distinct rock materials — Orchestration Run Log

- **Date:** 2026-10-18
- **Issue:** #20, branch `feat/rock-materials` (off `main` at `4f94bd9`)
- **Plan:** `docs/superpowers/plans/2026-10-18-rock-materials.md` · **Spec:** `docs/superpowers/specs/2026-10-18-rock-materials-design.md`
- **Setup:** Subagent-driven development (`superpowers:subagent-driven-development`). The controller wrote the spec and plan, orchestrated, ran the full gate and the browser smoke test, and committed the docs. Each task was implemented by one subagent and reviewed by a second, separate subagent. Work happened in an isolated worktree (`~/.local/share/opencode/worktree/ee4e41/rock-materials`).
- **Baseline:** 307 tests / 22 files green before Task 1.

## Rulings I made

1. **Kind-partitioned shapes give 6 rock meshes, not 18.** The issue's parenthetical "one InstancedMesh per material × shape" taken literally with 6 shared shapes would give 3 × 6 = 18, leaving no headroom under the ~20 cap. Shapes are partitioned by kind instead (2 per kind), so it stays 6. *Cost if wrong:* small rework to a shared-shape/multi-material layout.
2. **Ore veins are fragment-shader object-space noise, not baked vertex colours.** Shared per-pool geometry makes baked veins coarse (12–42 verts) and identical per shape. *Cost if wrong:* a visual-style preference the author can ask to change.
3. **Group child order is asserted only at construction.** `InstancePool.reserve` re-appends a grown mesh, so tests stay under 256 capacity. *Cost if wrong:* a future growth-triggering test that asserts order needs a material-based lookup instead.
4. **The issue's "draw calls under ~20" is met for the rock path (7 meshes), not the whole scene (39 vs 42 on `main`).** The final review correctly noted the spec had claimed the budget was scene-wide; the spec and plan are corrected and the number is disclosed rather than read away. *Cost if wrong:* if the author means scene-wide, this branch does not satisfy it and never could without reworking pre-existing scenery (#18 territory).
5. **Model selection per SDD was not applied.** The harness's subagent tool contract forbids choosing a model unless the user asks; all subagents inherited the session model. *Cost if wrong:* more expensive reviews than a cheap-tier choice would have been.

## Per task

| # | Task | Implementer | Reviewer | Rounds | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | Kind-correlated rock shapes | `ses_eaf7a975dffesGzk7avwkiSlix` | `ses_eaf780254ffenxoMUt0mwmUTOY` | 1 + 0 | `3a1b25d` |
| 2 | Per-kind materials, shading and pools | `ses_eaf76d2d9ffeWlYwCul2mnB7pu` | `ses_eaf71ab17ffe6hLhk32ChsvPK5` | 1 + 0 | `e16f256` |
| 3 | Bucket rocks by kind and shape | `ses_eaf6eada6ffewe4D02yjJ39KEe` | `ses_eaf6dabf1ffeuF9jbj9hAnpW7c` | 1 + 0 | `5716635` |
| 4 | Browser verification + full gate | controller | — | — | (no commit) |
| — | Final-review fix wave | `ses_eaf65e43dffeXkovQKBvqCBlf9` | `ses_eaf64e83cffe0CSvFekdDR7Wc0` (scoped re-review) | 1 + 1 | `d772a62` |

Docs (spec + plan) committed as `eadd839` before Task 1. Final whole-branch reviewer: `ses_eaf6a63bdffej3OKbsDJQJhu8l`.

## Per task

### Task 1 — kind-correlated shapes
- **Implementer:** `DONE_WITH_CONCERNS`. Added `RockStyle` + a `style` parameter to `rockGeometry`, and exported `ROCK_POOLS` / `rockStyleOf` / `rockShapeIndex`. Concern: `tests/rocks.test.ts` needed a `vi.hoisted` DOM stub because `util.ts` builds `glowTexture` at import time (`document.createElement('canvas')`) and vitest's node env has none. It also verified the default style is byte-identical to the old algorithm (five seeds, maxDelta 0), so `debris.ts` is unaffected.
- **Reviewer:** ✅ spec compliant, approved. The default-path byte-identity and the unchanged `id % 6` pool selection both verified against source. Only minors (see below).

### Task 2 — per-kind materials, shading and pools
- **Implementer:** `DONE_WITH_CONCERNS`. Three `MeshPhongMaterial`s share one `onBeforeCompile` patch with a `uKind` uniform; the six pools are built kind-first with style-specific geometry. Concern: the plan/spec said to use `vNormal`, but under `flatShading: true` three defines `FLAT_SHADED` and `vNormal` is not declared; the implementer used the in-scope view-space flat normal `normal` and proved the literal alternative fails to compile (`ERROR: 0:'vNormal' : undeclared identifier`). It also loaded the dev server and called `gl.compile(scene, camera)`: 0 errors, exactly one program carrying the patch (`usedTimes: 3`).
- **Reviewer:** ✅ spec compliant, approved. Confirmed the `vNormal → normal` deviation against three r186's `normal_pars_fragment` (declares `vNormal` only `#ifndef FLAT_SHADED`), `normal_fragment_begin` (declares `normal` in both branches), the `meshphong` injection order, and the program-cache-key mechanism. Confirmed the crack block runs for all kinds.

### Task 3 — bucketing
- **Implementer:** `DONE`. One behavioural line: `this.buckets[rockShapeIndex(r.kind, r.id)]`. RED failed for the intended reason (`expected [4,5] to include 2`).
- **Reviewer:** ✅ spec compliant, approved. Confirmed the bucketing test is discriminating, not self-fulfilling (it reads `InstancedMesh.count`, and the assertions hard-code pool ranges rather than calling the helper).

### Task 4 — browser verification and gate
- **Controller.** No commit. Full gate green: `format:check`, `lint`, `typecheck`, 320 tests, `vite build`.
- **Browser smoke (Playwright, dev server):** used the `window.__amh` debug hook to place two ore, two ice and two crystal rocks around the flagship. The only console error was a favicon 404 — no WebGL/shader errors. Screenshot shows chunky tan ore, faceted pale-white ice gems and a violet crystal shard — distinct by shape and shading, not colour alone.
- **Draw calls at runtime (`gl.info.render.calls`, bloom off, same camera/scenario):** branch **39**, `main` **42**. The rock path is **7** meshes (6 shape pools + 1 pickups), unchanged; the change adds zero draws.

## Final whole-branch review

`ses_eaf6a63bdffej3OKbsDJQJhu8l` — **Ready to merge: with fixes**. No Critical. One Important (negative-id mis-bucketing in `rockShapeIndex`), one disclosure issue (the draw-call criterion had been read as rock-path-only while the spec claimed scene-wide), and cheap test/robustness minors.

**Fix wave (`d772a62`):** non-negative parity in `rockShapeIndex` (+ a test), a `max(0.0, …)` clamp on the ice fresnel `pow` base, a `uKind` value assertion, a true element-by-element byte-identity check for the default style, and honest draw-call disclosure in the spec and plan.

**Scoped re-review (`ses_eaf64e83cffe0CSvFekdDR7Wc0`):** all findings ADDRESSED, no new breakage.

## Deferred minors (for the author, not blocking)

- `rockShapeIndex` hardening landed; the `-1` case is now tested.
- The `usedPool` test helper assumes the rock pools are children 0–5 (true at construction; `reserve` can reorder).
- `KIND_INDEX` duplicates the `RAW_RESOURCES` order invariant (comment says so).
- One kind now concentrates into 2 pools; `reserve` grows ×2 safely, and belts never approach 256 per pool.
- The crystal facet hash uses the view-space normal, so a facet's glow can change as the camera orbits (rocks spin anyway).

## Verification artefacts

- Screenshot from the browser smoke test: `.superpowers/sdd/rock-materials-task-4.png` (git-ignored).
