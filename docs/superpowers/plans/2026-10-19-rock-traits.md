# Rock Traits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give belt rocks three seeded, saved traits (volatile, dense, magnetic) that each trade risk for reward, shown in the hover tooltip and telegraphed in 3D.

**Architecture:** A pure data table (`data/traits.ts`) and a pure rules module (`sim/traits.ts`) own the trait ids, yield multipliers and predicates. `Rock` gains one optional field. Trait rolling is a stateless hash, so `run.rng` is never drawn from and the rock layout is unchanged; only `units` and the new behaviour move. The dense gate is a new `laserTier` ship stat; the volatile blast and magnetic drift live in the existing mining and rock-update paths.

**Tech Stack:** TypeScript (no DOM in `core`/`data`/`sim`), Vitest, three.js instanced rendering, the headless bot harness in `scripts/`.

**Spec:** `docs/superpowers/specs/2026-10-19-rock-traits-design.md`

## Global Constraints

- **Purity.** `src/core`, `src/data`, `src/sim` use no DOM, no three.js, no `Math.random`, no `Date` inside a tick.
- **Determinism.** Same seed + command stream ⇒ identical serialised state (`tests/sim.test.ts`). Trait rolling must not draw from `run.rng` — assert `run.rng.s` is unchanged.
- **Plain data.** `GameState` stays JSON-serialisable: no classes, no `Map` in saved state.
- **No per-tick allocation** on the hot path (`tests/alloc.test.ts` is the net). Magnetic drift must not allocate.
- **No new dependencies.** Node 22.12+.
- **`npm run check` is the bar** (format:check + lint + typecheck + tests) after every task.
- **Never hand-edit `docs/balance.md`** — regenerate with `npm run balance`.
- **Do not touch `scratch.md`.**
- Style: one short header comment per module, `/** */` on exported functions and non-obvious fields, no comment noise.
- The dense gate changes only the `mine` handler (no new `Command` variant), but the handler change still needs a rejection test.

## Review Focus

- **Any draw from `run.rng` in trait rolling, or any change to a rock's id/kind/pos/radius/hp.** Expected: `run.rng.s` and the whole rock layout are byte-identical to before; only `units` and `trait` differ. Guarded by Task 1.
- **An unknown `rock.trait` string in a hand-edited save being read by the tick.** Expected: `fromData` rejects it with `{ ok: false }`, never throwing. Guarded by Task 6.
- **A traited parent's yield bonus being re-applied to its fragments.** Expected: fragments carry conserved units, exactly the parent's total. Guarded by Task 3.
- **AI that fixates on an un-cuttable dense rock, or that mines a volatile from inside its own blast.** Expected: drones/bot skip rocks `canMine` rejects; `workRock` stands off a volatile. Guarded by Tasks 2 and 4.
- **Magnetic drift dividing by zero at zero distance, or allocating a vector per rock per tick.** Expected: no NaN, no allocation. Guarded by Task 5.

---

### Task 1: Trait data, tuning knobs and rolling (inert)

**Files:**
- Create: `src/data/traits.ts`, `src/sim/traits.ts`
- Modify: `src/data/tuning.ts`, `src/sim/types.ts`, `src/sim/generate.ts`, `src/sim/create.ts`, `src/sim/update.ts`
- Test: `tests/traits.test.ts` (create)

**Interfaces:**
- Produces:
  - `type RockTrait = 'volatile' | 'dense' | 'magnetic'`
  - `TRAITS: Record<RockTrait, TraitDef>`; `TRAIT_IDS: readonly RockTrait[]`; `interface TraitDef { id; name; icon; blurb; color: number }`
  - `Rock.trait?: RockTrait`
  - `rollTrait(seed: number, number: number, id: number): RockTrait | null`
  - `traitYield(trait: RockTrait | undefined): number`
  - `spawnBeltRock(run: Run, seed: number, beltIndex: number, sizeOverride?: RockSize): Rock`
  - `populateBelts(run: Run, seed: number): void`
  - `makeRock(run, kind, size, pos, units, belt, trait: RockTrait | null = null): Rock`

