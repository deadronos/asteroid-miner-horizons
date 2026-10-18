# Station Contracts Implementation Plan

> **For agentic workers:** Each task below is implemented by opencode (`opencode-go/deepseek-v4.1-flash`) in its own session and reviewed by a separate opencode session; Claude orchestrates and commits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP of issue #35: a board of 3 seeded, rotating station contracts per system; the player accepts one at a time; the sim tracks progress, pays rewards on completion and fails on timeout; it is saved, shown in a HUD panel, played by the balance bot and tuned with the balance report.

**Architecture:** Pure data in `src/data/contracts.ts`; plain-JSON state (`Run.contracts: ContractBoard`) in `src/sim/types.ts`; all logic in a new pure `src/sim/contracts.ts` with its own RNG stream; two new handler-map commands; save v2 → v3 migration; a `ContractsPanel` HUD module; bot + balance-report support.

**Tech Stack:** TypeScript, Three.js, Vite, vitest, oxlint/oxfmt

**Spec:** `docs/superpowers/specs/2026-10-18-contracts-design.md`

## Global Constraints

- **`src/core`, `src/data`, `src/sim` stay pure:** no DOM, no three.js, no `Math.random`, no `Date`.
- **`src/data` stays a leaf:** `data/contracts.ts` may import `./resources` only.
- **Determinism / balance isolation:** contract rolls use `run.contracts.rng`, never `run.rng`, and contract ids use `board.nextId`, never `run.nextId`. With the bot ignoring contracts, the existing balance numbers must not move.
- **Contract rewards do not add to `run.runValue`.**
- Match the surrounding style: short header comment per module, `/** */` on exported functions and non-obvious fields, no comment noise. Format: oxfmt (printWidth 120, single quotes, trailing commas).
- Every task ends with `npm run check` passing (format:check, lint, typecheck, tests).
- Do not touch `scratch.md`. No new dependencies.

## Review Focus

1. **`run.rng` consumed by contracts** → rocks/pickups change, balance shifts. Task 2 asserts `run.rng.s` and rocks are identical with/without the board.
2. **Reward paid twice or never** (completion in one place only). Task 4 asserts the bank delta equals the reward exactly once.
3. **Progress counted for non-matching events** (ice counting toward an ore contract, small rocks toward breakLarge). Task 4.
4. **Old saves crash in tick** because `run.contracts` is missing. Task 3.
5. **Accepting while one is active / unknown id mutates state.** Task 5 asserts warn + unchanged state.

## Task 1: Contract data + state types

**Files:** Create `src/data/contracts.ts`; modify `src/data/tuning.ts`, `src/sim/types.ts`; Test: create `tests/contracts.test.ts`.

**Build:**
- `src/data/contracts.ts` exactly per spec §1: `ContractKind`, `CONTRACT_KINDS`, `ContractDef`, `CONTRACTS`. Starting values (to be tuned in Task 7):
  - `deliverOre`: minSystem 1, resource ore, base 150, timeLimit 300, pays `['ice']`, data 0.
  - `deliverIce`: minSystem 1, resource ice, base 90, timeLimit 300, pays `['ore']`, data 0.
  - `deliverCrystal`: minSystem 2, resource crystal, base 12, timeLimit 360, pays `['ore', 'ice']`, data 1.
  - `breakLarge`: minSystem 1, no resource, base 6, timeLimit 300, pays `['ore', 'ice']`, data 0.
  - `describe` e.g. `Deliver 150 ⬢ ore`, `Break 6 large asteroids` (use `RESOURCE_INFO` icon/name).
