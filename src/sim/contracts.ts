// Station contract generation. Rolls draws from the board's own RNG stream so
// contract offers never shift the run's rock/pickup random sequence.

import { makeRng, pick } from '../core/rng';
import { CONTRACTS, CONTRACT_KINDS, type ContractKind } from '../data/contracts';
import { RESOURCE_INFO, type Cost } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Contract, ContractBoard } from './types';

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

/** Roll one offer for `system`, consuming only `board.rng` and `board.nextId`. */
export function rollContract(board: ContractBoard, system: number): Contract {
  const eligible = CONTRACT_KINDS.filter((k) => CONTRACTS[k].minSystem <= system);
  const kind = pick(board.rng, eligible);
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
