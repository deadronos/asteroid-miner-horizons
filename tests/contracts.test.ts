import { describe, expect, it } from 'vitest';
import { CONTRACTS, CONTRACT_KINDS } from '../src/data/contracts';

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
