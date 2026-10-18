# Rock traits: volatile, dense, magnetic

- **Date:** 2026-10-19
- **Issue:** #48 — "Rock traits: volatile, dense, magnetic"
- **Status:** Approved design

## Context / problem

All rocks behave the same except for hp/yield. The mining loop — the loop the
player is in roughly 80 % of the time — is identical rock to rock, so the only
progression is a bigger laser and a bigger hold.

The issue proposes three seeded traits, shown in the tooltip, and asks for
"visual cues per trait":

1. **Volatile ice** — explodes on break, area damage.
2. **Dense metal** — requires a tier-2+ laser.
3. **Magnetic** — drifts toward ships.

Acceptance criteria:

1. Traits are seeded and saved.
2. The tooltip shows the trait.

**Design decision (agreed with the maintainer):** each trait is **risk + reward**,
not a tax. A trait makes a rock harder or riskier but pays extra, so it is a
decision ("worth the gear/risk?") rather than something the rational player
waits out. `dense` gates on a **hard** `laserTier ≥ 2`, so "requires a tier-2
laser" is exact: two tier-1 lasers still cannot cut it.

### What exists today

- `Rock` (`sim/types.ts`) is plain JSON: `id, kind, size, pos, vel, radius, hp,
  maxHp, units, belt, comet?`.
- `makeRock` (`sim/generate.ts`) rolls a radius from `run.rng`, derives hp from
  `rockHp(radius, kind)` and units from `rockYieldK · r² · richness`; fragments
  pass explicit `units` to conserve them (`sim/mining.ts`).
- `spawnBeltRock` (belt fill and regrowth) and `hazards.spawnComet` are the only
  creators of fresh rocks; `destroyRock` is the only breaker.
- Damage is applied by `mining.laserRock(state, rock, dmg)`, called from
  `pilot.workRock` with the ship's **aggregate** `st.dps`; `st.range` sets how
  far the ship holds station.
- The hover tooltip is `Hud.showTooltip(x, y, rock, label)` in `src/ui/Hud.ts`
  and already prints size/kind/units/hp — the trait is one more clause.
- Rocks are drawn by `RockView` (`render/rocks.ts`) as six `InstancedMesh` pools
  (two shapes per kind), with a per-instance `aDamage` vec3 and a shared patched
  Phong shader keyed by `uKind`.

## Goals

- Three seeded traits on belt rocks, stored on `Rock` (save v6 → v7).
- Each trait is a risk + reward, tuned in `TUNING` in one place.
- Rolling draws **nothing** from `run.rng`, so the rock layout, `run.rng.s` and
  the balance numbers' *inputs* are byte-identical to before; only the trait
  behaviour is new.
- The tooltip names the trait; the 3D scene telegraphs it.
- The drone AI and the balance bot stay competent: they do not fixate on a rock
  they cannot cut, and they do not blow themselves up mining volatiles.
- The balance report is regenerated and the delta recorded.

## Non-goals

- **Trait stacking** (two traits on one rock) or trait levels. One trait max.
- **Chains**: a volatile blast damages **ships only**, never other rocks, so
  destruction cannot recurse.
- **New pickups, resources or contracts.** Traits change rocks, nothing else.
- **Trait-specific commands.** An entire trait is expressed through existing
  state and the existing `mine` command.
- **A trait toggle in settings.** Traits are part of the world from system 1.
- Any change to `run.rng`, rock ids, kinds, positions or hp.

## Design

### 1. Data: `src/data/traits.ts` (new, pure)

```ts
export type RockTrait = 'volatile' | 'dense' | 'magnetic';

export interface TraitDef {
  id: RockTrait;
  /** Display name for the tooltip and logs, e.g. 'Volatile'. */
  name: string;
  /** Tooltip glyph. */
  icon: string;
  /** Short user-facing clause, e.g. 'explodes when cut'. */
  blurb: string;
  /** Render accent colour. */
  color: number;
}

export const TRAITS: Record<RockTrait, TraitDef>;
export const TRAIT_IDS: readonly RockTrait[]; // Object.keys(TRAITS)
```

