# System Modifiers + Warp Pacing Implementation Plan

> **For agentic workers:** Each task below is implemented by a Claude Code CLI session (`claude -p --model sonnet`) and reviewed by a separate read-only session (`claude -p --model opus`); Claude orchestrates, smoke-tests UI in the browser and commits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** #47 — four seeded system modifiers (dense belt, metal-rich, ice-poor, nebula), none in systems 1–2 and one or two from system 3, stored on `run.system`, applied through belt generation and per-tick multipliers, and shown in the top bar and on warp. #44 — with modifiers in, measure warp pacing to warp 10 (and 12) and tune so time per warp grows gently with margin.

**Architecture:** pure modifier data in `src/data/modifiers.ts`; rolling, effect products, belt application, stat application and text in a new pure `src/sim/modifiers.ts`; `StarSystem.modifiers` set by `generateSystem` from a dedicated RNG stream; save v4 → v5; `SimIndex` and `regrowBelts` read the per-tick effects; the warp handler logs them; the top bar shows chips; the balance report gains modifier and spike columns; then tuning.

**Tech Stack:** TypeScript, Three.js, Vite, vitest, oxlint/oxfmt

**Spec:** `docs/superpowers/specs/2026-10-19-system-modifiers-design.md`

## Global Constraints

- **`src/core`, `src/data`, `src/sim` stay pure:** no DOM, no three.js, no `Math.random`, no `Date`.
- **`src/data` stays a leaf:** `data/modifiers.ts` may import types from `./resources` only.
- **Determinism:** modifiers come from their own RNG stream. The system generator's `r` and `run.rng` must draw exactly what they drew before for the same `(seed, number)`; systems 1–2 are byte-identical; contract boards are untouched.
- **Modifiers act only through** belt `initialCount` / `mix` at generation and the pickup radius / regrow interval per tick. No new entities, no renderer changes.
- **`shipStats` keeps its signature**; the nebula pickup radius is applied by `applySystemStats` in `SimIndex.rebuild` and the ship panel.
- Match the surrounding style: short header comment per module, `/** */` on exported functions and non-obvious fields, no comment noise. Format: oxfmt (printWidth 120, single quotes, trailing commas).
- Every task ends with `npm run check` passing (format:check, lint, typecheck, tests).
- Do not touch `scratch.md`. No new dependencies. Do not commit.

## Lifecycle checklist (UI and save tasks)

Every UI or save task must hold up across: **warp** (new system number, new modifiers, the log line), **loading another slot** (different seed, possibly the same system number with different modifiers — the top bar must rebuild), **new game** (system 1, no modifiers, no chips), and **an old save** (v2, v3 and v4 fixtures load with `modifiers: []` and no chips). Reviewers check each explicitly; the orchestrator smoke-tests UI tasks in the browser at 1280×800, 1024×700 and 800×700.

## Review Focus

1. **RNG drift:** rolling modifiers must not consume the generator's `r` or `run.rng`. Task 1 pins pre-change generation values.
2. **Old saves:** a pre-v5 system has no `modifiers`; `systemEffects(undefined)` would throw every tick. Task 2 migrates and validates.
3. **Effects applied twice or not at all:** belt count scaled in `generateSystem` only (not again in `populateBelts` or regrow); magnet applied in exactly the index and the panel.
4. **Stale HUD after load** (top bar key). Task 4.
5. **Pacing regressions** hidden by medians. Task 5 adds the per-seed spike column; Task 6 tunes against both seed sets.

## Pre-change generation snapshot (for Task 1 tests)

Captured by the orchestrator at `efc16f2` with `generateSystem(seed, n)`. Belt counts are before modifiers.

