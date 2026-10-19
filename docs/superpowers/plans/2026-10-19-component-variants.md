# Component Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-slot component variants (Focused/Wide beam, Standard/Thruster engine) so a fit is a choice, with a real splash mechanic and a variant chosen at install.

**Architecture:** Introduce a `VariantDef` layer under each `ComponentDef`. `Fitted` gains a `variant`, so the change ripples through stats, economy, handlers, hull loadouts, UI and the bot. Default variants keep today's numbers and prices exactly, so existing price/snapshot tests guard behaviour preservation. Save v7 → v8 maps old parts to their default variant.

**Tech Stack:** TypeScript (pure `core`/`data`/`sim`), Vitest, DOM HUD, headless bot harness.

**Spec:** `docs/superpowers/specs/2026-10-19-component-variants-design.md`

## Global Constraints

- **Purity:** `src/core`, `src/data`, `src/sim` use no DOM, no three.js, no `Math.random`, no `Date` inside a tick.
- **Determinism:** same seed + command stream ⇒ identical serialised state (`tests/sim.test.ts`).
- **Plain data:** `GameState` stays JSON-serialisable (no classes, no `Map`).
- **No per-tick allocation** on the hot path (`tests/alloc.test.ts`); splash must reuse the existing spatial hash, not allocate arrays per query.
- **No new dependencies.** Node 22.12+.
- **`npm run check` is the bar** after every task; never hand-edit `docs/balance.md`; do not touch `scratch.md`.
- **Preserve today's numbers:** the default variant of every component keeps its exact current `describe`, effects, and T1/T2/T3 prices. The `refining.test.ts` price table and `stats.test.ts` snapshot are the net.
- Style: one short header comment per module, `/** */` on exported functions and non-obvious fields, no comment noise.

## Review Focus

- **A non-default variant's refund path** (`remove`/`scrap`/`buyHull` overflow) refunds half of *that variant's* invested cost, not the default's. Guarded by Tasks 1–2.
- **Default-variant numbers and prices are byte-identical to before** — any drift silently moves balance and every refund. Guarded by Task 1.
- **Splash must not damage the target twice, must skip rocks already removed this tick, and must be deterministic** (no iteration-order dependence on allocation). Guarded by Task 3.
- **Every old save still loads**: the v2–v7 fixtures become v8 with default variants, and a slot with an unknown `(type, variant)` is rejected rather than read. Guarded by Task 4.
- **Stale refit UI**: the panel's structural key must include the variant, or switching a fitted part's variant leaves the old row on screen. Guarded by Task 5.

---

### Task 1: Variant data model and the behaviour-preserving refactor

**Files:**
- Rewrite: `src/data/components.ts`
- Modify: `src/data/tuning.ts`, `src/data/hulls.ts`, `src/sim/types.ts`, `src/sim/ships.ts`, `src/sim/economy.ts`, `src/sim/handlers.ts`, `scripts/bot.ts`, `src/ui/panels/ShipPanel.ts`
- Test: `tests/components.test.ts` (create), `tests/stats.test.ts`, `tests/refining.test.ts`, `tests/sim.test.ts`, `tests/commands.test.ts`, `tests/__snapshots__/stats.test.ts.snap`

**Interfaces:**
- Produces:
  - `type VariantId = 'focused' | 'wide' | 'ion' | 'thruster' | 'standard'`
  - `interface VariantDef { id; name; short; describe(tier); cost(tier); effects }`
  - `interface ComponentDef { id; name; variants: readonly VariantDef[] }`
  - `defaultVariant(type): VariantId`; `variantDef(type, variant): VariantDef`; `isVariant(type, variant): variant is VariantId`
  - `ShipStatKey` gains `'splash'`; `TUNING.splashMul = 0.5`
  - `Fitted = { type: ComponentId; variant: VariantId; tier: Tier }`
  - `investedCost(type: ComponentId, variant: VariantId, tier: Tier): Cost`

