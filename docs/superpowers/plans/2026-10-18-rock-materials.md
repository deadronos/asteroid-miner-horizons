# Distinct Rock Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ore, ice and crystal rocks recognisable by shape and shading (metallic ore veins, glossy ice, emissive crystal facets), not only by tint, without raising the rock path above its current draw-call count.

**Architecture:** Each kind owns two of the six shape pools and one `MeshPhongMaterial`; all three materials share a single `onBeforeCompile` patch whose `uKind` uniform selects the per-kind fragment shading, on top of the existing damage-crack block. Shapes come from a `style`-parameterised `rockGeometry`. RockView keeps exactly 6 rock `InstancedMesh`es plus the pickups mesh, and buckets a rock by `rockShapeIndex(kind, id)`.

**Tech Stack:** TypeScript, Three.js (r186), Vite, vitest, oxlint/oxfmt

**Spec:** `docs/superpowers/specs/2026-10-18-rock-materials-design.md` — read it with this plan; it is the design of record and the authority for every decision below.

## Global Constraints

Copied from the issue and the spec's decisions:

- **Visual-only change.** Do not touch `src/sim/**`, gameplay, save format, or rock generation. The blast radius is `src/render/util.ts`, `src/render/rocks.ts`, tests, and docs.
- **Keep instancing.** 6 rock pools + 1 pickups pool = 7 meshes; the rock path must not grow with rock count (acceptance: draw calls under ~20 — this change adds none).
- **Kind ⇒ shape and shading.** Each kind is distinguishable by silhouette *and* shading, not only `ROCK_TINT` colour.
- **Damage cracks keep working on every kind.** The orange emissive crack block stays for all three materials.
- **`rockGeometry(seed)` with no style stays byte-identical** (default `'rock'`) — `src/render/debris.ts` depends on it.
- **All geometries stay within the cull bound.** Drawn extent ≤ 1.25 so `ROCK_BOUND` (1.3) still covers `extent × 1.035` shudder.
- **No new dependency.** Use what Three.js r186 ships.
- **Keep the full CI gate green:** `npm run format:check`, `npm run lint` (warnings fail), `npm run typecheck`, `npm test`, `npx vite build`.
- **Verification honesty.** A GLSL compile error only surfaces at runtime — the browser smoke test in Task 4 is mandatory, and the draw-call number must be measured, not asserted from memory.

Before every commit in every task, run `npm run format`, `npm run lint`, and `npm run typecheck` and confirm they pass.

## Review Focus

Failure modes the obvious assertions do **not** directly exercise, most-likely-first. Each has an owner.

1. **The GLSL additions fail to compile in the real shader.** No unit test compiles GLSL; the patch runs only when the GPU compiles the program. **Owning task:** Task 4 (browser smoke, console must be clean).
2. **A rock lands in the wrong kind's pool.** `update` must bucket by `rockShapeIndex(kind, id)`, not `id % 6`. **Owning task:** Task 3 (a crystal rock ends up in pool 4 or 5 with the crystal material).
3. **A style outgrows the cull bound** and its rocks pop out at the screen edge. **Owning task:** Task 1 (`all styles stay inside the cull bound`).
4. **The shared patch is never attached, so shading silently never runs** (e.g. material created without `onBeforeCompile`). **Owning task:** Task 2 (the compile callback injects `uKind` / rewrites the fragment shader).
5. **Debris geometry changes** because the `style` default was missed. **Owning task:** Task 1 (`defaults to the rock style`).

---

## Task 1: Kind-correlated rock shapes

**Files:**
- Modify: `src/render/util.ts` (`rockGeometry` gains `style`)
- Modify: `src/render/rocks.ts` (export `RockStyle`-driven helpers)
- Test: create `tests/rocks.test.ts`