- [ ] **Step 1: Write the failing tests** in `tests/traits.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { TRAITS, TRAIT_IDS } from '../src/data/traits';
import { newProfile, newRun } from '../src/sim/create';
import { rollTrait } from '../src/sim/traits';
import type { Rock } from '../src/sim/types';

const layout = (rocks: Rock[]) =>
  rocks.map((r) => [r.id, r.kind, r.pos.x, r.pos.z, r.radius, r.hp] as const);

describe('trait data', () => {
  it('has three distinct known traits with colours', () => {
    expect(TRAIT_IDS).toEqual(['volatile', 'dense', 'magnetic']);
    for (const id of TRAIT_IDS) expect(Number.isFinite(TRAITS[id].color)).toBe(true);
  });
});

describe('rollTrait', () => {
  it('is a pure function of its inputs', () => {
    expect(rollTrait(7, 1, 42)).toBe(rollTrait(7, 1, 42));
  });

  it('rolls all three traits and mostly null over many ids', () => {
    const seen = new Set<string>();
    let nulls = 0;
    for (let id = 1; id <= 4000; id++) {
      const t = rollTrait(7, 1, id);
      if (t === null) nulls++;
      else seen.add(t);
    }
    expect(seen.size).toBe(3);
    expect(nulls / 4000).toBeGreaterThan(0.7); // ~0.78 for traitChance 0.22
  });

  it('changes with seed, system and id', () => {
    expect(new Set([rollTrait(1, 1, 5), rollTrait(2, 1, 5), rollTrait(1, 2, 5), rollTrait(1, 1, 6)]).size).toBeGreaterThan(1);
  });
});

describe('trait rolling leaves the run untouched', () => {
  // BEFORE implementing, on the branch base commit, run this and record the two
  // constants (they are the pre-change facts this feature must not disturb):
  //   const run = newRun(newProfile(99));
  //   console.log(run.rng.s, JSON.stringify(layout(run.rocks)));
  const BASE_RNG_S = 0; // <- replace with the recorded value
  const BASE_LAYOUT: readonly unknown[] = []; // <- replace with the recorded layout

  it('does not draw from run.rng and keeps the rock layout', () => {
    const run = newRun(newProfile(99));
    expect(run.rng.s).toBe(BASE_RNG_S);
    expect(layout(run.rocks)).toEqual(BASE_LAYOUT);
  });

  it('is deterministic across two runs of one profile', () => {
    expect(layout(newRun(newProfile(99)).rocks)).toEqual(layout(newRun(newProfile(99)).rocks));
  });
});
```

- [ ] **Step 2: Run tests, expect failure** — `npx vitest run tests/traits.test.ts` (module `src/data/traits` missing).

- [ ] **Step 3: Implement**

`src/data/traits.ts` (new, leaf module, no imports):

```ts
export type RockTrait = 'volatile' | 'dense' | 'magnetic';
export interface TraitDef { id: RockTrait; name: string; icon: string; blurb: string; color: number; }
export const TRAITS: Record<RockTrait, TraitDef> = {
  volatile: { id: 'volatile', name: 'Volatile', icon: '☢', blurb: 'explodes when cut', color: 0xff6a3a },
  dense: { id: 'dense', name: 'Dense', icon: '⛏', blurb: 'needs a T2 laser', color: 0x8fa6b8 },
  magnetic: { id: 'magnetic', name: 'Magnetic', icon: '⌖', blurb: 'drifts toward ships', color: 0x5ad1ff },
};
export const TRAIT_IDS = Object.keys(TRAITS) as RockTrait[];
```

Add the `// Rock traits (#48).` block to `TUNING` with the exact values from the spec §1 (`traitChance: 0.22`, `volatileBlastPad: 120`, `volatileBlastDamage: 40`, `volatileYieldMul: 1.5`, `denseMinLaserTier: 2`, `denseYieldMul: 1.6`, `magnetTraitRange: 300`, `magnetTraitAccel: 10`, `magnetTraitMaxSpeed: 24`, `magnetTraitYieldMul: 1.3`).