| seed | n | name | class | richness | station angle | planets | belt counts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | Qutha | G | 1 | 2.13369893865669 | 3 | 160, 140 |
| 1 | 2 | Mitha | G | 1.2452006654581056 | 1.2588449731803038 | 3 | 199, 174 |
| 1 | 3 | Synul | G | 1.1177642497001217 | 0.8583932946348027 | 3 | 179, 156, 90 |
| 1 | 4 | Dralor | G | 1.218241674033925 | 0.6214427227038132 | 4 | 195, 171, 90 |
| 1 | 5 | Katar | G | 1.1509522020583973 | 4.432055281692334 | 3 | 184, 161, 90 |
| 42 | 1 | Thave | G | 1 | 3.201979038730834 | 3 | 160, 140 |
| 42 | 2 | Synpha | G | 1.0651993627194316 | 2.650210482784303 | 3 | 170, 149 |
| 42 | 3 | Drasyn | G | 1.0941019642865286 | 3.7484416405430774 | 4 | 175, 153, 90 |
| 42 | 4 | Lorqu | G | 1.127992323273793 | 2.2504534065203465 | 4 | 180, 158, 90 |
| 42 | 5 | Osno | M | 1.0662008121376858 | 0.6287513443943855 | 3 | 171, 149, 90 |
| 1000 | 1 | Ixos | G | 1 | 1.9512963131066174 | 5 | 160, 140 |
| 1000 | 2 | Lorzen | G | 0.8520086991135031 | 5.015751531715479 | 3 | 136, 119 |
| 1000 | 3 | Draix | G | 1.0733190007973463 | 4.910850486325875 | 5 | 172, 150, 90 |
| 1000 | 4 | Lorno | G | 1.1511435370426626 | 6.196593146759961 | 3 | 184, 161, 90 |
| 1000 | 5 | Thatar | M | 1.2135819202754647 | 0.8059552389278726 | 5 | 194, 170, 90 |

## Task 1: Modifier data, rolling, generation

**Files:** Create `src/data/modifiers.ts`, `src/sim/modifiers.ts`, `tests/modifiers.test.ts`; modify `src/data/tuning.ts`, `src/sim/types.ts`, `src/sim/generate.ts`, plus any test the typecheck flags for a `StarSystem` literal. Do **not** bump `SAVE_VERSION` (Task 2).

**Build (spec §1–§3):**
- `data/modifiers.ts`: header comment; `ModifierId = 'dense' | 'metalRich' | 'icePoor' | 'nebula'`; `ModifierDef` exactly as spec §1 with doc comments; `MODIFIERS` with the starting values `dense { name: 'Dense belt', beltCount: 1.4 }`, `metalRich { name: 'Metal-rich', mix: { ore: 1.6 } }`, `icePoor { name: 'Ice-poor', mix: { ice: 0.55 } }`, `nebula { name: 'Nebula', magnet: 0.7, regrowInterval: 0.5 }`; `MODIFIER_IDS = Object.keys(MODIFIERS) as ModifierId[]`.
- `TUNING`: new `// System modifiers.` block with `/** First system number that rolls modifiers. */ modifierMinSystem: 3` and `/** Chance a system rolls a second modifier. */ modifierTwoChance: 0.5`.
- `types.ts`: `StarSystem.modifiers: ModifierId[]` with the spec §3 doc comment.
- `sim/modifiers.ts`: header comment; `SystemEffects` interface; `rollModifiers(seed, number)`, `systemEffects(mods)`, `applyBeltModifiers(belts, mods)`, `applySystemStats(st, system)`, `describeModifier(id)`, `describeModifiers(mods)` exactly as spec §2. The RNG is `makeRng((seed ^ 0x2c1b3c6d) + number * 15485863)`; draw `chance` first, then one `pick` per modifier from the ids not yet chosen. `applySystemStats` is defined now but only wired in Task 3.
- `generate.ts`: after the belts are built (including the third belt) and before the return, `const modifiers = rollModifiers(seed, number); applyBeltModifiers(belts, modifiers);` and add `modifiers` to the returned object. No other change; in particular nothing new draws from `r`.

