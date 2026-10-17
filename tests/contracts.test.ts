import { describe, expect, it } from 'vitest';
import { CONTRACTS, CONTRACT_KINDS } from '../src/data/contracts';
import { RESOURCE_INFO, walletValue } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import { contractReward, fillBoard, newBoard, rollContract } from '../src/sim/contracts';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { tick } from '../src/sim/update';

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
