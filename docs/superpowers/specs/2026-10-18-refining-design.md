# Refining: ore → alloy, ice → fuel

- **Date:** 2026-10-18
- **Issue:** #36 — "Refining: ore→alloy, ice→fuel"
- **Status:** Approved design (MVP scope)

## Context / problem

Raw resources (ore, ice, crystal) are the only currency tier. Every price is
"mine more of X"; nothing turns a stockpile into a decision. The issue asks for
a station refinery that converts raw resources over time, with higher-tier
components and hulls costing **alloy** and warps costing **fuel**.

Acceptance criteria from the issue:

1. The refining queue runs in the sim and persists.
2. The UI shows queue progress.
3. Costs are rebalanced.

The groundwork exists: the handler map (`src/sim/handlers.ts`) makes new
commands one entry each, save migrations (`src/sim/migrations.ts`, currently
v3) let `Run` grow fields, the HUD is per-panel modules (`src/ui/panels/*`),
station contracts (#35, `src/sim/contracts.ts`) are the template for a pure
sim subsystem with its own `update*` call in the tick, and the balance bot
(`scripts/bot.ts`, `scripts/balance.ts`) measures the result.

## Goals

- **Two refined resources, `alloy` and `fuel`, as real `Resource` kinds**, so
  `Cost`, `pay`, `canAfford`, `formatCost`, refunds and the bank all handle
  them with no special cases.
- **A station refinery queue**: the player queues *N batches* of a recipe; the
  inputs are paid from the bank at queue time; the front job runs at a fixed
  rate and drops one output unit into the bank per finished batch. Up to
  `refineQueueMax` jobs; queuing the same recipe as the last job merges into
  it. A job can be cancelled for a full refund of its unfinished batches.
- **Costs move up-tier only**: tier-1 and tier-2 components and the Mining
  Drone keep their prices, so the system-1 opening is unchanged. Tier-3
  components and the Excavator/Harvester hulls move part of their ore into
  alloy. **Warps cost fuel instead of ice.**
- **Value-neutral conversion**: a refined unit is worth exactly its inputs, and
  refining never touches `run.runValue`, so Horizon Data is unaffected.
- A **HUD panel** shows both recipes with queue buttons and the queue with a
  live progress bar; the top bar shows alloy and fuel and prices the warp in
  fuel.
- The balance bot refines what it needs; the report shows refined output.

## Non-goals

- **Refining ship component** (optional in the issue). Mobile refining is a
  separate design (cargo would carry refined goods, unload would need to value
  them) and is not trivial; left out.
- **Refinery upgrades** (speed perk or station tiers). The rate is a `TUNING`
  knob; a "Refinery" perk is a follow-up.
- **Refined-goods contracts** ("refine 30 alloy"). Adding a contract kind
  changes the contract RNG draw sequence and would re-tune #35; follow-up.
- **Refined goods in ship cargo / mined from rocks.** Rocks and pickups stay
  raw-only (typed `RawResource`).
- **Efficiency bonuses** (refining is never better than raw value).

## Design

### 1. Resources: `src/data/resources.ts`

```ts
export type RawResource = 'ore' | 'ice' | 'crystal';
export type RefinedResource = 'alloy' | 'fuel';
export type Resource = RawResource | RefinedResource;
export const RAW_RESOURCES: readonly RawResource[] = ['ore', 'ice', 'crystal'];
export const REFINED_RESOURCES: readonly RefinedResource[] = ['alloy', 'fuel'];
export const RESOURCES: readonly Resource[] = [...RAW_RESOURCES, ...REFINED_RESOURCES];
```

`RESOURCE_INFO` gains:

| Kind | Name | Icon | CSS | `value` |
| --- | --- | --- | --- | --- |
| alloy | Alloy | `▣` | `#c9d3e0` | 4 (= 4 ore) |
| fuel | Fuel | `◉` | `#ff7a4d` | 7.5 (= 5 ice) |

`emptyWallet()` returns all five keys; `walletTotal` sums `RESOURCES` (cargo
never holds refined goods, so cargo math is unchanged). `walletValue`,
`canAfford`, `pay` and `formatCost` already iterate `RESOURCES` and need no
change.

Narrowing to keep the world raw: `Rock.kind`, `Pickup.kind` and `Belt.mix`
(now `Record<RawResource, number>`) use `RawResource`; `generate.ts`
`rollKind` returns `RawResource`. Contract defs keep `resource?: Resource` but
only ever use raw kinds.

### 2. Recipes: `src/data/refining.ts` (new, pure data)

```ts
export type RecipeId = RefinedResource;
export interface RecipeDef {
  id: RecipeId;
  name: string;          // 'Smelt alloy' / 'Crack fuel'
  /** Bank resources consumed per batch. */
  input: Cost;
  /** Units of `id` produced per batch. */
  output: number;
  /** Seconds per batch. */
  time: number;
}
export const RECIPES: Record<RecipeId, RecipeDef>;
export const RECIPE_IDS: readonly RecipeId[];
```

Starting values (tuned in Task 7): **alloy** `{ ore: 4 }` → 1 in 2 s;
**fuel** `{ ice: 5 }` → 1 in 1 s (tuned to 0.5 s in Task 7). `RESOURCE_INFO[r].value` must equal
`walletValue(input) / output` — a test pins this so tuning cannot make refining
create or destroy value.

`TUNING`: `refineQueueMax: 5` (jobs), `refineMaxBatch: 500` (batches per job).

### 3. State: `src/sim/types.ts`

```ts
export interface RefineJob {
  recipe: RecipeId;
  /** Batches still to finish, including the one in progress. */
  count: number;
  /** Seconds into the current batch. */
  progress: number;
}
export interface Refinery {
  queue: RefineJob[];
  /** Units produced this run per recipe (balance metric). */
  produced: Record<RecipeId, number>;
}
export interface Run { /* … */ refinery: Refinery; }
```

Plain JSON. No RNG: refining is fully deterministic and never touches
`run.rng`, so rocks and contract boards are unaffected.

### 4. Sim: `src/sim/refining.ts` (new, pure)

- `newRefinery(): Refinery` — empty queue, `nextId: 1`, `produced` zeros.
  Each queued job gets a stable `id` from `nextId` (added after review, so a
  cancel cannot hit the wrong job when the queue shifts).
- `refineBlock(run, recipe, count)` validates (shared by the sim and the HUD
  buttons) and `queueRefine(run, recipe, count)` validates + mutates; both
  return `{ error }` or the clamped batch count. `maxBatches` feeds the Max button.
  `count = Math.floor(count)`; `< 1` → `'Nothing to refine.'`; clamp to
  `refineMaxBatch`. Merge target = last job if same recipe (merged count also
  clamped — the excess is not queued). Queue full (no merge possible and
  `queue.length >= refineQueueMax`) → `'Refinery queue is full.'`. Cost =
  `input × count`; not affordable → `` `Not enough ${resource} to refine ${count} ${name}.` ``.
  Otherwise `pay`, append/merge.
- `cancelRefine(run, id): RefineJob | null` — removes the job, refunds
  `input × count` (the batch in progress is refunded in full; its progress is
  lost), returns the removed job.
- `updateRefinery(state, dt)` — called once per tick at the end of `tick()`,
  after `updateContracts`. Spends a time budget of `dt` on the front job: while
  budget remains and the queue is non-empty, finish batches
  (`bank[recipe] += output`, `produced[recipe] += output`, `count--`, carry the
  leftover time to the next batch/job); when a job reaches 0 it is shifted and
  an `info` log line says `Refinery: <total> <icon> <name> ready.` (total =
  the job's original batch count × output; store it as `RefineJob.total`).
  Exact arithmetic: one long `dt` gives the same result as many short ones
  (up to float rounding).
- Text helpers for the HUD: `describeRecipe(id)` →
  `4⬢ → 1▣ · 2s`, `jobProgress(job)` → fraction of the current batch.

`RefineJob` therefore also carries `total: number` (original batches, for
the log and the UI's `done/total` label).

### 5. Commands (handler map)

- `{ t: 'refine'; recipe: RecipeId; count: number }` → `queueRefine`; on error
  `fail(state, msg)`; on success log `info`
  `` `Refinery: queued ${count} × ${name}.` ``.
- `{ t: 'cancelRefine'; jobId: number }` → an id that is no longer queued is a
  silent no-op; otherwise `cancelRefine`, log `info` `Refinery: cancelled …, refunded <formatCost>.`

No docking needed: like the contract board, the refinery is station-side and
works on the station bank.

**Warp:** the handler checks `run.bank.fuel` against `warpCost`; a non-empty
queue is left behind with a `warn` log (`Refinery queue left behind: …`),
mirroring the contracts message. Bank inputs paid into the queue are lost with
the bank, as everything else in the run.

### 6. Costs (Task 6, tuned in Task 7)

| Item | Before | After (start values) |
| --- | --- | --- |
| Tier-1 / tier-2 component | unchanged | unchanged |
| Tier-3 component (× mul) | `ore 420, ice 160, crystal 18` | `ore 100, alloy 80, ice 160, crystal 18` |
| Mining Drone | `ore 80, ice 25` | unchanged |
| Harvester | `ore 350, ice 120` | `ore 150, alloy 50, ice 120` |
| Excavator | `ore 900, ice 300` | `ore 300, alloy 150, ice 300` |
| Warp | `250 ice × 1.35^warps × perk` | `50 fuel × 1.35^warps × perk` |

All "after" prices are ore/ice-equivalent to "before" at the starting
recipes; the extra cost is refining time and the decision of when to refine.
`TUNING.warpBaseIce` is replaced by `warpBaseFuel`. Repair stays ore.
Refunds (`halve(investedCost)`) automatically include alloy.

### 7. Horizon Data

Unchanged formula: `floor(sqrt(runValue / dataDivisor))`. `runValue` grows only
when ships unload mined cargo. Refining moves value between bank columns and
never adds to `runValue`, so it can't be farmed for HD, and spending fuel on a
warp does not reduce the HD that warp grants.

### 8. Contracts

Unchanged. Deliveries count raw cargo unloaded at the station; refinery output
is not a delivery. Rewards stay raw (a deliverOre contract paying ice now
indirectly funds fuel). `contractRewardMul` is untouched unless Task 7 needs
it.

### 9. Save migration v3 → v4

`SAVE_VERSION` 3 → 4. `migrations[3]` sets `bank.alloy = bank.fuel = 0`, the
same on every ship's `cargo`, and `run.refinery = newRefinery()`. `fromData`
rejects a run whose `refinery` is not an object with a `queue` array and a
`produced` object. A frozen v3 fixture (`tests/fixtures/save-v3.json`,
generated by the orchestrator from the v2 fixture at commit `2c2b1ee`) is
committed; both v2 and v3 fixtures must load.

### 10. HUD: `src/ui/panels/RefineryPanel.ts`

`createRefineryPanel(el, ctx): Panel`, mounted by `Hud` as `#refinery`
(right column, below the ship panel). Header `Refinery`. One row per recipe:
`describeRecipe`, buttons `+1`, `+10`, `Max` (max = affordable batches capped
at `refineMaxBatch`); disabled with a reason when unaffordable or the queue is
full. Then the queue: each job shows icon + name, `done/total`, a progress bar
on the front job (`jobProgress`), and a `✕` cancel button. Empty queue → dim
"Queue empty." Structure key = seed, system number and the queue's
`recipe:total` list (the lesson from #35: board ids restart per run).

Top bar: `RESOURCES` loop now shows alloy and fuel too (alloy and fuel hidden
while 0 in system 1 with an empty queue, like crystal); the warp button reads
`WARP ▸ <cost>◉` and is disabled on `bank.fuel`.

### 11. Bot + balance

Bot (keeps the old ice-reserve behaviour by counting fuel as ice):

- `R = RECIPES.fuel.input.ice / RECIPES.fuel.output`; `fuelHave = bank.fuel +
  queued fuel`; `iceEq = bank.ice + R × fuelHave`; warp when `bank.fuel >= wc`.
- Purchases allowed when affordable and `iceEq − c.ice >= ICE_RESERVE × R × wc`.
- Refine fuel: if `fuelHave < wc`: when `bank.ice >= R × (wc − fuelHave)`
  queue the rest; otherwise queue `min(wc × ICE_RESERVE − fuelHave, floor(bank.ice / R))`
  when positive (the reserve is untouchable by purchases anyway).
- Refine alloy: for the first upgrade/hull the bot would buy that is blocked
  only by alloy, queue the alloy shortfall (minus alloy already queued) if the
  ore is there on top of the item's own ore cost.
- `pickRock`'s ice-vs-ore preference uses `iceEq / (R × wc)`.

Report: per warp `alloy` and `fuel` produced (from `run.refinery.produced`),
a column `Refined ▣ / ◉`, CSV gains `alloy,fuel`; a `--seed-start` option
(default 1000) so a second, disjoint seed set can be run.

## Testing

- Data: every recipe's output value equals its input value; refined kinds are
  in `RESOURCES` but not `RAW_RESOURCES`; `emptyWallet` has five zero keys.
- Queue: pays on queue; merge with the last same-recipe job; full queue and
  unaffordable rejected without mutation; cancel refunds unfinished batches;
  `updateRefinery` finishes batches at the right times, carries leftover time
  across batches and jobs, one big `dt` ≈ many small; no `run.rng` use.
- Commands: refine/cancelRefine happy paths and guards; handler count 16 → 18;
  warp with fuel, rejection on ice-only bank, queue-left-behind log.
- Migration: v2 and v3 fixtures both load as v4 with zeroed alloy/fuel and an
  empty refinery; a tick runs; a v4 save without `refinery` is rejected.
- Costs: T1/T2 unchanged (snapshot of the cost table), T3 includes alloy,
  ore-equivalence of every moved price at the starting recipes.
- Bot: reaches the first warp from seed 1000 (refining fuel), and builds alloy
  when an alloy item is next.
- Determinism test still passes.

## Risks

- **Hidden `Wallet` literals.** Many tests and code paths build `{ ore, ice,
  crystal }` literals; typecheck finds them. Old saves are fixed by the
  migration; NaN from a missing key would otherwise poison the bank.
- **Opening drift.** The opening milestones depend only on T1/T2/drone costs
  and ice reserve logic; the bot rewrite must keep them within noise.
- **Refining bottleneck at the warp.** Later warps need ~170 fuel; at 1 s per
  batch the last chunk can add over a minute. The bot pre-refines the
  reserve; Task 7 tunes recipe time if time-in-system grows > ~15 %.
- **HUD crowding.** A fourth panel; the right column shrinks the ship panel.
  Checked in the browser at 1280×800, 1280×600 and 800 px wide.