- [ ] **Step 1: Write the failing tests** in `tests/components.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPONENTS, COMPONENT_IDS, defaultVariant, isVariant, variantDef,
  LASER_DPS, ENGINE_SPEED, type ComponentId, type Tier,
} from '../src/data/components';
import { shipStats } from '../src/sim/ships';
import { newGame } from '../src/sim/create';

const TIERS: Tier[] = [1, 2, 3];

describe('component variants', () => {
  it('gives laser and engine two variants and the rest one', () => {
    expect(COMPONENTS.laser.variants.map((v) => v.id)).toEqual(['focused', 'wide']);
    expect(COMPONENTS.engine.variants.map((v) => v.id)).toEqual(['ion', 'thruster']);
    for (const id of COMPONENT_IDS) expect(COMPONENTS[id].variants.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the default variant on today’s numbers', () => {
    expect(defaultVariant('laser')).toBe('focused');
    expect(defaultVariant('engine')).toBe('ion');
    expect(variantDef('laser', 'focused').effects[0]!.values).toEqual(LASER_DPS);
    expect(variantDef('engine', 'ion').effects[0]!.values).toEqual(ENGINE_SPEED);
    // an unknown variant falls back to the default (validation happens elsewhere)
    expect(variantDef('laser', 'nonsense' as never).id).toBe('focused');
    expect(isVariant('laser', 'wide')).toBe(true);
    expect(isVariant('laser', 'ion')).toBe(false);
  });

  it('has non-empty effects and unique variant ids for every component', () => {
    for (const id of COMPONENT_IDS) {
      const ids = COMPONENTS[id].variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const v of COMPONENTS[id].variants) expect(v.effects.length).toBeGreaterThan(0);
    }
  });

  it('gives a fitted Wide Beam a splash radius and a Focused Beam none', () => {
    const state = newGame(7);
    const ship = state.run.ships[0]!;
    ship.slots = [
      { type: 'laser', variant: 'focused', tier: 1 },
      { type: 'laser', variant: 'wide', tier: 1 },
      { type: 'engine', variant: 'thruster', tier: 1 },
      null,
    ];
    const st = shipStats(ship, state.profile);
    expect(st.splash).toBeGreaterThan(0);
    // thruster trades top speed for acceleration
    expect(st.accel).toBeGreaterThan(0);
  });
});
```

Also update the existing tests that read the old shape:
- `tests/stats.test.ts:52` — `expect(COMPONENTS[id].effects.length)` becomes a per-variant check.
- `tests/refining.test.ts:413-430` — iterate each component's **default** variant for the T1/T2/OLD_T3 price table, plus a new loop that every variant's T3 costs alloy.
- `tests/sim.test.ts:106-112` — the "tier costs rise monotonically" test iterates every `(component, variant)`.
- `tests/commands.test.ts:71` — the fitted object literal gains `variant: 'standard'` (install still uses the default this task).

- [ ] **Step 2: Run the new test, expect failure** — `npx vitest run tests/components.test.ts` (no `variants` on `ComponentDef`).

- [ ] **Step 3: Implement the refactor.**

`src/data/components.ts`: define `VariantId`, `VariantDef`, `ComponentDef.variants`, and the three helpers. Keep `LASER_DPS`, `LASER_RANGE`, `ENGINE_SPEED`, `ENGINE_ACCEL`, `SHIELD_CAP`, `SHIELD_REGEN`, `ARMOR_HULL`, `ARMOR_DMG_MUL`, `CARGO_CAP`, `SENSOR_MAGNET` exported and unchanged. Add `WIDE_LASER_DPS = [18, 23, 38]`, `WIDE_LASER_RANGE = [150, 180, 220]`, `SPLASH_RADIUS = [45, 60, 80]`, `THRUSTER_SPEED = [22, 45, 70]`, `THRUSTER_ACCEL = [120, 240, 380]`. Add `'splash'` to `ShipStatKey`. `laser` has `focused` (dps/range, `tiered(1.25)`) and `wide` (dps/range + `splash` add, `tiered(1.05)`); `engine` has `ion` (`ENGINE_SPEED`/`ENGINE_ACCEL`, `tiered(1)`) and `thruster` (`THRUSTER_SPEED`/`THRUSTER_ACCEL`, `tiered(0.95)`); every other component has one `standard` variant carrying today's name/short/describe/cost/effects.

`defaultVariant`, `variantDef` (fallback to `variants[0]`), `isVariant` (`variants.some((v) => v.id === variant)`), and `defaultVariant` via `variants[0]!.id`.

`src/data/tuning.ts`: add `splashMul: 0.5` under a `// Component variants (#49).` comment.

`src/data/hulls.ts`: `loadout: ({ type: ComponentId; variant: VariantId; tier: Tier } | null)[]`; entries — prospector `{ laser, focused, 1 }`, `{ engine, ion, 1 }`; drone `{ laser, focused, 1 }`; harvester `{ laser, focused, 1 }`, `{ cargo, standard, 1 }`.

`src/sim/types.ts`: `Fitted` gains `variant: VariantId`.

`src/sim/ships.ts`: `emptyStats()` gains `splash: 0`; `writeShipStats` uses `variantDef(f.type, f.variant).effects`.

`src/sim/economy.ts`: `investedCost(type, variant, tier)` reads `variantDef(type, variant).cost`; `upgradeCost` uses `variantDef(f.type, f.variant).cost(f.tier + 1)`.

`src/sim/handlers.ts`: `install` builds `{ type: cmd.comp, variant: defaultVariant(cmd.comp), tier: 1 }` (the command gains a `variant` field in Task 2); `upgrade` logs `variantDef(cur.type, cur.variant).name`; every `investedCost(...)` call passes the fitting's `variant`; `install`'s affordability check uses `variantDef(cmd.comp, defaultVariant(cmd.comp)).cost(1)`.

