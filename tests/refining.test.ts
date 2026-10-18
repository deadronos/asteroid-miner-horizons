import { describe, expect, it } from 'vitest';
import { RECIPES, RECIPE_IDS } from '../src/data/refining';
import { emptyWallet, RAW_RESOURCES, RESOURCE_INFO, RESOURCES, walletValue } from '../src/data/resources';
import { newGame } from '../src/sim/create';
import { newRefinery } from '../src/sim/refining';

describe('refined resources', () => {
  it('lists all five kinds raw-first', () => {
    expect(RESOURCES).toEqual(['ore', 'ice', 'crystal', 'alloy', 'fuel']);
    expect(RAW_RESOURCES).not.toContain('alloy');
    expect(RAW_RESOURCES).not.toContain('fuel');
  });

  it('emptyWallet has five zero keys', () => {
    const w = emptyWallet();
    expect(Object.keys(w)).toHaveLength(5);
    for (const r of RESOURCES) expect(w[r]).toBe(0);
  });

  it('a recipe produces exactly the value it consumes', () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      expect(walletValue(r.input) / r.output).toBeCloseTo(RESOURCE_INFO[id].value, 9);
      expect(r.time).toBeGreaterThan(0);
      expect(r.output).toBeGreaterThan(0);
    }
  });
});

describe('new run refinery', () => {
  it('starts empty with zero output and no refined bank', () => {
    const { run } = newGame(1);
    expect(run.refinery).toEqual(newRefinery());
    expect(run.refinery.queue).toEqual([]);
    expect(run.refinery.produced).toEqual({ alloy: 0, fuel: 0 });
    expect(run.bank.alloy).toBe(0);
    expect(run.bank.fuel).toBe(0);
  });

  it('never generates a refined rock kind', () => {
    const { run } = newGame(1);
    expect(run.rocks.length).toBeGreaterThan(0);
    expect(run.rocks.every((r) => RAW_RESOURCES.includes(r.kind))).toBe(true);
  });
});