Starting values:

| Id | Name | Icon | Blurb | Colour |
| --- | --- | --- | --- | --- |
| `volatile` | Volatile | ☢ | explodes when cut | `0xff6a3a` |
| `dense` | Dense | ⛏ | needs a T2 laser | `0x8fa6b8` |
| `magnetic` | Magnetic | ⌖ | drifts toward ships | `0x5ad1ff` |

Traits are **kind-agnostic**: any non-comet rock can roll any of the three, one
trait maximum, and fragments are plain. The tooltip already prints the kind
(`Large ice asteroid`), so a trait name beside it reads correctly for any kind.

`data/traits.ts` imports nothing (data stays a leaf).

`TUNING` (`src/data/tuning.ts`) gains a `// Rock traits (#48).` block:

```ts
/** Chance a freshly spawned belt rock rolls a trait. */
traitChance: 0.22,
/** Volatile: blast radius past the rock's own radius, and damage at radius 40. */
volatileBlastPad: 120,
volatileBlastDamage: 40,
volatileYieldMul: 1.5,
/** Dense: the laser tier that can cut it, and its yield bonus. */
denseMinLaserTier: 2,
denseYieldMul: 1.6,
/** Magnetic: range it notices ships, its acceleration and its speed cap. */
magnetTraitRange: 300,
magnetTraitAccel: 10,
magnetTraitMaxSpeed: 24,
magnetTraitYieldMul: 1.3,
```

### 2. State and rolling

