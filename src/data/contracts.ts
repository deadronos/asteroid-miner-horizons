// Station contract definitions. Pure data: each kind's eligibility, target,
// timer and reward shape; the sim rolls instances of these from its own RNG.

import { RESOURCE_INFO, type Resource } from './resources';

export type ContractKind = 'deliverOre' | 'deliverIce' | 'deliverCrystal' | 'breakLarge';

export const CONTRACT_KINDS: readonly ContractKind[] = ['deliverOre', 'deliverIce', 'deliverCrystal', 'breakLarge'];

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

/** Goal text for delivering `target` units of one resource. */
const deliver =
  (resource: Resource) =>
  (target: number): string =>
    `Deliver ${target} ${RESOURCE_INFO[resource].icon} ${RESOURCE_INFO[resource].name.toLowerCase()}`;

export const CONTRACTS: Record<ContractKind, ContractDef> = {
  deliverOre: {
    kind: 'deliverOre',
    minSystem: 1,
    resource: 'ore',
    base: 150,
    timeLimit: 300,
    pays: ['ice'],
    data: 0,
    describe: deliver('ore'),
  },
  deliverIce: {
    kind: 'deliverIce',
    minSystem: 1,
    resource: 'ice',
    base: 90,
    timeLimit: 300,
    pays: ['ore'],
    data: 0,
    describe: deliver('ice'),
  },
  deliverCrystal: {
    kind: 'deliverCrystal',
    minSystem: 2,
    resource: 'crystal',
    base: 6,
    timeLimit: 360,
    pays: ['ore', 'ice'],
    data: 1,
    describe: deliver('crystal'),
  },
  breakLarge: {
    kind: 'breakLarge',
    minSystem: 1,
    base: 5,
    timeLimit: 360,
    pays: ['ore', 'ice'],
    data: 0,
    describe: (target) => `Break ${target} large asteroids`,
  },
};
