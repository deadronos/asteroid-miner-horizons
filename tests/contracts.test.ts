import { describe, expect, it } from 'vitest';
import { CONTRACTS, CONTRACT_KINDS, type ContractKind } from '../src/data/contracts';
import { RESOURCES, RESOURCE_INFO, walletValue } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import {
  contractProgress,
  contractReward,
  describeContract,
  fillBoard,
  newBoard,
  rollContract,
  updateContracts,
} from '../src/sim/contracts';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { flagship } from '../src/sim/ships';
import type { Contract, GameState } from '../src/sim/types';
import { tick } from '../src/sim/update';

const DT = 1 / 60;
const INPUT = { thrust: { x: 0, z: 0 }, commands: [] as Command[] };

/** Puts a hand-built active contract on the board, replacing any existing one. */
function setActive(state: GameState, kind: ContractKind, target: number): Contract {
  const c: Contract = { id: 999, kind, target, progress: 0, timeLimit: 300, timeLeft: 300, reward: {}, data: 0 };
  state.run.contracts.active = c;
  return c;
}

describe('contracts data', () => {
  it('defines a def for every kind, keyed by its own kind', () => {
    for (const kind of CONTRACT_KINDS) {
      expect(CONTRACTS[kind].kind).toBe(kind);
    }
    const keys = Object.keys(CONTRACTS);
    expect(keys).toHaveLength(CONTRACT_KINDS.length);
    for (const key of keys) {
      expect(CONTRACT_KINDS).toContain(key);
    }
  });

  it('gives deliver kinds a resource and breakLarge none', () => {
    for (const kind of CONTRACT_KINDS.filter((k) => k !== 'breakLarge')) {
      expect(CONTRACTS[kind].resource).toBeDefined();
    }
    expect(CONTRACTS.breakLarge.resource).toBeUndefined();
  });

  it('only offers crystal contracts from system 2', () => {
    expect(CONTRACTS.deliverCrystal.minSystem).toBeGreaterThanOrEqual(2);
  });

  it('describes the target in the goal text', () => {
    expect(CONTRACTS.deliverOre.describe(150)).toContain('150');
    expect(CONTRACTS.breakLarge.describe(6)).toBe('Break 6 large asteroids');
  });

  it('has a positive timer, target and reward for every kind', () => {
    for (const kind of CONTRACT_KINDS) {
      const def = CONTRACTS[kind];
      expect(def.timeLimit).toBeGreaterThan(0);
      expect(def.base).toBeGreaterThan(0);
      expect(def.pays.length).toBeGreaterThan(0);
    }
  });
});

