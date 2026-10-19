# Component variants: sidegrades, not just tiers

- **Date:** 2026-10-19
- **Issue:** #49 — "Component variants (sidegrades, not just tiers)"
- **Status:** Approved design

## Context / problem

Upgrades are strictly linear tiers: every ship converges on the same fit, because
the only axis is "higher tier = strictly better". The issue proposes per-slot
variants — a wide beam (lower dps, splash) vs a focused beam, a fast engine vs a
high-acceleration engine, a bulk vs a secure cargo pod — so a fit is a choice.

Acceptance criteria:

1. At least 2 variants for laser and engine.
2. UI supports choosing a variant on install.

**Agreed scope.** Laser and engine only, with **real** mechanics: the wide beam
adds a `splash` mechanic (damage to rocks near the target), and the thruster is a
lower-top-speed / higher-acceleration engine. Variants are chosen **at install**
and each keeps its own T1–T3 curve; to change variant you remove the part (half
refund) and reinstall the other — no new command.

### What exists today

- `COMPONENTS` (`data/components.ts`) maps `ComponentId → ComponentDef`, where a
  def owns one `name`, one `describe(tier)`, one `cost(tier)` and one `effects[]`
  list of `{ stat, op, values: [t1, t2, t3] }`.
- `Fitted = { type, tier }` (`sim/types.ts`); `ships.writeShipStats` folds each
  fitted part's `effects` into a `ShipStats`; `economy.investedCost(type, tier)`
  and `upgradeCost(ship, slot)` price refits; `handlers` implement
  `install`/`upgrade`/`remove`/`buyHull`/`scrap` and their refunds.
- Hull loadouts (`data/hulls.ts`) seed a new ship's slots with `{ type, tier }`.
- The refit UI is `ui/panels/ShipPanel.ts`; the bot's refit logic is
  `scripts/bot.ts` (`INSTALL_ORDER`, `UPGRADE_ORDER`).

## Goals

