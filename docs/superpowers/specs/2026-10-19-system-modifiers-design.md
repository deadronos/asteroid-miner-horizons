# System modifiers and warp pacing

- **Date:** 2026-10-19
- **Issues:** #47 — "System modifiers for warp variety"; #44 — "Rebalance warp cost vs income growth"
- **Status:** Approved design (MVP scope)

## Context / problem

**#47.** Systems differ only slightly: star class (heat radius), a richness
roll (0.85–1.35 × rock count and units) and the crystal share. Every warp
plays the same. The issue proposes seeded modifiers shown in the HUD: dense
belt, metal-rich, ice-poor, binary star (two heat zones), nebula (smaller
sensor radius, faster regrow) and comet showers.

Acceptance criteria:

1. 1–2 modifiers per system after system 2.
2. Shown in the top bar and on warp.

**#44.** The warp costs `50 fuel × 1.35^warps × (1 − 0.08 × warp perk)`, and
Horizon Data is `⌊√(runValue / 60)⌋`. The issue expects income to fall behind
the ×1.35 cost and a wall to appear "around warp 5–7".

Acceptance criterion: the bot shows no warp taking more than 2× the previous
one, up to warp 10.

### What the bot measures today (`efc16f2`, before this work)

Set A = `--seeds 20` (1000–1019), set B = `--seed-start 2000 --seeds 10`.
"Median ratio" is the ratio of consecutive median times; "> 2×" counts
seeds whose warp took more than twice their previous warp.

| System | A median | A median ratio | A > 2× | B median | B median ratio | B > 2× |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8:25 | — | — | 9:25 | — | — |
| 2 | 9:01 | 1.07 | 1 | 7:50 | 0.83 | 1 |
| 3 | 8:26 | 0.93 | 1 | 7:37 | 0.97 | 0 |
| 4 | 10:22 | 1.23 | 1 | 11:33 | 1.51 | 1 |
| 5 | 13:03 | 1.26 | 0 | 13:23 | 1.16 | 2 |
| 6 | 15:48 | 1.21 | 2 | 15:08 | 1.13 | 1 |
| 7 | 13:09 | 0.83 | 0 | 14:19 | 0.95 | 0 |
| 8 | 16:07 | 1.23 | 0 | 15:25 | 1.08 | 0 |
| 9 | 16:13 | 1.01 | 0 | 16:59 | 1.10 | 0 |
| 10 | 20:51 | 1.29 | 1 | 21:36 | 1.27 | 0 |

- **No wall up to warp 10**, on either set. Median time grows about ×1.14
  per warp from system 3 to 10 (A 1.138, B 1.160): already gentle.
- **The wall is just past the window.** Set A with `--warps 16`: medians
  28:02 (sys 11, ×1.34), 38:12 (sys 12, ×1.36), 52:27 (sys 13), and the
  60-minute cap is hit by 5 of 20 seeds at warp 13 and by most seeds after.
- **Cause.** Value/min grows about ×1.2 per warp up to system 8 (116 → 562)
  and then flattens (650, 665, 710, 754, 761 for systems 9–13): drone cap,
  tier-3 components and the perk curve saturate. The fuel price keeps growing
  ×1.35 (626 fuel at warp 10, 1392 at warp 13), so time per warp accelerates.
  The refinery adds a hard floor too: fuel takes 0.5 s per unit, so 1392 fuel
  is at least 11.6 minutes of refining.
- **Per-seed spikes.** 11 of 270 seed-warps (A 6/180, B 5/90) take more than
  2× the previous warp. All are noise of the "short warp, then a normal one"
  kind (e.g. seed 1012: 4:14 then 10:06). The ratio of two warps whose times
  each vary by about ±25 % exceeds 2 a few percent of the time no matter how
  the curve is tuned.