describe('contract generation', () => {
  it('rolls identical boards from the same seed and system', () => {
    const a = newBoard(123, 2);
    const b = newBoard(123, 2);
    fillBoard(a, 2);
    fillBoard(b, 2);
    expect(a).toEqual(b);
  });

  it('leaves a new run with a full board of offers', () => {
    expect(newGame(1).run.contracts.offers).toHaveLength(TUNING.contractOffers);
  });

  it('never offers a crystal contract in system 1', () => {
    const board = newBoard(1, 1);
    for (let i = 0; i < 200; i++) expect(rollContract(board, 1).kind).not.toBe('deliverCrystal');
  });

  it('never offers the same kind twice on one board while others are eligible', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const system of [1, 2, 4]) {
        const board = newBoard(seed, system);
        fillBoard(board, system);
        const kinds = board.offers.map((o) => o.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
      }
    }
  });

  it('skips the active contract kind when refilling the board', () => {
    const state = newGame(3);
    const board = state.run.contracts;
    const active = setActive(state, 'deliverIce', 90);
    board.offers = [];
    // System 2 has four kinds, so three offers fit without reusing the active one.
    fillBoard(board, 2);
    expect(board.offers.map((o) => o.kind)).not.toContain(active.kind);
  });

  it('scales targets by the system growth', () => {
    const board = newBoard(2, 3);
    for (let i = 0; i < 50; i++) {
      const c = rollContract(board, 3);
      expect(c.target).toBe(Math.round(CONTRACTS[c.kind].base * TUNING.contractGrowth ** 2));
    }
  });

  it('prices rewards near contractRewardMul of the target value', () => {
    for (const kind of CONTRACT_KINDS) {
      const def = CONTRACTS[kind];
      const unitValue = def.resource === undefined ? TUNING.contractRockValue : RESOURCE_INFO[def.resource].value;
      const want = def.base * unitValue * TUNING.contractRewardMul;
      const { reward, data } = contractReward(kind, def.base);
      // Each pay resource is rounded to whole units, so its value drifts by at most half a unit.
      const drift = def.pays.reduce((s, r) => s + 0.5 * RESOURCE_INFO[r].value, 0);
      expect(walletValue(reward)).toBeGreaterThanOrEqual(want - drift);
      expect(walletValue(reward)).toBeLessThanOrEqual(want + drift);
      expect(data).toBe(def.data);
    }
  });

  it('prices a rolled contract from its scaled target', () => {
    const board = newBoard(2, 3);
    for (let i = 0; i < 50; i++) {
      const c = rollContract(board, 3);
      expect(c.reward).toEqual(contractReward(c.kind, c.target).reward);
      expect(c.data).toBe(contractReward(c.kind, c.target).data);
    }
  });

  it('keeps rocks and the run rng independent of the board', () => {
    const a = newGame(7);
    const b = newGame(7);
    // Re-roll b's board twice as much as the other game; the run must not notice.
    for (let pass = 0; pass < 2; pass++) {
      b.run.contracts.offers = [];
      fillBoard(b.run.contracts, 1);
      for (let i = 0; i < 50; i++) rollContract(b.run.contracts, 1);
    }
    expect(b.run.rocks).toEqual(a.run.rocks);
    expect(b.run.rng).toEqual(a.run.rng);
    expect(b.run.nextId).toBe(a.run.nextId);

    const input = { thrust: { x: 0, z: 0 }, commands: [] as Command[] };
    const ia = new SimIndex();
    const ib = new SimIndex();
    for (let t = 0; t < 5; t += 1 / 60) {
      tick(a, 1 / 60, input, ia);
      tick(b, 1 / 60, input, ib);
    }
    expect(b.run.rocks).toEqual(a.run.rocks);
    expect(b.run.rng).toEqual(a.run.rng);
  });
});

describe('contract progress', () => {
  it('advances a deliver contract only for its own resource', () => {
    const state = newGame(1);
    const c = setActive(state, 'deliverOre', 100);
    contractProgress(state, { t: 'deliver', resource: 'ore', amount: 25 });
    expect(c.progress).toBe(25);
    contractProgress(state, { t: 'deliver', resource: 'ice', amount: 40 });
    contractProgress(state, { t: 'deliver', resource: 'crystal', amount: 5 });
    expect(c.progress).toBe(25);
  });

  it('advances breakLarge for large rocks only', () => {
    const state = newGame(1);
    const c = setActive(state, 'breakLarge', 6);
    contractProgress(state, { t: 'break', size: 0 });
    contractProgress(state, { t: 'break', size: 0 });
    contractProgress(state, { t: 'break', size: 1 });
    contractProgress(state, { t: 'break', size: 2 });
    expect(c.progress).toBe(2);
  });

  it('is a no-op without an active contract', () => {
    const state = newGame(1);
    const before = JSON.stringify(state.run.contracts);
    expect(() => {
      contractProgress(state, { t: 'deliver', resource: 'ore', amount: 10 });
      contractProgress(state, { t: 'break', size: 0 });
    }).not.toThrow();
    expect(state.run.contracts.active).toBeNull();
    expect(JSON.stringify(state.run.contracts)).toBe(before);
  });

  it('ignores events that do not match the active kind', () => {
    const state = newGame(1);
    const c = setActive(state, 'deliverOre', 100);
    contractProgress(state, { t: 'deliver', resource: 'ice', amount: 40 });
    contractProgress(state, { t: 'break', size: 0 });
    contractProgress(state, { t: 'break', size: 1 });
    expect(c.progress).toBe(0);
  });
});