`src/sim/traits.ts` (new): `rollTrait`, `traitYield` per spec §2. `rollTrait` uses `hash01((seed ^ (number * 0x9e3779b1) ^ (id * 0x85ebca6b)) | 0)`; `traitYield` maps volatile/dense/magnetic to their `TUNING` multipliers and everything else to 1.

`src/sim/types.ts`: add `trait?: RockTrait` to `Rock`, imported as a type.

`src/sim/generate.ts`: `makeRock` gains a trailing `trait: RockTrait | null = null` and sets `trait` on the returned object (leave `units` alone this task). `spawnBeltRock(run, seed, beltIndex, sizeOverride?)` computes `rollTrait(seed, run.system.number, run.nextId)` and passes it to `makeRock`. `populateBelts(run, seed)` forwards `seed`.

`src/sim/create.ts`: `populateBelts(run, profile.seed)`. `src/sim/update.ts` `regrowBelts`: `spawnBeltRock(run, state.profile.seed, i, ...)`.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/traits.test.ts tests/sim.test.ts tests/alloc.test.ts`.

- [ ] **Step 5: `npm run check`** — green (typecheck will force the two call sites updated).

- [ ] **Step 6: Commit** — `git commit -m "Add rock trait data and seeded rolling (#48)"`.

---

### Task 2: Dense gate — `laserTier`, `canMine`, rejection, AI skip

**Files:**
- Modify: `src/data/components.ts`, `src/sim/ships.ts`, `src/sim/traits.ts`, `src/sim/mining.ts`, `src/sim/handlers.ts`, `src/sim/pilot.ts`, `scripts/bot.ts`
- Test: `tests/traits.test.ts` (add), `tests/stats.test.ts` (snapshot update), `tests/commands.test.ts`, `tests/bot.test.ts`

**Interfaces:**
- Consumes: `rollTrait`, `TRAITS` (Task 1).
- Produces:
  - `ShipStatKey` gains `'laserTier'`; `emptyStats().laserTier === 0`.
  - `canMine(stats: ShipStats, rock: Rock): boolean` in `src/sim/traits.ts`.
  - `laserRock(state: GameState, rock: Rock, dmg: number, laserTier: number): Rock[] | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/traits.test.ts`: build a ship with only a tier-1 laser fitted ⇒ `shipStats(...).laserTier === 1`; two tier-1 lasers ⇒ still `1`; one tier-2 ⇒ `2`. Then:

```ts
it('canMine blocks a dense rock below the laser gate and allows it at tier 2', () => {
  // stats with laserTier 1 -> false for a dense rock, true for a plain rock
  // stats with laserTier 2 -> true for a dense rock
});
it('laserRock leaves a dense rock untouched below the gate', () => {
  // dense rock hp taken from generate.makeRock(..., 'dense'); laserRock(..., 5, 1) -> hp unchanged, returns null
  // laserRock(..., 5, 2) -> hp reduced
});
```

In `tests/commands.test.ts`: a docked ship whose best laser is tier 1, `send({ t: 'mine', shipId, rockId: denseRock.id })` ⇒ `state.out.log` has a `warn` entry containing `Dense`, and `ship.order` is unchanged.

In `tests/bot.test.ts`: with a tier-1 flagship and a dense rock in the run, `botCommands(state)` never returns a `mine` for that rock (and does for a plain rock).

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement**

`src/data/components.ts`: `ShipStatKey` gains `'laserTier'`; the `laser` component's `effects` gains `{ stat: 'laserTier', op: 'max', values: [1, 2, 3] as const }`. `src/sim/ships.ts`: `emptyStats()` gains `laserTier: 0`.

`src/sim/traits.ts`: `canMine(stats, rock) => !(rock.trait === 'dense' && stats.laserTier < TUNING.denseMinLaserTier)`.

`src/sim/mining.ts`: `laserRock` gains the `laserTier` parameter and returns `null` without touching `hp` when `rock.trait === 'dense' && laserTier < TUNING.denseMinLaserTier`. `src/sim/pilot.ts` `workRock`: pass `st.laserTier`; every `nearestRock` call in `droneThink` requires `canMine(st, r)` (add `canMine(st, r) &&` to the existing filters).

`src/sim/handlers.ts` `mine`: locate the rock first (`state.run.rocks.find(...)`); if it is dense and `!canMine(shipStats(ship, state.profile), rock)` ⇒ `return fail(state, 'Dense rock — needs a tier-2 laser.')` before setting `ship.order`.

`scripts/bot.ts` `pickRock`: `if (!canMine(shipStats(fs, state.profile), r)) continue;`.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/traits.test.ts tests/commands.test.ts tests/bot.test.ts tests/stats.test.ts`.