- A `VariantDef` layer under each component: variants are ordered, `[0]` is the
  **default** (today's numbers), so behaviour and prices of existing parts are
  unchanged.
- Laser gains **Focused Beam** (default) and **Wide Beam** (lower dps/range +
  splash); engine gains **Standard Drive** (default) and **Vector Thruster**
  (lower top speed, higher acceleration). Every other type keeps a single
  `standard` variant.
- A new `splash` ship stat and a deterministic splash rule in the mining path.
- The player picks a variant on install; `Fitted` carries it; save v7 → v8 with a
  migration that maps old parts to their default variant.
- The bot keeps using **default** variants, so `npm run balance` isolates the
  refactor rather than mixing in a build change (variants are a player choice).

## Non-goals

- **No in-place variant swap** (remove + reinstall is the way to change).
- **No splash for anything but the Wide Beam**, and no splash visuals.
- **No cargo "secure hold"**, and no second variants for shield/armor/cargo/sensor
  beyond `standard` (the model supports them; the content does not ship).
- **No hull or perk changes.** No new `Command` variant.

## Design

### 1. Data model: `src/data/components.ts`

```ts
export type VariantId = 'focused' | 'wide' | 'ion' | 'thruster' | 'standard';

export interface VariantDef {
  id: VariantId;
  /** Fitted name, e.g. 'Wide Beam'. */
  name: string;
  /** Compact glyph for the HUD, e.g. 'WDE'. */
  short: string;
  describe: (tier: Tier) => string;
  cost: (tier: Tier) => Cost;
  effects: Effect[];
}

export interface ComponentDef {
  id: ComponentId;
  /** Family name, e.g. 'Mining Laser'. */
  name: string;
  /** Ordered variants; `[0]` is the default. */
  variants: readonly VariantDef[];
}

export function defaultVariant(type: ComponentId): VariantId;
export function variantDef(type: ComponentId, variant: VariantId): VariantDef; // falls back to the default
export function isVariant(type: ComponentId, variant: unknown): variant is VariantId;
```

`ShipStatKey` gains `splash` (a radius in world units). `TUNING` gains a
`// Component variants (#49).` block: `splashMul: 0.5`.

Numbers (defaults unchanged from today; new variants below):

| Variant | dps / speed | range / accel | splash | cost multiplier |
| --- | --- | --- | --- | --- |
| laser `focused` | `LASER_DPS` 26/32/55 | `LASER_RANGE` 170/205/250 | — | 1.25 (unchanged) |
| laser `wide` | `WIDE_LASER_DPS` 18/23/38 | `WIDE_LASER_RANGE` 150/180/220 | `SPLASH_RADIUS` 45/60/80 | 1.05 |
| engine `ion` | `ENGINE_SPEED` 30/60/95 | `ENGINE_ACCEL` 90/180/285 | — | 1 (unchanged) |
| engine `thruster` | `THRUSTER_SPEED` 22/45/70 | `THRUSTER_ACCEL` 120/240/380 | — | 0.95 |
| all others `standard` | today's numbers | today's numbers | — | today's multiplier |

`describe` per variant, e.g. wide: `` `${WIDE_LASER_DPS[t-1]} dps · ${WIDE_LASER_RANGE[t-1]} range · ${SPLASH_RADIUS[t-1]} splash` ``.

### 2. Splash mechanic

`st.splash` is 0 unless a Wide Beam is fitted (op `add`, stacked across slots). In
`pilot.workRock`, after the beam damages the target:

```ts
if (st.splash > 0) {
  const dmg = st.dps * dt * TUNING.splashMul;
  ctx.index.rockHash.query(rock.pos, st.splash + 60, (n) => {
    if (n.id === rock.id || !ctx.index.rockById.has(n.id)) return;
    if (dist(n.pos, rock.pos) > st.splash + n.radius) return;
    const nf = laserRock(ctx.state, n, dmg, st.laserTier);
    if (nf) { ctx.index.rockById.delete(n.id); (out ??= []).push(...nf); }
  });
}
```

`workRock` returns the union of the target's and the neighbours' fragments so the
existing chain-target logic still works. The splash path reuses `laserRock`, so a
Wide Beam with only tier-1 lasers still cannot cut `dense` rocks (#48) and the
volatile blast still fires if a splashed volatile breaks. The query radius is
`st.splash + 60` (wider than any rock) with an exact distance test, matching the
collision pattern.

### 3. State and save v7 → v8

`Fitted = { type: ComponentId; variant: VariantId; tier: Tier }`. `SAVE_VERSION`
7 → 8 in `sim/create.ts`. `migrations[7]` sets every fitted slot's
`variant = defaultVariant(f.type)` — old parts become the default variant and
behave unchanged. `fromData` (`sim/save.ts`) validates each ship's slots: `null`,
or an object whose `type` is a known `ComponentId`, whose `variant` is a known
variant of that type (`isVariant`), and whose `tier` is 1/2/3 — so the tick never
reads an unknown pair. A frozen `tests/fixtures/save-v7.json` is committed.

Because `fromData` now validates slots, the migration test's `currentRun()` helper
must add `variant: defaultVariant(type)` to the slots it builds; existing fixtures
load through `migrations[7]` and are unaffected.

### 4. Commands, economy, UI, bot

- **Command.** `install` gains `variant: VariantId`:
  `{ t: 'install'; shipId: number; slot: number; comp: ComponentId; variant: VariantId }`.
  The handler rejects `!isVariant(cmd.comp, cmd.variant)` with `fail(state, 'Unknown component variant.')`, then installs
  `{ type: cmd.comp, variant: cmd.variant, tier: 1 }` and pays
  `variantDef(cmd.comp, cmd.variant).cost(1)`. (No new variant of `Command`; the
  union, handler and a rejection test all change.)
- **Economy.** `investedCost(type, variant, tier)` and `upgradeCost(ship, slot)`
  read `variantDef`.
- **Handlers.** `install`/`upgrade`/`remove`/`buyHull`/`scrap` use `variantDef`
  for names and `investedCost(type, variant, tier)` for refunds.
- **Hulls.** `loadout` entries become `{ type, variant, tier }`; prospector and
  drone laser `focused`, engine `ion`, harvester cargo `standard`.
- **UI.** `ShipPanel`: the empty-slot `<select>` lists one option per
  `(component, variant)` — `COMPONENTS[cid].name` when there is one variant, else
  `` `${family.name} — ${v.name}` `` — with `value = `${cid}:${v.id}``; the change
  handler sends `install` with both. A fitted row shows `variantDef(...).name`,
  its `describe(tier)`, the upgrade cost and the remove refund from
  `investedCost(type, variant, tier)`. The panel's structural key includes the
  variant.
- **Bot.** `INSTALL_ORDER` becomes `{ comp, variant }[]` using **default**
  variants (`focused`, `ion`, `standard`), so the balance report is a clean
  regression signal for the refactor. `upgradeCost` is already variant-aware.

## Testing

- **Component table:** every variant has non-empty `effects`; each variant's tier
  costs rise monotonically in value; the **default** variant's T1/T2 prices are
  unchanged from today (the existing price table guards this) and every variant's
  T3 costs alloy.
- **Stats:** the `stats.test.ts` snapshot is extended over
  `(component, variant, tier)`; a Wide Beam's `splash` is `SPLASH_RADIUS[t-1]`
  while a Focused Beam's is 0.
- **Splash:** a tick of Wide-Beam mining damages a neighbour rock within the
  splash radius and not one outside; the target takes its full damage and is not
  double-hit; a splashed break returns fragments that chain; two runs from the
  same seed are identical (determinism).
- **Commands:** `install` with a known variant fits
  `{ type, variant, tier: 1 }`; an unknown variant is rejected with the `warn`
  line and the slot untouched; `upgrade` keeps the variant; `remove` refunds half
  of the variant's invested cost.
- **Save:** the v2–v7 fixtures load as v8 with every fitted slot on its default
  variant; a save with an unknown `(type, variant)` pair, or a slot with a bad
  tier, is rejected without throwing; a v7 save round-trips with its variants.
- **Bot:** installs a variant-carrying part; `npm run balance` is regenerated and
  the delta recorded (expected ≈ neutral, since the bot uses default variants).

## Risks

- **A broad refactor touches every `COMPONENTS` consumer.** Mitigated by keeping
  the default variant byte-identical in numbers and prices, so the existing price
  table and stats snapshot change only by gaining a variant dimension.
- **Splash recursion/ordering.** Splash uses the same `laserRock` path; rocks
  already removed this tick are skipped via `rockById`, and a splashed volatile
  triggers its (ships-only) blast. Bounded, deterministic.
- **Old saves.** `migrations[7]` makes every old part a default variant; the
  version bump keeps `fromData`'s new slot validation from rejecting them.