- `Rock` gains `trait?: RockTrait` (doc comment: "One seeded behaviour trait;
  absent on plain rocks, fragments and comets"). It is plain JSON and is
  persisted with `run.rocks`.
- `src/sim/traits.ts` (new, pure) exports:

  ```ts
  /** Seeded trait for a belt rock, or null. Pure hash: never draws from an Rng. */
  export function rollTrait(seed: number, number: number, id: number): RockTrait | null;

  /** The trait's yield multiplier (1 for a plain rock). */
  export function traitYield(trait: RockTrait | undefined): number;

  /** False when the ship's best laser is too weak to cut a `dense` rock. */
  export function canMine(stats: ShipStats, rock: Rock): boolean;

  /** Distance a ship must keep from a volatile rock to avoid its blast. */
  export function volatileSafeDistance(rock: Rock): number;
  ```

  `rollTrait` is a **stateless hash**, so it needs no saved RNG and cannot shift
  `run.rng`:

  ```ts
  const h = hash01((seed ^ (number * 0x9e3779b1) ^ (id * 0x85ebca6b)) | 0);
  if (h >= TUNING.traitChance) return null;
  return TRAIT_IDS[Math.floor((h / TUNING.traitChance) * TRAIT_IDS.length)]!;
  ```

  (`hash01` is `core/rng.ts`'s stateless hash, already used for cosmetic
  per-id variation.)

- `spawnBeltRock` rolls the trait with the run's own `(seed, system number, rock
  id)`: it is handed `rollTrait(seed, run.system.number, run.nextId)` before
  `makeRock` increments the counter. `Run` does not carry the seed, so the seed
  is **threaded explicitly**: `spawnBeltRock(run, seed, beltIndex, sizeOverride)` and
  `populateBelts(run, seed)`, with `create.newRun` passing
  `profile.seed` and `update.regrowBelts` passing `state.profile.seed`. Those are
  the only two production call sites.
- `makeRock` gains a trailing `trait: RockTrait | null = null` parameter;
  fragments (`destroyRock`) and comets (`hazards.spawnComet`) pass `null` (or
  omit it). The default keeps the many existing `makeRock(...)` test call sites
  unchanged.

### 3. Mechanics

**Volatile — risk + reward.** `destroyRock` (in `sim/mining.ts`), after the
existing `crack` fx, when `rock.trait === 'volatile'`:

- pushes an `explode` fx at the rock's position (the fx already exists for ship
  death; the renderer already draws it);
- for every **alive** ship within `rock.radius + TUNING.volatileBlastPad` of the
  rock, calls `damageShip(state, ship, TUNING.volatileBlastDamage *
  (rock.radius / 40))`.

Flat damage inside the radius, zero outside: no falloff, so it is trivially
testable. The blast damages **ships only**.

**Why it is survivable.** A mining laser's reach is `st.range + rock.radius`
(tier-1 range is 170) and the blast is `rock.radius + 120`, so a ship that mines
from **max range is always outside the blast**, while a ship that flies in close
(manual flight, or an over-eager AI) eats it. The reward is `volatileYieldMul`
(×1.5 units): the frontier is "hold your distance and cash in".

**Dense — hard gate + reward.** A tier-2 laser is required.

- `ShipStatKey` (`data/components.ts`) gains `laserTier`; the `laser` component
  gains `{ stat: 'laserTier', op: 'max', values: [1, 2, 3] }`. `ships.emptyStats`
  gains the key at 0. The op is `max`, so a slot's *best* laser sets the tier and
  two tier-1 lasers give `laserTier: 1` — "requires a T2 laser" is exact.
- `laserRock` becomes `laserRock(state, rock, dmg, laserTier)`: when
  `rock.trait === 'dense' && laserTier < TUNING.denseMinLaserTier` it returns
  `null` without touching `rock.hp`. `pilot.workRock` passes `st.laserTier`.
- The `mine` handler (`sim/handlers.ts`) rejects an order against a dense rock
  the ship cannot cut with `fail(state, 'Dense rock — needs a tier-2 laser.')`,
  so a player gets told why (a command is untrusted input; this is a rejection,
  not a crash). The sim-side gate keeps drones/scripts honest.
- Reward: `denseYieldMul` (×1.6 units). Once you have the gear, dense rocks are
  the best rocks.

**Magnetic — risk + reward.** In the rock loop of `sim/update.ts`, for a
non-comet rock with `trait === 'magnetic'`, find the nearest alive ship within
`TUNING.magnetTraitRange`; add its unit direction × `magnetTraitAccel` × `dt` to
the rock's velocity, then clamp the speed to `magnetTraitMaxSpeed`. Deterministic
(no rng) and allocation-free (reads `run.ships` directly, no temporaries).
`magnetTraitMaxSpeed` (24) sits just under `collisionMinSpeed` (25), so a
magnetic rock cannot, by itself, damage a ship it catches up with; the risk is
encountering it at speed, not a free hit. Reward: `magnetTraitYieldMul` (×1.3
units) and convenience — the rock comes to the ship.

**Yield application.** `makeRock` applies `traitYield(trait)` to the base units
**only when `units` is null** (a freshly spawned belt rock). Fragments pass
explicit conserved units, so a traited parent's bonus flows to its children
exactly once and is never re-multiplied.

### 4. AI: drones and the bot

- **Drones** (`sim/pilot.ts`): every `nearestRock` filter also requires
  `canMine(st, r)`, so an under-tiered drone ignores dense rocks instead of
  orbiting one forever. `workRock` gains a volatile reflex: it holds station at
  `max(reach · 0.8, volatileSafeDistance(rock))`, so AI mining never stands in
  its own blast. Because the safe distance is always inside `reach` for the
  stock laser ranges, this only widens the stand-off — it never makes a rock
  un-minable.
- **Bot** (`scripts/bot.ts`): `pickRock` skips rocks `canMine(stats, r)` rejects.
  Nothing else: volatile safety lives in `workRock`, which the bot drives
  through `mine` orders, so the bot inherits it.

### 5. Display

- **Tooltip** (`ui/Hud.ts`): `showTooltip` composes
  `Large ice asteroid · Volatile (explodes when cut) · 120 units · 100%`. The
  string is built by an exported pure helper `rockTooltip(rock)` so it can be
  unit-tested without a DOM (the testing convention).
- **3D** (`render/rocks.ts`): `InstancePool` gains a second per-instance
  attribute `aTrait` (float) beside `aDamage`; the shared shader patch adds
  `attribute float aTrait; varying float vTrait`, and the fragment branch accents
  the rock: volatile a pulsing hot rim, dense a flat grey sheen, magnetic a
  faint blue rim, plain rocks unchanged. `RockView.update` writes
  `TRAIT_INDEX[rock.trait ?? 'plain']` per rock. The pools, draw-call count and
  cull bounds are unchanged.

### 6. Save migration v6 → v7

`SAVE_VERSION` 6 → 7 in `sim/create.ts`. `migrations[6]` is a documented **no-op**:
v6 rocks have no trait and remain plain; the trait is optional, so the older
shape already satisfies the new one. The version still bumps because the
persisted shape gained a key.

`fromData` (`sim/save.ts`) rejects a save any of whose rocks carries a `trait`
that is not a known `RockTrait` (`Object.hasOwn(TRAITS, t)`), so the sim never
reads an unknown behaviour. A frozen `tests/fixtures/save-v6.json` is committed
with this spec; the v2–v6 fixtures must all still load.

### 7. Bot and balance report

`npm run balance` is regenerated and the delta recorded in the run log: traits
change units per rock (higher yields) and the bot now skips dense rocks until it
owns a tier-2 laser, so early-system times will move. No new report column in the
MVP; if the delta is large the run log says which task to revisit.

## Testing

- **Data:** three traits, every id unique, every colour finite.
- **Rolling:** `rollTrait` is a pure function of `(seed, number, id)` — same
  inputs, same result; over many ids all three traits occur and the null share is
  near `1 − traitChance`; **`generateSystem` + `populateBelts` leave `run.rng.s`
  and every rock's id/kind/pos/radius/hp byte-identical to a frozen pre-change
  expectation** (only `units` and `trait` may differ).
- **Yield:** a traited belt rock's units equal the plain units × the trait's
  multiplier; a fragment's units are the conserved share, not re-multiplied.
- **Dense:** `canMine` is false for a dense rock with `laserTier < 2` and true at
  tier 2; `laserRock` leaves a dense rock's hp untouched below the gate and
  damages it at the gate; the `mine` handler rejects the order with the `warn`
  line and leaves `ship.order` untouched.
- **Volatile:** breaking a volatile rock damages an alive ship inside
  `radius + pad` and not one outside; a dead ship is skipped; the blast pushes an
  `explode` fx and damages no rock; `workRock`'s stand-off for a volatile target
  is at least `volatileSafeDistance`.
- **Magnetic:** a magnetic rock within range gains velocity toward a ship and
  stops at `magnetTraitMaxSpeed`; a plain rock is untouched; a ship beyond range
  exerts no pull.
- **Determinism / isolation:** `sim.test.ts`'s seed-replay determinism still
  passes; `alloc.test.ts` still passes with magnetic rocks present in the run.
- **Save:** the v2–v6 fixtures load as v7 and tick; a v7 save with an unknown
  `rock.trait` is rejected without throwing; a save round-trip preserves traits.
- **Stats:** the `stats.test.ts` snapshot is updated for the new `laserTier`
  key (intended change).
- **Render:** `rockMaterial`'s compiled vertex shader declares `aTrait`; each
  trait writes a distinct `aTrait` value into its pool, plain rocks write 0;
  `RockView` still builds exactly 7 meshes.
- **Bot:** the bot does not target a dense rock until the flagship has
  `laserTier ≥ 2`.

## Risks

- **Balance moves in system 1** (yield bonuses, dense skips). The table makes it
  visible; §7 records it and Task 7 can tune `traitChance` or the multipliers.
- **Volatile feels toothless** if the AI always stands off. Accepted: the risk is
  real for manual flight and for a ship that is already close when a
  fragment-chain finishes; the reward is the larger drop.
- **A `laserTier` stat touches `stats.test.ts`** and every stats consumer. The
  snapshot is updated intentionally and the op is `max`, so no other stat moves.
- **Old saves.** A migrated save's rocks stay plain until the next belt regrows;
  the world gains traits from the next warp's generation.