**Tests (`tests/modifiers.test.ts`):**
- every `MODIFIERS` entry has a non-empty name and every multiplier is finite and > 0; `MODIFIER_IDS` has 4 entries.
- `rollModifiers(seed, 1)` and `(seed, 2)` are `[]` for seeds 0–199; for seeds 0–199 × systems 3–12: length 1 or 2, no duplicates, all ids known; across that sample both lengths occur and all four ids occur; calling twice gives equal arrays.
- for each row of the pre-change snapshot above: `generateSystem(seed, n)` has the same name, star class, planet count, richness (`toBe`) and station angle (`toBe`); for `n ≤ 2` belt counts equal the table and `modifiers` is `[]`; for `n ≥ 3`, each belt count equals `Math.round(tableCount × systemEffects(modifiers).beltCount)`.
- `systemEffects([])` → all ones (mix `{ ore: 1, ice: 1, crystal: 1 }`); `systemEffects(['dense', 'nebula'])` → `beltCount 1.4, magnet 0.7, regrowInterval 0.5`; `systemEffects(['metalRich', 'icePoor'])` → mix `{ ore: 1.6, ice: 0.55, crystal: 1 }`.
- `applyBeltModifiers` on a hand-built belt list scales `initialCount` (rounded) and multiplies mix weights; `[]` leaves them unchanged.
- `describeModifier`: `dense` → `+40% asteroids`, `metalRich` → `+60% ore rocks`, `icePoor` → `−45% ice rocks`, `nebula` → `−30% pickup radius, belts regrow 2× faster`; `describeModifiers(['dense', 'nebula'])` → `Dense belt (+40% asteroids) · Nebula (−30% pickup radius, belts regrow 2× faster)`; `describeModifiers([])` → `''`. A test that temporarily builds a def with `regrowInterval: 0.4` (call the formatting through a helper that takes a `ModifierDef`, e.g. export `describeDef(def)`) gives `belts regrow 2.5× faster`.
- `applySystemStats` multiplies `magnet` for a nebula system and leaves every other stat unchanged.
- `newGame(1)` system 1 has `modifiers: []`; the determinism test in `tests/sim.test.ts` still passes.