- `TUNING` additions: `contractOffers: 3`, `contractOfferTtl: 240`, `contractGrowth: 1.3`, `contractRewardMul: 0.5`, `contractRockValue: 25` (approx value of one large rock's units), each with a one-line comment.
- `src/sim/types.ts`: add `Contract` and `ContractBoard` interfaces exactly per spec §2. **Do not** add `Run.contracts` yet (Task 2 does, together with `newRun`, so typecheck stays green).

**Tests (`tests/contracts.test.ts`):** every `CONTRACT_KINDS` entry has a def with matching `kind`; deliver kinds have a `resource`, `breakLarge` has none; `deliverCrystal.minSystem >= 2`; `describe(150)` contains `150`; all `timeLimit > 0`, `base > 0`, `pays.length > 0`.

**Done when:** `npm run check` passes; no `sim/` logic uses the new types yet.

## Task 2: Seeded generation + `Run.contracts`

**Files:** Create `src/sim/contracts.ts`; modify `src/sim/types.ts` (add `contracts: ContractBoard` to `Run`), `src/sim/create.ts` (`newRun` builds + fills the board); Test: extend `tests/contracts.test.ts`.

**Build (spec §3):**
- `newBoard(seed, system): ContractBoard` — `rng: makeRng((seed ^ 0x5bd1e995) + system * 104729)`, `nextId: 1`, empty offers, `active: null`, counters 0.
- `contractReward(kind, target): { reward: Cost; data: number }` — value = `target × RESOURCE_INFO[resource].value` (deliver) or `target × TUNING.contractRockValue` (break), times `TUNING.contractRewardMul`; split evenly by value across `pays`, each amount `Math.round(valueShare / RESOURCE_INFO[r].value)`; `data` from the def.
- `rollContract(board, system): Contract` — kind = `pick(board.rng, eligible)` where eligible = kinds with `minSystem <= system`; `target = Math.round(def.base * TUNING.contractGrowth ** (system - 1))`; `progress 0`, `timeLimit def.timeLimit`, `timeLeft TUNING.contractOfferTtl`; id `board.nextId++`.
- `fillBoard(board, system)` — push rolls until `offers.length >= TUNING.contractOffers`.
- `newRun`: after `populateBelts(run)` and ship creation, set `run.contracts = newBoard(profile.seed, number)` then `fillBoard`. The `Run` literal needs the field, so create the board first and fill it (fill uses only `board.rng`).

**Tests:** same seed+system → deep-equal boards; `newRun` yields 3 offers; system 1 never offers `deliverCrystal` (roll 200 contracts); system 3 targets = `round(base·growth²)`; reward value ≈ `contractRewardMul ×` target value (within rounding); **isolation:** on `newGame(7)`, record `run.rng.s`, clear `run.contracts.offers`, call `fillBoard(run.contracts, 1)` and roll 50 more contracts → `run.rng.s` is unchanged and `run.nextId` is unchanged.

**Done when:** `npm run check` passes and `tests/sim.test.ts` determinism still passes.

## Task 3: Save migration v2 → v3

**Files:** Modify `src/sim/create.ts` (`SAVE_VERSION = 3`), `src/sim/migrations.ts` (`migrations[2]`), `src/sim/save.ts` (`fromData` validation); Test: extend `tests/migrations.test.ts`.

**Build (spec §5):** `migrations[2] = (d) => { d.run.contracts = newBoard(d.profile.seed, d.run.system.number); return d; }` with a comment saying what changed in v3. `fromData` rejects a run whose `contracts` is not an object with an `offers` array. Update the `migrations` doc comment ("Empty until…") to reflect it has entries now. Keep the `tests/fixtures/save-v2.json` fixture as-is (it is the frozen v2 save).

**Tests:** the v2 fixture deserializes to `version 3` with `run.contracts.offers` an empty array and `active === null`; after one `tick` (use `SimIndex`) — **note:** the refill in tick lands in Task 4, so in this task assert only the migrated shape; a v3 save missing `contracts` is rejected by `deserialize`; existing migration tests still pass (adjust any that assumed an empty production table).

**Done when:** `npm run check` passes.

## Task 4: Progress tracking, payout and timers in the tick

**Files:** Modify `src/sim/contracts.ts` (add `updateContracts`, `contractProgress`, `describeContract`, `formatTimeLeft`), `src/sim/update.ts` (`unload` hook + call `updateContracts(state, dt)` at the end of `tick`), `src/sim/mining.ts` (`destroyRock` hook); Test: extend `tests/contracts.test.ts`.

**Build (spec §3):**
- `contractProgress(state, ev)` — `ev: { t: 'deliver'; resource: Resource; amount: number } | { t: 'break'; size: RockSize }`; adds `amount` (deliver, matching resource) or `1` (break, `size === 0`, kind `breakLarge`) to `run.contracts.active.progress`; no-op otherwise.
- `unload()`: before zeroing cargo, for each resource with cargo > 0 call `contractProgress(state, { t: 'deliver', resource, amount })`.
- `destroyRock()`: call `contractProgress(state, { t: 'break', size: rock.size })`.
- `updateContracts(state, dt)`: offers `timeLeft -= dt`, drop those `<= 0`, then `fillBoard`; active: if `progress >= target` → pay `reward` into `run.bank`, `profile.data += data`, `profile.dataEarned += data`, `completed++`, `rewardValue += walletValue(reward)`, log `major` (`Contract complete: <describe>. +<formatCost(reward)>[ +N HD]`), `active = null`; else `timeLeft -= dt`, if `<= 0` → `failed++`, log `warn` (`Contract failed: …`), `active = null`. Completion is checked **before** the time decrement so a last-tick delivery counts.
- `describeContract(c)` → `CONTRACTS[c.kind].describe(c.target)`; `formatTimeLeft(sec)` → `m:ss` (ceil seconds, never negative).

**Tests:** ore delivery advances a `deliverOre` contract and ice does not; a size-0 break advances `breakLarge`, size 1/2 do not; no active contract → no-op; completion adds exactly the reward to the bank once (tick twice more, bank unchanged further) and adds HD when `data > 0`; expiry fails and logs `warn`; an offer whose `timeLeft` runs out is replaced (board stays at 3, new id); `formatTimeLeft(61.2) === '1:02'`, `formatTimeLeft(-3) === '0:00'`; full-tick integration: put a `deliverOre` contract active, place a docked flagship with ore cargo, `tick` once → progress increased. Migration follow-up: the migrated v2 fixture has 3 offers after one tick.

**Done when:** `npm run check` passes and the determinism test still passes.

## Task 5: `acceptContract` / `abandonContract` via the handler map

**Files:** Modify `src/sim/commands.ts` (two `Command` variants), `src/sim/handlers.ts` (two entries; import from `./contracts`); Test: extend `tests/commands.test.ts`.

**Build (spec §4):**
- `{ t: 'acceptContract'; contractId: number }`: `fail` "Finish or abandon the current contract first." when active; `fail` "That contract is no longer offered." when the id isn't in `offers`; else remove from offers, `active = { ...offer, progress: 0, timeLeft: offer.timeLimit }`, `fillBoard`, log `info` `Contract accepted: …`.
- `{ t: 'abandonContract' }`: no-op without active; else `failed++`, `active = null`, log `info` `Contract abandoned: …`.

**Tests:** accept happy path (active set, timer = timeLimit, board back to 3 offers, new ids); accept while active → warn, state unchanged; unknown id → warn, unchanged; abandon clears and increments `failed`; abandon with none is silent; update the exhaustiveness test count `14 → 16`.

**Done when:** `npm run check` passes.

## Task 6: HUD contracts panel

**Files:** Create `src/ui/panels/ContractsPanel.ts`; modify `src/ui/Hud.ts` (mount `#contracts`), `src/style.css`.

**Build (spec §6):** `createContractsPanel(el: HTMLElement, ctx: PanelCtx): Panel` following `FleetPanel.ts`/`TopBar.ts` (the `Panel` + `bind` pattern from `src/ui/dom.ts`). Structure key = `active?.id` + offer ids. Header `Contracts`. Active block: `describeContract`, progress `bar('cargo')` with label `progress/target`, `formatTimeLeft(timeLeft)`, `Abandon` button (`send({ t: 'abandonContract' })`). Each offer row (reuse the `.slot` row look): goal text, `small` with reward `formatCost(reward)` (+ ` +N ✦` when `data`) and `expires m:ss`, `Accept` button (`send({ t: 'acceptContract', contractId })`), disabled via `setDisabled` with reason "Finish or abandon the current contract first" while one is active. CSS: `#contracts { left: 10px; bottom: 210px; width: 250px; max-height: 240px; overflow-y: auto; }` and shrink `#fleet` max-height to `calc(100vh - 530px)` with `min-height: 120px`; in the `@media (max-width: 820px)` block give `#contracts` `width: 200px; bottom: 110px; max-height: 30vh`. No DOM tests (none exist for panels; the text helpers are tested in Task 4).

**Done when:** `npm run check` passes and `npm run build` succeeds. (Visual check is manual, by the orchestrator/user.)

## Task 7: Bot plays contracts + balance report + tuning

**Files:** Modify `scripts/bot.ts`, `scripts/balance.ts`, `src/data/contracts.ts` and/or `src/data/tuning.ts` (tuning only), `docs/balance.md` (regenerated); Test: extend `tests/bot.test.ts`.

**Build (spec §7):**
- Bot: new step right after the perk/warp checks — if `!run.contracts.active` and an offer exists whose kind is serviceable (`deliverCrystal` only if any rock has kind crystal), return `[{ t: 'acceptContract', contractId }]`. In `pickRock`, an active deliver contract overrides `want` with its resource; an active `breakLarge` makes size-0 rocks score at half distance. Update the module header comment.
- Balance: `WarpStats` gains `contractValue`, `contracts`; capture from `s.run.contracts` each `after` tick (like `cur.value`). Two new table columns after "Drone share of income": `Contract share of income` (`contractValue / max(1, value + contractValue)`) and `Contracts done`; CSV gains `contract_value,contracts`.
- Run `npm run balance -- --seeds 10 --warps 5`, tune `contractRewardMul` / bases until the median contract share is 10–20 % in every system and no walls appear; regenerate `docs/balance.md` with exactly that command.

**Tests:** `tests/bot.test.ts`: seed 1000, 600 s in system 1 → `run.contracts.completed >= 1`.

**Done when:** `npm run check` passes, `docs/balance.md` regenerated at the final commit, contract share 10–20 % median per system.