- [ ] **Step 5: Refresh the stats snapshot** — `npx vitest run tests/stats.test.ts -u`; inspect the diff: only `laserTier` appears/updates; no other stat changes.

- [ ] **Step 6: `npm run check`** — green.

- [ ] **Step 7: Commit** — `git commit -m "Gate dense rocks behind a tier-2 laser (#48)"`.

---

### Task 3: Trait yield multipliers

**Files:**
- Modify: `src/sim/generate.ts`
- Test: `tests/traits.test.ts` (add)

**Interfaces:**
- Consumes: `traitYield` (Task 1).
- Produces: no new symbols.

- [ ] **Step 1: Write the failing tests**

```ts
it('scales a traited belt rock units by its trait', () => {
  // makeRock(run, 'ore', 0, pos, null, 0, 'dense').units === round(plainUnits * TUNING.denseYieldMul)
  // compare against makeRock(..., null) at the same radius: build both by seeding a fixed run.rng
});
it('does not re-multiply a fragment share', () => {
  // destroyRock/makeRock with explicit units keeps them exactly (unit conservation)
});
```

To make the radius deterministic in the first test, call `makeRock` with a fresh `makeRng(k)` reset before each call so both draw the same radius.

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement** — in `makeRock`, when `units == null`, multiply the base units by `traitYield(trait)` before `Math.round`/`Math.max(1, …)`; when `units` is provided, use it verbatim.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/traits.test.ts tests/rocks.test.ts tests/sim.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Reward traited rocks with extra yield (#48)"`.

---

### Task 4: Volatile blast and mining stand-off

**Files:**
- Modify: `src/sim/traits.ts`, `src/sim/mining.ts`, `src/sim/pilot.ts`
- Test: `tests/traits.test.ts`

**Interfaces:**
- Produces:
  - `volatileBlastRadius(rock: Rock): number` — `rock.radius + TUNING.volatileBlastPad`.
  - `volatileSafeDistance(rock: Rock): number` — `volatileBlastRadius(rock) + 16`.

- [ ] **Step 1: Write the failing tests**

```ts
it('a volatile break damages an alive ship inside the blast and not one outside', () => {
  // two ships at radius+pad-1 and radius+pad+1 from a volatile rock; destroyRock -> inner hull drops, outer untouched
});
it('a volatile blast pushes an explode fx and damages no rocks', () => {
  // destroy a volatile rock with a neighbour rock nearby; neighbour hp unchanged; out.fx contains { t: 'explode' }
});
it('workRock stands off a volatile target at least at the safe distance', () => {
  // assert pilot's chosen stand distance == max(st.range*0.8, volatileSafeDistance(rock)) and < st.range + rock.radius
});
```

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement** — add the two helpers to `src/sim/traits.ts`. In `destroyRock` (`src/sim/mining.ts`), when the rock is volatile: push `{ t: 'explode', pos: { ...rock.pos } }`, then `damageShip(state, ship, TUNING.volatileBlastDamage * (rock.radius / 40))` for every `run.ships` entry that `isAlive` and is within `volatileBlastRadius`. In `pilot.workRock`, compute the stand distance as `Math.min(rock.trait === 'volatile' ? Math.max(reach * 0.8, volatileSafeDistance(rock)) : reach * 0.8, reach)` and use it for `arrive`; the fire branch already only runs inside `reach`.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/traits.test.ts tests/pilot.test.ts tests/sim.test.ts tests/alloc.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Explode volatile rocks and stand off while mining (#48)"`.

---

### Task 5: Magnetic drift

**Files:**
- Modify: `src/sim/update.ts`
- Test: `tests/traits.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('pulls a magnetic rock toward a ship within range', () => {
  // tick once with dt large enough; rock.vel points toward the ship after the update
});
it('caps a magnetic rock at magnetTraitMaxSpeed', () => {
  // |rock.vel| <= TUNING.magnetTraitMaxSpeed after a tick
});
it('leaves a plain rock and a distant ship alone', () => {
  // plain rock vel unchanged (orbit only); magnetic rock beyond range gains no inward velocity
});
it('does not NaN when the rock sits on the ship', () => {
  // rock at ship.pos -> finite vel
});
```

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement** — in the `update.ts` rock loop, inside the non-comet branch after the orbit velocity update and before integrating `pos`, when `r.trait === 'magnetic'`: scan `run.rocks`'s ships (`run.ships`) for the nearest alive one within `TUNING.magnetTraitRange`; if found and the distance is `> 1e-6`, add `(dx/d) * TUNING.magnetTraitAccel * dt` to `r.vel.x/z`, then clamp the speed to `TUNING.magnetTraitMaxSpeed`. Use only local numbers — no array/object allocation.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/traits.test.ts tests/sim.test.ts tests/alloc.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Drift magnetic rocks toward nearby ships (#48)"`.

---

### Task 6: Save v6 → v7

**Files:**
- Modify: `src/sim/create.ts`, `src/sim/migrations.ts`, `src/sim/save.ts`
- Create: `tests/fixtures/save-v6.json`
- Test: `tests/migrations.test.ts`

**Interfaces:**
- Consumes: `TRAITS` (Task 1).
- Produces: `SAVE_VERSION === 7`; `migrations[6]`.

- [ ] **Step 1: Create the v6 fixture** — copy `tests/fixtures/save-v5.json`, set `state.version` to `6`, and add to `state.run`:
  `"hazards": { "rng": { "s": 1 }, "cometTimer": 100, "comet": null, "flareTimer": 100, "flare": null, "comets": 0, "flares": 0 }`.
  (Any finite numbers are valid; `fromData` only checks shape.) Import it in `tests/migrations.test.ts` as `V6_FIXTURE`.

- [ ] **Step 2: Write the failing tests** in the `hazards migration to v6` style, a new block:

```ts
describe('rock traits migration to v7', () => {
  it.each([['v5', V5_FIXTURE], ['v6', V6_FIXTURE]])('loads the %s fixture as v7 with plain rocks', (_l, raw) => {
    const state = loadFrozen(raw);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.run.rocks.every((r) => r.trait === undefined)).toBe(true);
  });
  it('rejects a rock with an unknown trait', () => {
    const run = loadFrozen(V6_FIXTURE).run;
    run.rocks[0]!.trait = 'bogus' as never;
    expect(parseImport(JSON.stringify({ version: 7, profile: loadFrozen(V6_FIXTURE).profile, run })).ok).toBe(false);
  });
  it('keeps a known trait through a round-trip', () => {
    const run = loadFrozen(V6_FIXTURE).run;
    run.rocks[0]!.trait = 'volatile';
    const state = parseImport(JSON.stringify({ version: 7, profile: loadFrozen(V6_FIXTURE).profile, run }));
    if (!state.ok) throw new Error('expected the save to load');
    expect(state.record.state.run.rocks[0]!.trait).toBe('volatile');
  });
});
```

- [ ] **Step 3: Run tests, expect failure.**

- [ ] **Step 4: Implement** — `SAVE_VERSION = 7`. `migrations[6] = (d) => d` with the comment "v7 added an optional `rock.trait`; old rocks stay plain." In `save.ts` `fromData`, after the rocks-array check, reject any rock whose `trait` is neither absent nor a key of `TRAITS`. Import `TRAITS` from `../data/traits`.

- [ ] **Step 5: Run tests, expect pass** — `npx vitest run tests/migrations.test.ts tests/session.test.ts tests/sim.test.ts`.

- [ ] **Step 6: `npm run check`** — green.

- [ ] **Step 7: Commit** — `git commit -m "Persist rock traits and migrate saves to v7 (#48)"`.

---

### Task 7: Tooltip and 3D telegraph

**Files:**
- Create: `src/ui/rockTooltip.ts`
- Modify: `src/ui/Hud.ts`, `src/render/rocks.ts`
- Test: `tests/tooltip.test.ts` (create), `tests/rocks.test.ts` (extend)

**Interfaces:**
- Produces:
  - `rockTooltip(rock: Rock): string` — `Large ice asteroid · Volatile (explodes when cut) · 120 units · 100%`.
  - `traitIndex(trait: RockTrait | undefined): number` in `src/render/rocks.ts` — volatile 1, dense 2, magnetic 3, plain 0.

- [ ] **Step 1: Write the failing tests**

`tests/tooltip.test.ts`: a plain rock ⇒ no trait clause; a volatile rock ⇒ contains `Volatile (explodes when cut)` between the kind and `units`.

`tests/rocks.test.ts`: extend the shader test — the compiled vertex shader contains `aTrait`; and each trait writes its index into the pool's `aTrait` attribute while a plain rock writes 0 (read the geometry attribute via `view.group.children[i]`).

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement**

`src/ui/rockTooltip.ts`: the exact string from `Hud.showTooltip` today, with `TRAITS[rock.trait]` inserted when present. `Hud.showTooltip` calls it.

`src/render/rocks.ts`: `InstancePool` gains an `aTrait` float `InstancedBufferAttribute` created and re-created wherever `aDamage` is; `commit()` flags it; `patchRock`'s vertex shader declares `attribute float aTrait; varying float vTrait;` and the fragment shader accents volatile/dense/magnetic; `RockView.update` writes `traitIndex(r.trait)` per rock.

- [ ] **Step 4: Run tests, expect pass** — `npx vitest run tests/tooltip.test.ts tests/rocks.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Show rock traits in the tooltip and scene (#48)"`.

---

### Task 8: Bot balance run and tuning

**Files:**
- Modify: `docs/balance.md` (regenerated), possibly `src/data/tuning.ts`
- Test: none new (verification)

- [ ] **Step 1: Run the balance report** — `npm run balance`.
- [ ] **Step 2: Inspect** `docs/balance.md` for a new wall or a system-1..3 regression against the committed baseline. If time per warp or early-system times moved more than the trait yields explain, adjust `traitChance` or the yield multipliers in `TUNING` and re-run; do not hand-edit the report.
- [ ] **Step 3: `npm run check`** — green.
- [ ] **Step 4: Commit** — `git commit -m "Regenerate balance for rock traits (#48)"` (include any tuning change).

---

## Self-Review

- **Spec coverage:** data (§1) → Task 1; rolling/state (§2) → Task 1; dense (§3) → Task 2; yield (§3) → Task 3; volatile (§3) → Task 4; magnetic (§3) → Task 5; AI (§4) → Tasks 2 (drones/bot dense) and 4 (volatile stand-off); display (§5) → Task 7; save (§6) → Task 6; balance (§7) → Task 8. Every spec section maps to a task.
- **Type consistency:** `laserTier` is added once (Task 2) and read by `canMine`/`workRock`; `rollTrait`/`traitYield` names match across Tasks 1–3; `volatileSafeDistance` is defined in Task 4 and used only there.
- **Review Focus coverage:** isolation → Task 1; unknown trait → Task 6; fragment double-yield → Task 3; AI fixation/self-blast → Tasks 2 & 4; magnetic NaN/allocation → Task 5.