`scripts/bot.ts` and `src/ui/panels/ShipPanel.ts`: replace `COMPONENTS[x].cost/name/describe` reads with `variantDef(x, f.variant ?? defaultVariant(x))` equivalents so they compile and keep today's behaviour; pass `variant` to `investedCost`. (Their variant *choice* arrives in Tasks 2 and 5.)

- [ ] **Step 4: Refresh the stats snapshot** — `npx vitest run tests/stats.test.ts -u`; inspect: the snapshot gains a variant dimension, and no default-variant stat value changes.

- [ ] **Step 5: Run tests** — `npx vitest run tests/components.test.ts tests/stats.test.ts tests/refining.test.ts tests/sim.test.ts tests/commands.test.ts tests/alloc.test.ts`.

- [ ] **Step 6: `npm run check`** — green.

- [ ] **Step 7: Commit** — `git commit -m "Add a component variant model behind the tier ladder (#49)"`.

---

### Task 2: `install` chooses a variant

**Files:**
- Modify: `src/sim/commands.ts`, `src/sim/handlers.ts`, `src/ui/panels/ShipPanel.ts`, `scripts/bot.ts`
- Test: `tests/commands.test.ts`, `tests/sim.test.ts`

**Interfaces:**
- Consumes: `isVariant`, `variantDef`, `Fitted` (Task 1).
- Produces: `{ t: 'install'; shipId: number; slot: number; comp: ComponentId; variant: VariantId }`.

- [ ] **Step 1: Write the failing tests** in `tests/commands.test.ts`

```ts
it('install fits the chosen variant at tier 1', () => {
  // docked, funded; send install with comp 'laser', variant 'wide'
  // expect(fs.slots[2]).toEqual({ type: 'laser', variant: 'wide', tier: 1 });
});
it('rejects an unknown component variant', () => {
  // send install with variant 'ion' on comp 'laser'
  // expect a warn log line and fs.slots[2] to be null
});
```

Update the existing `install`/`upgrade`/`remove` tests and `tests/sim.test.ts:100` to pass a `variant` on every `install`.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — add `variant: VariantId` to the `install` variant in `commands.ts`; in the `install` handler, `if (!isVariant(cmd.comp, cmd.variant)) return fail(state, 'Unknown component variant.');`, then use `cmd.variant` for the fitted object, the `pay(...)` cost and the log name. Update the two UI/bot `install` send sites to pass a variant (`defaultVariant(comp)` for now; the UI gets a real choice in Task 5).

- [ ] **Step 4: Run tests** — `npx vitest run tests/commands.test.ts tests/sim.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Choose a component variant when installing (#49)"`.

---

### Task 3: Wide-beam splash

**Files:**
- Modify: `src/sim/pilot.ts`
- Test: `tests/pilot.test.ts` (or a new `tests/splash.test.ts`)

