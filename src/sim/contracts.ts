// Station contracts: seeded offer generation, progress tracking and timers.
// Rolls draw from the board's own RNG stream so contract offers never shift the
// run's rock/pickup random sequence.

import { makeRng, pick } from '../core/rng';
import { CONTRACTS, CONTRACT_KINDS, type ContractKind } from '../data/contracts';
import { credit, formatCost, RESOURCE_INFO, walletValue, type Cost, type Resource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Contract, ContractBoard, GameState, RockSize } from './types';

/** Fresh board with an RNG stream derived from the run seed and system number. */
export function newBoard(seed: number, system: number): ContractBoard {
  return {
    rng: makeRng((seed ^ 0x5bd1e995) + system * 104729),
    nextId: 1,
    offers: [],
    active: null,
    completed: 0,
    failed: 0,
    rewardValue: 0,
  };
}

/** Reward for completing `target` units of `kind`, split evenly by value over its pay resources. */
export function contractReward(kind: ContractKind, target: number): { reward: Cost; data: number } {
  const def = CONTRACTS[kind];
  const unitValue = def.resource === undefined ? TUNING.contractRockValue : RESOURCE_INFO[def.resource].value;
  const share = (target * unitValue * TUNING.contractRewardMul) / def.pays.length;
  const reward: Cost = {};
  for (const r of def.pays) reward[r] = Math.round(share / RESOURCE_INFO[r].value);
  return { reward, data: def.data };
}

/**
 * Roll one offer for `system`, consuming only `board.rng` and `board.nextId`.
 * Kinds already offered or active are skipped while any other kind is eligible.
 */
export function rollContract(board: ContractBoard, system: number): Contract {
  const eligible = CONTRACT_KINDS.filter((k) => CONTRACTS[k].minSystem <= system);
  const taken = new Set(board.offers.map((o) => o.kind));
  if (board.active) taken.add(board.active.kind);
  const fresh = eligible.filter((k) => !taken.has(k));
  const kind = pick(board.rng, fresh.length > 0 ? fresh : eligible);
  const def = CONTRACTS[kind];
  const target = Math.round(def.base * TUNING.contractGrowth ** (system - 1));
  const { reward, data } = contractReward(kind, target);
  return {
    id: board.nextId++,
    kind,
    target,
    progress: 0,
    timeLimit: def.timeLimit,
    timeLeft: TUNING.contractOfferTtl,
    reward,
    data,
  };
}

/** Top the board up to the target number of offers. */
export function fillBoard(board: ContractBoard, system: number): void {
  while (board.offers.length < TUNING.contractOffers) board.offers.push(rollContract(board, system));
}

/** A finished action the sim reports so a matching active contract can count it. */
export type ContractEvent = { t: 'deliver'; resource: Resource; amount: number } | { t: 'break'; size: RockSize };

/**
 * Adds one sim event to the active contract's progress when it matches. Payout
 * is not done here: `updateContracts` checks completion in one place.
 */
export function contractProgress(state: GameState, ev: ContractEvent): void {
  const c = state.run.contracts.active;
  if (!c) return;
  if (ev.t === 'deliver') {
    if (CONTRACTS[c.kind].resource !== ev.resource) return;
    c.progress += ev.amount;
  } else if (ev.size === 0 && c.kind === 'breakLarge') {
    c.progress += 1;
  }
}

/** Ages offers and the active contract, completing or failing it. Called once per tick. */
export function updateContracts(state: GameState, dt: number): void {
  const { run, profile } = state;
  const board = run.contracts;
  let expired = false;
  for (const o of board.offers) {
    o.timeLeft -= dt;
    if (o.timeLeft <= 0) expired = true;
  }
  if (expired) board.offers = board.offers.filter((o) => o.timeLeft > 0);
  fillBoard(board, run.system.number);

  const c = board.active;
  if (!c) return;

  // Completion is checked before the timer so a last-tick delivery still counts.
  if (c.progress >= c.target) {
    credit(run.bank, c.reward);
    profile.data += c.data;
    profile.dataEarned += c.data;
    board.completed++;
    profile.stats.contracts += 1;
    board.rewardValue += walletValue(c.reward);
    const hd = c.data > 0 ? ` +${c.data} HD` : '';
    state.out.log.push({
      level: 'major',
      text: `Contract complete: ${describeContract(c)}. +${formatCost(c.reward)}${hd}`,
    });
    board.active = null;
    return;
  }

  c.timeLeft -= dt;
  if (c.timeLeft <= 0) {
    board.failed++;
    state.out.log.push({ level: 'warn', text: `Contract failed: ${describeContract(c)}.` });
    board.active = null;
  }
}

/** Player-facing goal text for a contract. */
export function describeContract(c: Contract): string {
  return CONTRACTS[c.kind].describe(c.target);
}

/** Formats a countdown as `m:ss`, rounding seconds up and clamping at zero. */
export function formatTimeLeft(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