describe('contract payout and timers', () => {
  it('pays the reward exactly once and grants Horizon Data', () => {
    const state = newGame(3);
    const c = setActive(state, 'deliverOre', 10);
    c.progress = 10;
    c.reward = { ice: 40 };
    c.data = 5;
    const bankBefore = { ...state.run.bank };
    const dataBefore = state.profile.data;
    const runValueBefore = state.run.runValue;
    const index = new SimIndex();

    tick(state, DT, INPUT, index);

    expect(state.run.bank.ice).toBeCloseTo(bankBefore.ice + 40, 9);
    expect(state.run.bank.ore).toBeCloseTo(bankBefore.ore, 9);
    expect(state.profile.data).toBe(dataBefore + 5);
    expect(state.profile.dataEarned).toBe(dataBefore + 5);
    expect(state.run.contracts.completed).toBe(1);
    expect(state.run.contracts.active).toBeNull();
    expect(state.run.contracts.rewardValue).toBeCloseTo(walletValue({ ice: 40 }), 9);
    // Contract rewards must never feed the prestige value.
    expect(state.run.runValue).toBe(runValueBefore);

    tick(state, DT, INPUT, index);
    tick(state, DT, INPUT, index);
    expect(state.run.bank.ice).toBeCloseTo(bankBefore.ice + 40, 9);
    expect(state.run.contracts.completed).toBe(1);
    expect(state.run.runValue).toBe(runValueBefore);
  });

  it('pays a multi-resource reward from a real roll into the bank', () => {
    const state = newGame(3);
    const { reward, data } = contractReward('deliverCrystal', 12);
    const c = setActive(state, 'deliverCrystal', 12);
    c.reward = reward;
    c.data = data;
    c.progress = c.target;
    const bankBefore = { ...state.run.bank };
    const runValueBefore = state.run.runValue;

    state.out.log.length = 0;
    updateContracts(state, DT);

    expect(state.out.log.at(-1)).toMatchObject({
      level: 'major',
      event: 'contractDone',
    });
    expect(RESOURCES.filter((r) => (reward[r] ?? 0) > 0)).toHaveLength(2);
    for (const r of RESOURCES) expect(state.run.bank[r]).toBeCloseTo(bankBefore[r] + (reward[r] ?? 0), 9);
    expect(state.run.contracts.rewardValue).toBeCloseTo(walletValue(reward), 9);
    expect(state.run.runValue).toBe(runValueBefore);
  });

  it('fails the active contract when its timer runs out and logs a warning', () => {
    const state = newGame(3);
    const c = setActive(state, 'deliverIce', 100);
    c.timeLeft = 0.5;
    state.out.log.length = 0;

    updateContracts(state, 1);

    expect(state.run.contracts.failed).toBe(1);
    expect(state.run.contracts.active).toBeNull();
    expect(state.out.log.some((l) => l.level === 'warn' && l.text.includes('Contract failed'))).toBe(true);
    const failed = state.out.log.find((l) => l.text.includes('Contract failed'))!;
    expect(failed).toMatchObject({ level: 'warn', event: 'contractFail' });
  });

  it('completes on the tick its timer would expire', () => {
    const state = newGame(3);
    const c = setActive(state, 'deliverOre', 10);
    c.progress = 10;
    c.reward = { ore: 1 };
    c.timeLeft = 0.5;

    updateContracts(state, 1);

    expect(state.run.contracts.completed).toBe(1);
    expect(state.run.contracts.failed).toBe(0);
    expect(state.run.contracts.active).toBeNull();
  });

  it('replaces an offer whose time runs out', () => {
    const state = newGame(3);
    const board = state.run.contracts;
    const expiring = board.offers[0]!;
    const idsBefore = board.offers.map((o) => o.id);
    expiring.timeLeft = 0.001;

    updateContracts(state, 0.01);

    const idsAfter = board.offers.map((o) => o.id);
    expect(board.offers).toHaveLength(TUNING.contractOffers);
    expect(idsAfter).not.toContain(expiring.id);
    for (const id of idsBefore.filter((oid) => oid !== expiring.id)) expect(idsAfter).toContain(id);
    expect(idsAfter.some((id) => !idsBefore.includes(id))).toBe(true);
  });

  it('describes a contract from its kind and target', () => {
    const state = newGame(1);
    const c = setActive(state, 'breakLarge', 6);
    expect(describeContract(c)).toBe(CONTRACTS.breakLarge.describe(6));
  });
});

describe('contracts in the tick', () => {
  it('counts cargo unloaded at the station toward the active contract', () => {
    const state = newGame(7);
    const ship = flagship(state.run);
    ship.pos = { ...state.run.system.station.pos };
    ship.cargo.ore = 30;
    const c = setActive(state, 'deliverOre', 1000);

    tick(state, DT, INPUT, new SimIndex());

    expect(c.progress).toBe(30);
    expect(ship.cargo.ore).toBe(0);
  });
});