**Reading of the #44 criterion.** We evaluate it on the per-warp **median**
(both the ratio of median times and the median of per-seed ratios), which is
what "the bot shows" in `docs/balance.md`'s "vs previous" column. Per-seed
spikes are reported as their own column and must not get worse, but a global
knob cannot make them zero.

## Goals

- **Four seeded system modifiers** (§1), rolled from a dedicated RNG stream:
  none in systems 1 and 2, one or two from system 3 on.
- Modifiers act **only** through generation parameters (belt rock count and
  mix) and per-tick multipliers (pickup radius, belt regrow interval). No new
  entities, no renderer changes.
- Modifiers are **stored on `run.system`** (save v4 → v5).
- **Shown in the top bar** (one chip per modifier, with a tooltip) and **on
  warp** (a log line naming them).
- The balance report shows which modifiers each seed-warp had, how each
  modifier moves time, and the per-seed spike count.
- **#44:** with modifiers in, tune so that time per warp keeps growing gently
  through warp 10 with margin, and the wall moves past warp 12.

## Non-goals

- **Binary star (two heat zones).** Cut from the MVP. A second star needs a
  second heat check in the ship tick, a second star body and glow in
  `SystemView`, a position that avoids the belts, planets and the station lane,
  and bot/drone avoidance (`droneThink` and the bot only know the central
  star). That is a renderer, AI and generation change, not a parameter. It is
  the most expensive item on the list for a variation that mostly reads as
  "more heat damage". Follow-up.
- **Comet showers.** Cut from the MVP. Comets are moving, mineable, dangerous
  bodies, which is exactly the hazard system of #37 (telegraphing, a toggle,
  determinism). Building them here would duplicate or pre-empt #37. Once #37
  lands, "comet showers" becomes a modifier that raises its spawn rate.
- **Visual cues in the 3D scene** (nebula haze, belt tint). The HUD is the
  only display in this MVP. Follow-up.
- **Modifier choice** (picking the next system). Out of scope.
- Changing the HD formula or perk curves unless Task 6 needs it.

## Design

### 1. Modifier data: `src/data/modifiers.ts` (new, pure data)

```ts
export type ModifierId = 'dense' | 'metalRich' | 'icePoor' | 'nebula';

export interface ModifierDef {
  id: ModifierId;
  /** Short display name for the top bar chip and the warp log. */
  name: string;
  /** × every belt's rock count (initial count, and so the regrow target). */
  beltCount?: number;
  /** × belt mix weight per raw kind, applied to every belt. */
  mix?: Partial<Record<RawResource, number>>;
  /** × every ship's pickup (tractor) radius. */
  magnet?: number;
  /** × the belt regrow interval (< 1 regrows faster). */
  regrowInterval?: number;
}

export const MODIFIERS: Record<ModifierId, ModifierDef>;
export const MODIFIER_IDS: readonly ModifierId[];
```

Starting values (Task 6 may tune them):

| Id | Name | Effect | Fields |
| --- | --- | --- | --- |
| `dense` | Dense belt | more rocks in every belt | `beltCount: 1.4` |
| `metalRich` | Metal-rich | ore rocks more common | `mix: { ore: 1.6 }` |
| `icePoor` | Ice-poor | ice rocks rarer | `mix: { ice: 0.55 }` |
| `nebula` | Nebula | smaller pickup radius, faster regrow | `magnet: 0.7, regrowInterval: 0.5` |

`data/modifiers.ts` imports only types from `./resources` (data stays a leaf).

`TUNING` gains a `// System modifiers.` block: `modifierMinSystem: 3` (first
system that rolls modifiers) and `modifierTwoChance: 0.5` (chance of a second
modifier).

### 2. Rolling and effects: `src/sim/modifiers.ts` (new, pure)