**Interfaces:**
- Produces (in `src/render/util.ts`): `export type RockStyle = 'rock' | 'gem' | 'shard'`; `export function rockGeometry(seed: number, style?: RockStyle): THREE.BufferGeometry`.
- Produces (in `src/render/rocks.ts`): `export const ROCK_POOLS = 6`; `export function rockStyleOf(kind: RawResource): RockStyle` (`ore → 'rock'`, `ice → 'gem'`, `crystal → 'shard'`); `export function rockShapeIndex(kind: RawResource, id: number): number` — `RAW_RESOURCES.indexOf(kind) * 2 + (id % 2)`, i.e. ore ∈ {0,1}, ice ∈ {2,3}, crystal ∈ {4,5}.

- [ ] **Step 1: Write the failing test** in `tests/rocks.test.ts`.

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROCK_POOLS, rockShapeIndex, rockStyleOf } from '../src/render/rocks';
import { rockGeometry } from '../src/render/util';

const attr = (g: THREE.BufferGeometry): THREE.BufferAttribute => g.getAttribute('position') as THREE.BufferAttribute;
const extents = (g: THREE.BufferGeometry): { max: number; min: number } => {
  const a = attr(g);
  let max = 0;
  let min = Infinity;
  for (let i = 0; i < a.count; i++) {
    const d = Math.hypot(a.getX(i), a.getY(i), a.getZ(i));
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  return { max, min };
};

describe('rock shapes are kind-correlated', () => {
  it('gives every kind its own two-pool block', () => {
    for (const id of [0, 1, 2, 7, 8, 13]) {
      expect([0, 1]).toContain(rockShapeIndex('ore', id));
      expect([2, 3]).toContain(rockShapeIndex('ice', id));
      expect([4, 5]).toContain(rockShapeIndex('crystal', id));
    }
    expect(rockShapeIndex('ore', 0)).not.toBe(rockShapeIndex('ore', 1));
    expect(ROCK_POOLS).toBe(6);
  });

  it('assigns a distinct style per kind', () => {
    expect(rockStyleOf('ore')).toBe('rock');
    expect(rockStyleOf('ice')).toBe('gem');
    expect(rockStyleOf('crystal')).toBe('shard');
  });
});

describe('rockGeometry styles', () => {
  it('gem is a coarser mesh than rock', () => {
    expect(attr(rockGeometry(1000, 'gem')).count).toBeLessThan(attr(rockGeometry(1000, 'rock')).count);
  });

  it('shard is pointier than gem (more low-biased vertices)', () => {
    expect(extents(rockGeometry(1000, 'shard')).min).toBeLessThan(extents(rockGeometry(1000, 'gem')).min);
  });

  it('keeps every style inside the cull bound (1.25)', () => {
    for (const style of ['rock', 'gem', 'shard'] as const)
      for (let i = 0; i < 6; i++) expect(extents(rockGeometry(1000 + i * 77, style)).max).toBeLessThanOrEqual(1.25);
  });

  it('defaults to the rock style (debris is unchanged)', () => {
    expect(attr(rockGeometry(4242)).count).toBe(attr(rockGeometry(4242, 'rock')).count);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/rocks.test.ts`. Expected: FAIL — `rockStyleOf`, `rockShapeIndex`, `ROCK_POOLS` are not exported and `rockGeometry`'s second argument is a type error.

- [ ] **Step 3: Implement.**
  - `src/render/util.ts`: export `RockStyle` and add the `style` parameter. Keep the existing per-vertex de-dup loop and `computeVertexNormals()`. Use detail `1` for `'rock'`, `0` for `'gem'` and `'shard'`. Scale per style: `rock` `0.72 + next(r) * 0.5` (unchanged), `gem` `0.9 + next(r) * 0.14`, `shard` `0.55 + next(r) * next(r) * 0.6` (compute `next(r)` once per *unique* vertex, as today). Default style `'rock'`.
  - `src/render/rocks.ts`: add the three exports above. `RAW_RESOURCES` is already exported by `../data/resources`; import it. Keep `VARIANTS = 6` as-is or replace it with `ROCK_POOLS = 6` and update the two uses (the constructor loop and the `buckets` array) — but **do not** change how `update` picks a pool in this task.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/rocks.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/rocks.test.ts
git add src/render/util.ts src/render/rocks.ts tests/rocks.test.ts
git commit -m "Give ore, ice and crystal their own rock shapes (#20)"
```

---

## Task 2: Per-kind materials, shading and pools

**Files:**
- Modify: `src/render/rocks.ts` (replace `addCracks` with `patchRock` + `rockMaterial`; rebuild the `RockView` constructor's six pools per kind)
- Test: append to `tests/rocks.test.ts`

**Interfaces:**
- Produces: `export function rockMaterial(kind: RawResource): THREE.MeshPhongMaterial` — one material per kind, each with the shared patch attached; `ore` warm low-shininess, `ice` pale-cyan high-shininess, `crystal` violet emissive.
- Produces: a `RockView` whose pools `2k`/`2k+1` use `rockMaterial(RAW_RESOURCES[k])` and `rockGeometry(1000 + i * 77, rockStyleOf(RAW_RESOURCES[k]))`, in the order `[ore0, ore1, ice2, ice3, crystal4, crystal5, pickups]` at construction. **Note:** `InstancePool.reserve` re-appends a grown mesh, so this order holds at construction and under capacity (the tests stay well under 256); do not assert it after a growing update — Task 4 measures draw calls instead.
- `update` is **unchanged** in this task: it still buckets by `id % VARIANTS`, so a rock can visually land in the wrong kind's pool until Task 3. The unit tests here do not exercise that.
- The patch keeps the existing damage-crack code and adds a `uKind` uniform branch; it must set `shader.uniforms.uTime`, `shader.uniforms.uGlow`, and `shader.uniforms.uKind`.

- [ ] **Step 1: Write the failing test** — append to `tests/rocks.test.ts`.

```ts
import { RockView, rockMaterial } from '../src/render/rocks';
import type { RawResource } from '../src/data/resources';

/** Runs a material's compile callback against a shader stub and returns the stub. */
function compile(mat: THREE.Material): { uniforms: Record<string, unknown>; fragmentShader: string; vertexShader: string } {
  // The stub must carry the real injection markers, or `.replace` is a no-op.
  const stub = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
  };
  (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(stub, undefined);
  return stub;
}

describe('per-kind rock materials', () => {
  it('builds one distinct Phong material per kind', () => {
    const mats = (['ore', 'ice', 'crystal'] as RawResource[]).map(rockMaterial);
    for (const m of mats) expect(m).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(new Set(mats).size).toBe(3);
  });

  it('gives ice a sharper highlight than ore', () => {
    expect(rockMaterial('ice').shininess).toBeGreaterThan(rockMaterial('ore').shininess);
  });

  it('attaches the shading patch to every kind', () => {
    for (const kind of ['ore', 'ice', 'crystal'] as RawResource[]) {
      const stub = compile(rockMaterial(kind));
      expect(stub.uniforms.uKind).toBeDefined();
      expect(stub.fragmentShader).toContain('uKind');
      expect(stub.vertexShader).toContain('aDamage');
    }
  });
});

describe('RockView pools are built per kind', () => {
  it('draws the rock path with exactly 7 meshes', () => {
    expect(new RockView().group.children).toHaveLength(7);
  });

  it('uses each kind material on its own two pools', () => {
    const view = new RockView();
    const poolMat = (i: number) => (view.group.children[i] as THREE.InstancedMesh).material;
    expect(poolMat(0)).toBe(poolMat(1));
    expect(poolMat(2)).toBe(poolMat(3));
    expect(poolMat(4)).toBe(poolMat(5));
    expect(new Set([poolMat(0), poolMat(2), poolMat(4)]).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/rocks.test.ts`. Expected: FAIL — `rockMaterial` is not exported.

- [ ] **Step 3: Implement** in `src/render/rocks.ts`.
  - Rename `addCracks(mat)` to `patchRock(mat, kind)`: keep the whole existing vertex/fragment injection (the `aDamage`/`vDamage`/`vObj` varyings, the `hash3`/`vnoise` helpers, and the orange crack block), and set `shader.uniforms.uKind = { value: kindIndex }` alongside `uTime`/`uGlow`.
  - Add the per-kind branches exactly as the spec's **Shading** section describes, using `vNormal` (view space, flat), `vViewPosition`, `vObj`, `vDamage`, `uTime`, `uGlow`:
    - `ore`: ridged object-space vein mask; mix `diffuseColor` toward warm metal on the veins and add a faint warm emissive.
    - `ice`: fresnel rim `pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0)` added as a pale-cyan emissive.
    - `crystal`: facet hash from the flat normal gates an object-space noise mask; add violet emissive scaled by `uGlow`, with a slow `uTime` pulse.
    - Keep the crack block running for all kinds.
  - Add `rockMaterial(kind)`: `new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true })`, set `shininess`/`specular` per kind (ice highest), call `patchRock(mat, kind)`, return it.
  - Rebuild the `RockView` constructor's pool loop so pool `i` uses `RAW_RESOURCES[Math.floor(i / 2)]` for both `rockStyleOf(...)` (the geometry style) and `rockMaterial(...)`. `RAW_RESOURCES` is already exported by `../data/resources`. Keep `update` untouched in this task.

- [ ] **Step 4: Run the test and see it pass.** Run `npx vitest run tests/rocks.test.ts`. Expected: PASS (11 tests). A `MeshPhongMaterial` with `onBeforeCompile` set and never rendered is safe to construct without a GL context.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/rocks.test.ts
git add src/render/rocks.ts tests/rocks.test.ts
git commit -m "Shade ore, ice and crystal distinctly and pool them per kind (#20)"
```

---

## Task 3: Bucket rocks by kind and shape

**Files:**
- Modify: `src/render/rocks.ts` (`RockView.update`)
- Test: append to `tests/rocks.test.ts`

**Interfaces:**
- Consumes: `rockShapeIndex` (Task 1); the per-kind pools built in Task 2.
- Produces: `RockView.update` buckets each rock by `rockShapeIndex(r.kind, r.id)` instead of `r.id % VARIANTS`.

- [ ] **Step 1: Write the failing test** — append to `tests/rocks.test.ts`.

```ts
import { RockView } from '../src/render/rocks';
import type { Rock } from '../src/sim/types';
import type { RawResource } from '../src/data/resources';

const VIEW = { x: 0, z: 0, halfW: 1e9, halfH: 1e9 };
const rock = (id: number, kind: RawResource): Rock => ({
  id,
  kind,
  size: 0,
  pos: { x: 0, z: 0 },
  vel: { x: 0, z: 0 },
  radius: 10,
  hp: 1,
  maxHp: 1,
  units: 1,
  belt: 0,
});

/** Which of the six rock pools received the only rock, or -1. */
const usedPool = (view: RockView): number =>
  view.group.children
    .slice(0, 6)
    .map((m, i) => ({ i, count: (m as THREE.InstancedMesh).count }))
    .filter((p) => p.count > 0)
    .map((p) => p.i)[0] ?? -1;

describe('RockView bucketing', () => {
  it('sends rocks to their kind pools even when `id % 6` would not', () => {
    // id 2 → `id % 6` = 2 (an ice pool); a crystal rock must not land there.
    const crystal = new RockView();
    crystal.update([rock(2, 'crystal')], [], 0, VIEW);
    expect([4, 5]).toContain(usedPool(crystal));
    // id 0 → `id % 6` = 0 (an ore pool); an ice rock must not land there.
    const ice = new RockView();
    ice.update([rock(0, 'ice')], [], 0, VIEW);
    expect([2, 3]).toContain(usedPool(ice));
  });

  it('keeps the rock path at 7 meshes regardless of rock count', () => {
    const view = new RockView();
    view.update([rock(0, 'ore'), rock(1, 'ice'), rock(2, 'crystal'), rock(3, 'ore')], [], 0, VIEW);
    expect(view.group.children).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.** Run `npx vitest run tests/rocks.test.ts`. Expected: the first test FAILS — with Task 2's per-kind pools but `id % 6` bucketing, the crystal rock (`id 2`) lands in pool 2 (ice) and the ice rock (`id 0`) lands in pool 0 (ore). The second test passes before and after (it is the draw-call guard).

- [ ] **Step 3: Implement** in `src/render/rocks.ts`.
  - `update`: replace `this.buckets[r.id % VARIANTS]` with `this.buckets[rockShapeIndex(r.kind, r.id)]`. Everything else (hit tracking, damage, tint, shudder) is unchanged.
  - Remove the now-unused `VARIANTS` constant if Task 1 left it; keep `ROCK_POOLS`.
  - Update the `ROCK_BOUND` comment to name the largest style (`rock`, 1.22) as the bound driver.

- [ ] **Step 4: Run the test and see them pass.** Run `npx vitest run tests/rocks.test.ts tests/renderPerf.test.ts`. Expected: PASS — including the existing cull/particle tests.

- [ ] **Step 5: Gate and commit.**

```sh
npm run format && npm run lint && npm run typecheck && npx vitest run tests/rocks.test.ts tests/renderPerf.test.ts
git add src/render/rocks.ts tests/rocks.test.ts
git commit -m "Bucket rocks by kind and shape so each kind uses its own pools (#20)"
```

---

## Task 4: Browser verification and the full gate

**Files:** none (no `src/` or `tests/` change). Results go in the run log and the PR.

**Interfaces:** none.

- [ ] **Step 1: Full CI gate.** Run, in order, and confirm each passes:
  - `npm run format:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npx vite build`

- [ ] **Step 2: Browser smoke — mandatory, GLSL compiles only at runtime.** Start `npm run dev`, load the page, and use the `window.__amh` debug hook to inspect the running game:
  - Place one ore, one ice and one crystal rock near the player by pushing onto `__amh.state().run.rocks` (or push crystal into a system-1 belt) and let a frame render.
  - **Assert the console has no WebGL/shader errors.** A compile failure here fails the task.
  - Screenshot the belt and confirm the three kinds read differently by silhouette and shading, not only colour.
  - Report the screenshot path, the console result, and the browser/OS used.

- [ ] **Step 3: Measure runtime draw calls.** In the same session, read `__amh.renderer.gl.info.render.calls` with the belt on screen and record it; confirm it is comfortably under ~20 and unchanged from `main` at the same camera (compare against a run on `main` if the number is close to the cap).

- [ ] **Step 4: Confirm no commit is needed.** `git status` must be clean apart from the controller's docs. If anything else is dirty, stop and report rather than commit.

---

## Self-review

- **Spec coverage:** decision 1 (kind owns shape) → Tasks 1, 3; decision 2 (3 materials, 6 meshes) → Tasks 2, 3; decision 3 (Phong) → Task 2; decision 4 (fresnel ice) → Task 2; decision 5 (shader veins) → Task 2; decision 6 (facet emissive) → Task 2; decision 7 (cracks kept) → Task 2 (crack block retained) + Task 4 (browser); decision 8 (default style) → Task 1. Draw calls → Task 3 (count) + Task 4 (measured). Extent budget → Task 1.
- **Every task is red→green, honestly labelled:** Task 1 (exports + style parameter missing), Task 2 (`rockMaterial` missing; one Lambert material on all pools), Task 3 (`id % 6` bucketing) each contain a genuinely failing-first assertion; the cull-bound, debris-default and 7-mesh tests are guards that pass before and after.
- **Step scan:** every step yields a file, a test result, or a gate; no step retypes an implementation body the spec already pins.
- **Type consistency:** `RockStyle` / `rockGeometry(seed, style?)` (Task 1 → Tasks 2, 3); `rockStyleOf` (Task 1 → Task 2) and `rockShapeIndex` / `ROCK_POOLS` (Task 1 → Task 3); `rockMaterial(kind)` (Task 2, internal to the pool loop); `RockView.group` construction order `[0..5, pickups]` (Task 2 → Task 2's tests).
- **Review Focus:** each line names its owning task, and each owning task contains the named check (Task 1 extent; Task 2 patch attached; Task 3 wrong-pool; Task 4 GLSL compile).
