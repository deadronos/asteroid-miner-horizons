import { describe, expect, it } from 'vitest';
import { credit, emptyWallet } from '../src/data/resources';

describe('credit', () => {
  it('adds every cost entry to the wallet', () => {
    const w = emptyWallet();
    credit(w, { ore: 3, crystal: 1.5 });
    expect(w).toEqual({ ore: 3, ice: 0, crystal: 1.5, alloy: 0, fuel: 0 });
  });

  it('leaves the wallet unchanged for an empty cost', () => {
    const w = { ore: 1, ice: 2, crystal: 3, alloy: 4, fuel: 5 };
    credit(w, {});
    expect(w).toEqual({ ore: 1, ice: 2, crystal: 3, alloy: 4, fuel: 5 });
  });

  it('adds onto existing balances without skipping or clamping', () => {
    const w = { ore: 5, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    credit(w, { ore: 3, ice: 0 });
    expect(w).toEqual({ ore: 8, ice: 0, crystal: 0, alloy: 0, fuel: 0 });
  });
});