- `rollModifiers(seed: number, number: number): ModifierId[]` — returns `[]`
  when `number < TUNING.modifierMinSystem`. Otherwise it uses its **own**
  stream, `makeRng((seed ^ 0x2c1b3c6d) + number * 15485863)`, so the system
  generator's `r` (name, star class, planets, richness, station) and `run.rng`
  (rocks) draw exactly what they drew before. Count = `chance(r,
  modifierTwoChance) ? 2 : 1`; then `pick` from the ids not yet chosen
  (`MODIFIER_IDS` order), so the result has no duplicates.
- `systemEffects(mods: readonly ModifierId[]): SystemEffects` — the product of
  every field over the modifiers, defaulting to 1:
  `{ beltCount, mix: Record<RawResource, number>, magnet, regrowInterval }`.
- `applyBeltModifiers(belts: Belt[], mods): void` — for each belt,
  `initialCount = Math.round(initialCount × beltCount)` and each `mix[k] *=
  mix[k]`. `rollKind` already normalises by the weight total.
- `applySystemStats(st: ShipStats, system: StarSystem): ShipStats` — mutates
  and returns `st` with `magnet *= magnet`. The single place the pickup-radius
  effect is applied.
- `describeModifier(id): string` — the effect text built **from the numbers**,
  so tuning can never leave stale text: parts joined by `, ` in field order:
  `beltCount` → `+40% asteroids`; each mix entry → `+60% ore rocks` /
  `−45% ice rocks`; `magnet` → `−30% pickup radius`; `regrowInterval` →
  `belts regrow 2× faster` (`1 / x`, up to one decimal, no trailing `.0`).
  Percentages are `Math.round(|x − 1| × 100)` with `+` or `−` (U+2212).
- `describeModifiers(mods): string` — `Dense belt (+40% asteroids) · Nebula
  (−30% pickup radius, belts regrow 2× faster)`; `''` for none.

### 3. State: `StarSystem.modifiers`