**Done when:** `npm run check` passes. (Orchestrator check: a balance run's system 1–2 rows are identical to the pre-change report.)

## Task 2: Save migration v4 → v5

**Files:** Modify `src/sim/create.ts` (`SAVE_VERSION = 5`), `src/sim/migrations.ts` (`migrations[4]`), `src/sim/save.ts` (`fromData`); Test: extend `tests/migrations.test.ts`. `tests/fixtures/save-v4.json` already exists (frozen by the orchestrator) — do not edit it or the v2/v3 fixtures.

**Build (spec §6):** `migrations[4] = (d) => { d.run.system.modifiers = []; return d; }` with a `// v5 added …` comment explaining why the old system gets none. `fromData` rejects a run whose `system.modifiers` is not an array, or holds an entry that is not a string key of `MODIFIERS` (`Object.hasOwn`), with a one-line comment (the tick indexes `MODIFIERS`). Rework the existing "valid v4 save" helpers (`v4Run`, `saveV4`, `saveWithBoard`, …) so they build a genuine current-version save (add `modifiers: []` to the system) instead of weakening assertions; rename them if the name now lies.

**Tests:** v2, v3 and v4 fixtures each load through `parseImport` as `version 5` with `run.system.modifiers` equal to `[]`, and each survives one `tick` (use `SimIndex`) with finite bank values; the v4 fixture keeps its bank, refinery and contract board unchanged by the migration (deep-equal to the parsed fixture's values); a v5 save without `system.modifiers` → `parseImport` `ok: false`; with `modifiers: 'dense'` → rejected; with `['dense', 'warpStorm']` → rejected; with `['dense', 'nebula']` → accepted and kept; a malformed v4 payload with no `run.system` → `ok: false`, not thrown.

**Lifecycle:** old save (v2, v3, v4) covered by tests.

**Done when:** `npm run check` passes.

## Task 3: Per-tick effects and the warp log

**Files:** Modify `src/sim/index.ts` (`rebuild`), `src/sim/update.ts` (`regrowBelts`), `src/sim/handlers.ts` (`warp`); Tests: extend `tests/modifiers.test.ts` and `tests/commands.test.ts`.

**Build (spec §4, §5 warp):**
- `SimIndex.rebuild`: `this.stats.set(s.id, applySystemStats(shipStats(s, state.profile), run.system))`; update the class doc if it mentions what stats contain.
- `regrowBelts`: `if (run.regrowTimer < TUNING.beltRegrowInterval * systemEffects(run.system.modifiers).regrowInterval) return;` — nothing else changes (the target stays `initialCount × beltRegrowTarget`, and `initialCount` already carries the dense multiplier).
- `warp` handler: after the `Warp complete…` log line and before the contract/refinery warnings, when `state.run.system.modifiers.length > 0` push `{ level: 'major', text: `System modifiers: ${describeModifiers(mods)}.` }`.

**Tests:**
- index: a state whose `run.system.modifiers = ['nebula']` → `index.stats.get(flagship.id).magnet === shipStats(flagship).magnet * 0.7` (toBeCloseTo); with `[]` they are equal.
- pickups: place a pickup at `0.85 ×` the flagship's base magnet radius (not moving, cargo free); one tick in a normal system pulls it (velocity becomes non-zero toward the ship), the same setup with `['nebula']` leaves its velocity at 0.
- regrow: empty `run.rocks`, `regrowTimer = 0`; with `[]`, ticking `0.5 × beltRegrowInterval + ε` spawns nothing and `beltRegrowInterval + ε` spawns; with `['nebula']`, `0.5 × beltRegrowInterval + ε` spawns. (Drive `tick` with `SimIndex`; ship positions may block a spawn, so move ships far away or assert on `run.rocks.length > 0` after the interval.)
- warp: fund a warp from a profile whose next system rolls modifiers (find one by looping seeds with `rollModifiers(seed, 3)` from `profile.warps = 1`) → the log line right after `Warp complete` is `System modifiers: …` and equals `describeModifiers(state.run.system.modifiers)`; a warp into system 2 (from `warps = 0`) logs no modifier line.
- determinism test still passes.

**Done when:** `npm run check` passes.

## Task 4: HUD — top bar chips and the MAG readout

**Files:** Modify `src/ui/panels/TopBar.ts`, `src/ui/panels/ShipPanel.ts`, `src/style.css`; Test: create `tests/topBar.test.ts` only for an exported pure helper (see below).

**Build (spec §5):**
- Export a pure `topBarKey(state: GameState): string` from `TopBar.ts` returning `` `${run.system.number}|${run.system.modifiers.join(',')}` `` and use it as the panel key (the panel tests in `tests/refineryPanel.test.ts` show how such helpers are tested without a DOM).
- After the `sys` span, a `span.mods` holding one `span.mod` per modifier: `text` = `MODIFIERS[id].name`, `title` = `describeModifier(id)`. When there are none, do not add the `.mods` span at all.
- `ShipPanel`: the `MAG` readout uses `applySystemStats(shipStats(s, state.profile), state.run.system).magnet`; the other stats are unchanged (only `magnet` is affected).
- CSS (next to the `.res` rules): `.mods { display: inline-flex; gap: 6px; }` and `.mod { font-size: 0.85em; padding: 1px 7px; border: 1px solid rgba(160, 190, 255, 0.45); border-radius: 9px; color: #bcd0ff; background: rgba(60, 80, 140, 0.25); }`. The top bar already scrolls horizontally when too wide; nothing else moves.

**Tests (`tests/topBar.test.ts`):** `topBarKey` differs for the same system number with different modifiers, and for different numbers; equal for equal inputs.

**Lifecycle:** warp (new chips, key changes), load another slot with the same system number and different modifiers (key changes → rebuild), new game (no chips), old save (migrated `[]` → no chips; MAG readout equals the plain stat).

**Done when:** `npm run check` passes and `npm run build` succeeds. The orchestrator smoke-tests in the browser (1280×800, 1024×700, 800×700).

## Task 5: Balance report — modifiers and spikes

**Files:** Modify `scripts/balance.ts` only (and `tests/bot.test.ts` only if it breaks).

**Build (spec §7):**
- `WarpStats` gains `mods: string` (the run's `system.modifiers.join('+')`, captured once per warp at its start, before the bot runs).
- CSV: append `mods` as the last column.
- Per-warp table: a new column `> 2× prev` after `vs previous`: the number of seeds (among those with both warps, excluding walls as the ratio column does) whose ratio exceeds 2; `—` for system 1.
- After the per-warp table: `## Modifiers` with columns `| Modifier | Seed-warps | Time vs system median |`. For each `MODIFIER_IDS` entry (by name), the seed-warps whose `mods` include it, and `stat(relative times, (n) => `${n.toFixed(2)}×`)` where relative = `sec / median(sec of all seeds at that system)`. A last row `None (system ≥ 3)` for seed-warps at system ≥ 3 with no modifier. Walls are excluded from the relative times. Rows with zero seed-warps show `0 | —`.
- Update the header comment (usage unchanged).

**Done when:** `npm run check` passes; `npm run balance -- --seeds 20 --warps 10 --out /tmp/a.md` runs; its system 1 and 2 CSV lines, minus the new `mods` column, are identical to the pre-change set-A CSV the orchestrator provides (`efc16f2`, same command); the modifier table has all five rows. Report the run time. **Do not tune anything in this task.**

## Task 6: #44 — warp pacing to warp 10 with margin

**Files:** Tuning only: `src/data/tuning.ts`, `src/data/modifiers.ts`, `src/data/perks.ts`, `src/data/refining.ts` (keep the recipe value-equality test true); tests only if a tuned value is pinned by one (update deliberately). No bot policy changes. `docs/balance.md` is regenerated by the orchestrator, not the implementer.

**Measure with** (both every iteration):
- set A: `npm run balance -- --seeds 20 --warps 10 --out /tmp/A.md`
- set B: `npm run balance -- --seed-start 2000 --seeds 10 --warps 10 --out /tmp/B.md`
- and for the final candidate: set A with `--warps 12 --out /tmp/A12.md`.

Each run takes about 1 minute (12 warps: about 2). Use the CSV, not eyeballing: write a throwaway script in `/tmp` that prints per system the median time, the ratio of medians, the median of per-seed ratios and the `> 2×` count.

**Hard bar (decides keep or revert):**
1. No walls on set A or set B at 10 warps, and none on set A at 12 warps.
2. For every system 2–10 on both sets: ratio of median times ≤ 1.6 **and** median of per-seed ratios ≤ 1.6. Systems 11 and 12 on set A: the same ≤ 1.6.
3. Total `> 2×` count over both sets for systems 2–10 ≤ the post-modifier baseline count the orchestrator gives you.
4. Systems 1–3 median times within ±10 % of the pre-modifier baseline on both sets (given below by the orchestrator); system 1 rows and the opening table unchanged.

**Aim (only breaks ties between candidates that pass the hard bar):** geometric-mean growth of the median time from system 3 to 10 between 1.08 and 1.22 on both sets; each modifier's median relative time within 0.80–1.25×.

**Order of levers:** `warpCostGrowth` first (try 1.30, 1.27, 1.25, 1.22), then `warpBaseFuel` only if systems 2–3 drift, then modifier magnitudes if a modifier is outside 0.80–1.25× or the spike count rose, then (only if the hard bar is still missed) the yield perk or `dataDivisor`. Change one lever per iteration.

**Report:** a table of every iteration (knobs → per-system median times and ratios for both sets, spike count, geo growth, walls), the final values, and which hard-bar items each rejected candidate failed.

**Done when:** `npm run check` passes and the final values meet every hard-bar item on the stated runs.
