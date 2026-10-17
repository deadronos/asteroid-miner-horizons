# Station contracts (timed delivery goals)

- **Date:** 2026-10-18
- **Issue:** #35 — "Station contracts (timed delivery goals)"
- **Status:** Approved design (MVP scope)

## Context / problem

Between upgrades the player has no short-term goal: the loop is "mine, dock,
buy the next thing". The issue asks for 2–3 rotating station contracts
("Deliver 200 ice in 5 min", "Break 10 large rocks") that pay bonus
resources or Horizon Data, shown in a HUD panel.

Acceptance criteria from the issue:

1. Contracts are generated from the seeded RNG.
2. Progress is tracked in state and saved.
3. Rewards are balanced via the balance bot.

The groundwork exists: the handler map (#7, `src/sim/handlers.ts`) makes new
commands one entry each, save migrations (#8, `src/sim/migrations.ts`) let
`Run` grow a field without breaking saves, the HUD is per-panel modules (#2,
`src/ui/panels/*`), and the balance bot (#43, `scripts/bot.ts`,
`scripts/balance.ts`) can measure the extra income.

## Goals

- A board of **3 offers** per system, re-rolled as offers time out.
- The player **accepts one contract at a time**; it then runs against a timer.
- Contract kinds (MVP): **deliver N ore**, **deliver N ice**, **deliver N
  crystal** (system 2+, where crystal exists), **break N large rocks**.
- Progress is counted by the sim (deliveries at the station by any ship of the
  fleet; large rocks cracked by anyone) and persisted in the save.
- Completion pays the reward **automatically** in the same tick (resources into
  the station bank, optional Horizon Data into the profile); running out of
  time fails the contract with a log line and no penalty.
- Generation draws from a **dedicated contract RNG stream**, so adding
  contracts does not shift the existing rock/pickup random sequence. With the
  bot ignoring contracts the balance report must be byte-identical (apart from
  new columns) to the pre-contract one.
- Reward sizes tuned with the balance bot so contracts are a **meaningful but
  not dominant** share of income: target a median of **10–20 %** of total
  income (mined value + contract reward value) per system.

## Non-goals

- **Rare parts as rewards.** There is no parts inventory yet; rewards are
  resources and Horizon Data only.
- **A separate "claim" step.** Auto-claim on completion; a claim button would
  be friction with no decision attached.
- **Multiple simultaneous active contracts**, reputation, contract chains.
- **Refined-goods contracts** — they come with #36 (refining).
- Contract income does **not** count toward `run.runValue`, so it never feeds
  the warp's Horizon Data formula twice (HD comes only from the explicit `data`
  reward).

## Design

### 1. Data: `src/data/contracts.ts` (new, pure data)

```ts
export type ContractKind = 'deliverOre' | 'deliverIce' | 'deliverCrystal' | 'breakLarge';
export const CONTRACT_KINDS: readonly ContractKind[];

export interface ContractDef {
  kind: ContractKind;
  /** First system number this contract can be offered in. */
  minSystem: number;
  /** Delivered resource; absent for breakLarge. */
  resource?: Resource;
  /** Target at system 1 (units, or rocks for breakLarge); scaled per system. */
  base: number;
  /** Seconds to complete once accepted. */
  timeLimit: number;
  /** Resource kind(s) the reward is paid in; split evenly by value. */
  pays: readonly Resource[];
  /** Horizon Data paid on completion. */
  data: number;
  /** Player-facing goal text, e.g. `Deliver 150 ⬢ ore`. */
  describe: (target: number) => string;
}
export const CONTRACTS: Record<ContractKind, ContractDef>;
```

Knobs in `TUNING` (`src/data/tuning.ts`): `contractOffers: 3`,
`contractOfferTtl` (seconds an un-accepted offer stays on the board),
`contractGrowth` (per-system target multiplier), `contractRewardMul` (reward
value as a fraction of the target's own value; for breakLarge the "value" of a
large rock is a fixed `contractRockValue`).

Data imports only `./resources` — no `sim/` import (data stays a leaf).

### 2. State: `src/sim/types.ts`

```ts
export interface Contract {
  id: number;           // board-local id (board.nextId), not run.nextId
  kind: ContractKind;
  target: number;
  progress: number;
  /** Seconds to complete once accepted. */
  timeLimit: number;
  /** Offer: seconds left on the board. Active: seconds left to complete. */
  timeLeft: number;
  reward: Cost;
  data: number;
}

export interface ContractBoard {
  /** Dedicated stream: contract rolls never touch run.rng. */
  rng: Rng;
  nextId: number;
  offers: Contract[];
  active: Contract | null;
  completed: number;
  failed: number;
  /** walletValue of all resource rewards paid this run (balance metric). */
  rewardValue: number;
}

export interface Run { /* … */ contracts: ContractBoard; }
```

Everything is plain JSON (no Maps/classes), so it saves as-is.

### 3. Sim: `src/sim/contracts.ts` (new, pure)

- `newBoard(seed: number, system: number): ContractBoard` — `rng =
  makeRng((seed ^ 0x5bd1e995) + system * 104729)`, empty offers.
- `rollContract(board, system): Contract` — picks a kind (uniform over kinds
  with `minSystem <= system`), target `= round(base * contractGrowth^(system-1))`,
  computes reward, `timeLeft = contractOfferTtl`.
- `fillBoard(board, system)` — rolls until `offers.length === contractOffers`.
- `contractReward(def, target)` → `{ reward: Cost; data }`.
- `updateContracts(state, dt)` — called once per tick from `tick()` after
  pickups: ages offers, drops expired ones and refills; ages the active one;
  completes (pays reward, logs `major`, `completed++`, `rewardValue += …`) or
  fails (logs `warn`, `failed++`).
- `contractProgress(state, ev)` with
  `ev = { t: 'deliver'; resource; amount } | { t: 'break'; size }` — adds to the
  active contract when it matches. Completion is checked in `updateContracts`,
  so payout order is deterministic (one place).
- `describeContract(c): string` and `formatTimeLeft(sec): string` — pure text
  helpers for the HUD (testable without a DOM).

Hooks: `unload()` in `update.ts` calls `contractProgress` per resource before
zeroing cargo; `destroyRock()` in `mining.ts` calls it for every destroyed rock
(matching filters on `size === 0`).

`newRun()` creates the board and fills it, so a fresh run starts with 3 offers.

### 4. Commands (handler map)

Two new `Command` variants, two new entries in `handlers`:

- `{ t: 'acceptContract'; contractId: number }` — rejects (warn) when a
  contract is already active or the id isn't on the board; otherwise moves the
  offer to `active`, sets `timeLeft = timeLimit`, `progress = 0`, and refills
  the board.
- `{ t: 'abandonContract' }` — drops the active one (counts as failed, logs
  info); no-op when none.

Accepting does not require docking: the board is a station broadcast.

### 5. Save migration

`SAVE_VERSION` 2 → 3. `migrations[2]` adds
`run.contracts = newBoard(profile.seed, run.system.number)` (empty offers;
the first tick refills). `fromData()` validates `run.contracts` is an object
with an `offers` array. The committed v2 fixture still loads.

### 6. HUD: `src/ui/panels/ContractsPanel.ts`

`createContractsPanel(el, ctx): Panel`, mounted by `Hud` as `#contracts`
(left column, between fleet and log). Shows the active contract (goal,
progress bar, time left, Abandon) and the offers (goal, reward, offer time
left, Accept — disabled with a reason while another contract is active). The
structure key changes with the offer ids + active id so buttons are rebuilt only
when the board changes.

### 7. Bot + balance

- Bot: when no contract is active, accept the first offer it can serve
  (any kind; crystal only if the system has crystal). While a deliver contract
  is active, `pickRock` treats the contract resource as the wanted one; while
  `breakLarge` is active, large rocks score as half distance.
- `scripts/balance.ts` adds per-warp `contractValue` and `contracts`
  (completed) and two columns: **Contract share of income** (
  `contractValue / (value + contractValue)`) and **Contracts done**; the CSV
  gains `contract_value,contracts`.

## Testing

- Generation: same seed + system → identical board; different systems →
  scaled targets; `deliverCrystal` never offered in system 1; `newRun` leaves
  `run.rng` in the same state as before contracts (rocks unchanged).
- Progress/timers: delivery and large-rock breaks advance only the matching
  active contract; completion pays exactly the reward once; expiry fails;
  offers time out and are replaced.
- Commands: accept/abandon happy paths and the warn-and-return guards; handler
  count in `tests/commands.test.ts` becomes 16.
- Migration: v2 fixture loads into v3 with a board; a tick fills it.
- Bot: completes at least one contract in system 1 within 10 min (seed 1000).
- Determinism test still passes.

## Risks

- **RNG stream leakage.** Rolling from `run.rng` would silently re-balance the
  entire game. Mitigated by `board.rng` + a test on `run.rng.s`.
- **Double-counting HD.** Contract resources stay out of `runValue`.
- **HUD crowding.** The left column gets a third panel; check at 820 px and
  small heights in the browser.
