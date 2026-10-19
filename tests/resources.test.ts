import { describe, expect, it } from 'vitest';
import { credit, emptyWallet, formatWallet } from '../src/data/resources';

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

describe('formatWallet', () => {
  it('lists entries at or above the default 0.5 threshold, rounded down, in RESOURCES order', () => {
    expect(formatWallet({ ore: 3.9, ice: 0.5, crystal: 0.49 })).toBe('3⬢ 0❄');
  });

  it('returns an empty string when nothing meets the threshold', () => {
    expect(formatWallet({ ore: 0.4 })).toBe('');
  });

  it('honours min, sep, iconFirst and empty', () => {
    expect(formatWallet({ ore: 2.9, ice: 1.2 }, { min: 1, sep: '  ', iconFirst: true })).toBe('⬢ 2  ❄ 1');
    expect(formatWallet({}, { empty: 'Hold empty' })).toBe('Hold empty');
  });

  it('does not emit NaN for a missing entry when min is 0', () => {
    expect(formatWallet({}, { min: 0 })).toBe('0⬢ 0❄ 0◆ 0▣ 0◉');
  });
});