`StarSystem` gains `modifiers: ModifierId[]` (doc comment: "Seeded per system;
empty in systems 1–2 and in systems loaded from a pre-v5 save"). It is plain
JSON and is persisted with `run.system`. `generateSystem(seed, number)`:

1. builds everything exactly as before (same draws from `r`);
2. `const modifiers = rollModifiers(seed, number)`;
3. `applyBeltModifiers(belts, modifiers)`;
4. returns the system with `modifiers`.

**Stored, not derived.** Deriving modifiers from `(seed, number)` on load would
label an old save's current system with modifiers its belts were never
generated with (a "Dense belt" with the normal rock count). Storing them keeps
what the HUD shows equal to what the system is, and the field costs one
migration step.

**Determinism.** Systems 1 and 2 are byte-identical to before. From system 3,
a system's name, planets, star class, richness and station are unchanged; its
rocks change only through the belt counts and mixes the modifiers set (and a
nebula-only system keeps its initial layout). Contract boards are untouched.

### 4. Per-tick effects

- **Pickup radius (nebula).** `SimIndex.rebuild` applies
  `applySystemStats(shipStats(ship, profile), run.system)`, so pickup
  collection (`updatePickups`) and the drone/flagship debris logic, which read
  `index.stats`, see the reduced radius. The ship panel's `MAG` readout uses
  the same helper. `shipStats` itself is unchanged.
- **Regrow (nebula).** `regrowBelts` waits `TUNING.beltRegrowInterval ×
  systemEffects(run.system.modifiers).regrowInterval` seconds between checks.

### 5. Display

- **Top bar.** After the `SYS n · Name · X-class` text, one `span.mod` chip per
  modifier (text = name, `title` = `describeModifier(id)`); nothing when there
  are none. The top bar's structure key becomes `` `${number}|${modifiers.join(',')}` ``
  so that loading a slot with a different modifier set at the same system number
  rebuilds the chips (the #35 lesson about keys).
- **Warp.** The `warp` handler logs, right after the `Warp complete…` line and
  before the contract/refinery warnings, a `major` line
  `` `System modifiers: ${describeModifiers(mods)}.` `` when the new system has
  any. `major` so it is not filtered by the "important only" log setting.

### 6. Save migration v4 → v5

`SAVE_VERSION` 4 → 5. `migrations[4]` sets `d.run.system.modifiers = []`: the
saved system was generated without modifiers, and the next warp rolls them.
`fromData` rejects a run whose `system.modifiers` is not an array of known ids
(`Object.hasOwn(MODIFIERS, id)`), because `systemEffects` indexes `MODIFIERS`
every tick. A frozen v4 fixture (`tests/fixtures/save-v4.json`, the v3 fixture
migrated and ticked once at `efc16f2`) is committed with this spec; the v2, v3
and v4 fixtures must all load.

### 7. Bot and balance report

The bot needs no modifier logic: it reads the bank and the rocks, so a
metal-rich or ice-poor belt changes what it finds, not how it decides. (Task 5
confirms the bot does not stall.)

The report gains:

- a CSV column `mods` (`dense+nebula`, empty for none);
- a per-warp column **`> 2× prev`**: seeds whose warp took more than twice
  their previous warp;
- a `## Modifiers` table: for each modifier, the number of seed-warps that had
  it, and the median (min–max) of **relative time** = `sec / (median sec of
  all seeds at that system number)`. A `none (system ≥ 3)` row is the control.

### 8. #44: warp pacing (Task 6, after modifiers land)

Levers, in the order to try: `warpCostGrowth` (1.35), `warpBaseFuel`, the
modifier magnitudes (they add variance), then — only if needed — the yield perk
(`+10 %` per level), `dataDivisor` or the fuel recipe time. Lowering
`warpCostGrowth` leaves system 1 identical and moves system 2–3 times only
slightly (68 → 63 fuel at 1.25).

Targets (hard bar first; see the plan for the exact checks):

- No walls on set A and set B at `--warps 10`, and none on set A at
  `--warps 12`.
- Every warp 2–10 on both sets: median ratio and median of per-seed ratios
  ≤ 1.6 (the criterion is 2×; 1.6 is the margin). Warps 11–12 on set A: ≤ 1.6.
- Per-seed `> 2×` count over both sets at warps ≤ 10: no more than the
  post-modifier baseline.
- Systems 1–3: median time within ±10 % of the pre-modifier baseline (above),
  and the opening milestones unchanged.
- Aim: median-time growth from system 3 to 10 of ×1.08–×1.22 per warp
  (geometric mean), and every modifier's median relative time within
  0.8–1.25.

## Testing

- Data: four modifiers; every multiplier is positive and finite.
- Rolling: systems 1–2 roll none; systems 3–20 for 200 seeds roll 1–2 distinct
  known ids; both counts and all four ids occur; same `(seed, number)` → same
  result; `generateSystem` name, star class, planets, richness and station for
  fixed seeds equal values hard-coded from before the change; system 1–2 belts
  are unchanged.
- Effects: `systemEffects([])` is all ones; products for two modifiers;
  `applyBeltModifiers` scales counts and mix; `describeModifier` text for each
  starting value, and a changed number changes the text.
- Per tick: a nebula system's index stats have `magnet × 0.7` and a pickup at
  `0.8 ×` the base radius is not pulled; regrow happens at half the interval.
- Warp: the log line follows `Warp complete` for a system with modifiers and is
  absent when there are none.
- Migration: v2, v3 and v4 fixtures load as v5 with `modifiers: []` and tick; a
  v5 save without `modifiers`, or with an unknown id, is rejected without
  throwing.
- Determinism test still passes.

## Risks

- **Ice-poor slows the warp** (fuel comes from ice). The modifier table makes
  this visible; Task 6 can soften it.
- **More variance means more per-seed spikes.** Same mitigation.
- **Stale HUD after load** (key reuse). The top bar key includes the modifiers.
- **Old saves.** Migrated saves keep an unmodified current system; the next
  warp rolls modifiers.