**Interfaces:**
- Consumes: `ShipStatKey.splash`, `TUNING.splashMul` (Task 1), `laserRock(state, rock, dmg, laserTier)` (#48).

- [ ] **Step 1: Write the failing tests**

```ts
it('splashes damage onto a rock near the target but not one outside the radius', () => {
  // a ship with a wide laser at tier 1; target rock at range, neighbour at radius-1 inside splash, far rock outside
  // after a tick of workRock: neighbour hp dropped, far rock hp unchanged, target hp dropped by its own dps*dt (not doubled)
});
it('chains to a fragment shattered by splash', () => {
  // a neighbour already at 1 hp breaks from splash; workRock returns it in the fragment list
});
it('is deterministic', () => {
  // two identical states ticked identically end byte-identical
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — in `pilot.workRock`, collect the beam's fragments, and when `st.splash > 0` query `ctx.index.rockHash` at `rock.pos` with radius `st.splash + 60`, exact-test `dist(n.pos, rock.pos) <= st.splash + n.radius`, skip `n.id === rock.id` and any rock not in `ctx.index.rockById`, damage with `laserRock(state, n, st.dps * ctx.dt * TUNING.splashMul, st.laserTier)`, and append returned fragments to the result so `runOrder`'s chain still fires. Reuse the same scratch as needed; allocate nothing per rock.

- [ ] **Step 4: Run tests** — `npx vitest run tests/pilot.test.ts tests/alloc.test.ts tests/sim.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Splash wide-beam damage onto nearby rocks (#49)"`.

---

### Task 4: Save v7 → v8

**Files:**
- Modify: `src/sim/create.ts`, `src/sim/migrations.ts`, `src/sim/save.ts`
- Create: `tests/fixtures/save-v7.json`
- Test: `tests/migrations.test.ts`

- [ ] **Step 1: Create the v7 fixture** — copy `tests/fixtures/save-v6.json`, set `state.version` to `7` (leave its rocks without `trait`, which the v6→v7 no-op allows), and import it as `V7_FIXTURE`.

- [ ] **Step 2: Write the failing tests** in `tests/migrations.test.ts` — a `component variants migration to v8` block: every fixture (v2–v7) loads as `SAVE_VERSION` with each non-null slot carrying `variant === defaultVariant(slot.type)`; a save with a slot whose `variant` is unknown for its `type` is rejected (`ok: false`); a slot with `tier: 4` is rejected; a round-trip keeps a non-default variant. Update the `currentRun()` helper to add `variant: defaultVariant(type)` to the slots it builds.

- [ ] **Step 3: Run, expect failure.**

- [ ] **Step 4: Implement** — `SAVE_VERSION = 8`; `migrations[7] = (d) => { for (const ship of d.run.ships) for (const f of ship.slots) if (f) f.variant = defaultVariant(f.type); return d; }` with a comment; in `save.ts` `fromData`, add a per-ship `slots.every(isFitted)` check (null, or known `type` + `isVariant(type, variant)` + `tier ∈ {1,2,3}`), importing `COMPONENTS`/`isVariant`/`defaultVariant` from `../data/components`.

- [ ] **Step 5: Run tests** — `npx vitest run tests/migrations.test.ts tests/session.test.ts tests/sim.test.ts`.

- [ ] **Step 6: `npm run check`** — green.

- [ ] **Step 7: Commit** — `git commit -m "Persist component variants and migrate saves to v8 (#49)"`.

---

### Task 5: Refit UI variant choice

**Files:**
- Modify: `src/ui/panels/ShipPanel.ts`
- Test: `tests/shipPanel.test.ts` (create if there is a pure seam; otherwise the panel's pure helpers)

**Interfaces:**
- Consumes: `COMPONENTS`, `variantDef`, `defaultVariant`, `investedCost(type, variant, tier)`.

- [ ] **Step 1: Write failing tests** for the pure seam: an `installOptions()` (or equivalent exported helper) returns, for each component, one option per variant labelled `Family — Variant` when there are several and `Family` when there is one, and `variantOptions`/refund text use the fitted variant's cost. If the panel has no seam, extract one.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — the empty-slot `<select>` lists `(component, variant)` options with `value = `${cid}:${v.id}`` and sends `install` with both; a fitted row uses `variantDef(f.type, f.variant)` for its name, `describe(tier)`, upgrade label and remove-refund title; the panel's structural key string (currently `f.type + f.tier`) includes `f.variant`.

- [ ] **Step 4: Run tests** — `npx vitest run tests/shipPanel.test.ts tests/commands.test.ts`.

- [ ] **Step 5: `npm run check`** — green.

- [ ] **Step 6: Commit** — `git commit -m "Offer component variants in the refit panel (#49)"`.

---

### Task 6: Bot variant order and balance

**Files:**
- Modify: `scripts/bot.ts`
- Test: `tests/bot.test.ts`
- Regenerate: `docs/balance.md`

- [ ] **Step 1: Write the failing test** in `tests/bot.test.ts` — with an empty docked flagship slot and a funded bank, `botCommands` installs the default variant (e.g. a `laser` fitted with `variant: 'focused'`), and an install command always carries a `variant` valid for its `comp`.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — `INSTALL_ORDER` becomes `{ comp: ComponentId; variant: VariantId }[]` using the **default** variants (`focused`, `ion`, `standard`), and the install command carries the variant. Leave `UPGRADE_ORDER` as component ids (`upgradeCost` is already variant-aware).

- [ ] **Step 4: Run tests** — `npx vitest run tests/bot.test.ts`.

- [ ] **Step 5: `npm run balance`** and inspect against `git show <merge-base>:docs/balance.md`: the bot uses default variants, so the delta should be ≈ neutral; record it. Adjust only a component-variant knob if a genuine regression appears.

- [ ] **Step 6: `npm run check`** — green.

- [ ] **Step 7: Commit** — `git commit -m "Teach the balance bot about component variants (#49)"` (include `docs/balance.md`).

---

## Self-Review

- **Spec coverage:** data model (§1) → Task 1; splash (§2) → Task 3; state/save (§3) → Tasks 1 and 4; commands/economy/UI/bot (§4) → Tasks 1, 2, 5, 6. Every section maps to a task.
- **Type consistency:** `VariantId`, `VariantDef`, `variantDef`, `defaultVariant`, `isVariant`, `investedCost(type, variant, tier)` are defined once in Task 1 and used unchanged in Tasks 2–6; the `install` command gains `variant` in Task 2 and every sender is updated in the same task.
- **Review Focus coverage:** refund path → Tasks 1–2; default numbers/prices → Task 1; splash correctness/determinism → Task 3; old saves → Task 4; stale UI key → Task 5.
