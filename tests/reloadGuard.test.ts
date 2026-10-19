import { afterEach, describe, expect, it } from 'vitest';
import { safeStorage } from '../src/sim/save';
import { decideReload, LOSS_WINDOW_MS, MAX_RELOADS, parseLosses, recordLoss } from '../src/reloadGuard';
import { memStorage } from './memStorage';

const W = LOSS_WINDOW_MS;

describe('decideReload', () => {
  it('reloads on the first loss', () => {
    expect(decideReload([], 1_000).reload).toBe(true);
  });

  it('reloads on the second loss within the window', () => {
    expect(decideReload([1_000], 2_000).reload).toBe(true);
  });

  it('does not reload on the third loss within the window', () => {
    expect(decideReload([1_000, 2_000], 3_000).reload).toBe(false);
  });

  it('drops a loss exactly at the window edge', () => {
    const now = 1_000 + W;
    expect(decideReload([1_000], now).losses).toEqual([now]);
    expect(decideReload([1_000], now).reload).toBe(true);
    // 1_000 is dropped at the edge, so only one loss counts and a reload is still allowed.
    expect(decideReload([1_000, 1_001], now).reload).toBe(true);
    expect(decideReload([1_000, 1_001], now).losses).toEqual([1_001, now]);
    expect(decideReload([1_001, 1_002], now).reload).toBe(false);
  });

  it('drops losses older than the window and reloads again', () => {
    const d = decideReload([0, 1_000], 1_000 + W + 500);
    expect(d.reload).toBe(true);
    expect(d.losses).toEqual([1_000 + W + 500]);
  });

  it('ignores future timestamps', () => {
    const d = decideReload([5_000, 6_000], 1_000);
    expect(d.reload).toBe(true);
    expect(d.losses).toEqual([1_000]);
  });

  it('ends the list with now and stays bounded across many losses', () => {
    let losses: number[] = [];
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += 10;
      const d = decideReload(losses, now);
      expect(d.losses.at(-1)).toBe(now);
      expect(d.losses.length).toBeLessThanOrEqual(MAX_RELOADS + 1);
      losses = d.losses;
    }
    expect(decideReload(losses, now + 10).reload).toBe(false);
  });

  it('keeps the counter working for a stored list read back through parseLosses', () => {
    let stored: string | null = null;
    const reloads: boolean[] = [];
    for (const now of [1_000, 2_000, 3_000, 3_000 + W + 1]) {
      const d = decideReload(parseLosses(stored), now);
      reloads.push(d.reload);
      stored = JSON.stringify(d.losses);
    }
    expect(reloads).toEqual([true, true, false, true]);
  });
});

describe('parseLosses', () => {
  it('returns [] for null and the empty string', () => {
    expect(parseLosses(null)).toEqual([]);
    expect(parseLosses('')).toEqual([]);
  });

  it('returns [] for bad JSON', () => {
    expect(parseLosses('[1, 2')).toEqual([]);
    expect(parseLosses('not json')).toEqual([]);
  });

  it('returns [] for a non-array JSON value', () => {
    expect(parseLosses('{"a": 1}')).toEqual([]);
    expect(parseLosses('42')).toEqual([]);
    expect(parseLosses('"1000"')).toEqual([]);
    expect(parseLosses('null')).toEqual([]);
  });

  it('drops non-number entries and keeps finite numbers', () => {
    expect(parseLosses('[1000, null, "2000", {}, true, 3000]')).toEqual([1000, 3000]);
  });

  it('keeps a valid array', () => {
    expect(parseLosses('[1000, 2500.5]')).toEqual([1000, 2500.5]);
  });
});

describe('recordLoss', () => {
  const brokenGet = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
  };
  const brokenSet = {
    getItem: () => null,
    setItem: () => {
      throw new Error('full');
    },
  };

  it('allows the reload when there is no store', () => {
    expect(recordLoss(null, 1_000)).toBe(true);
  });

  it('allows the reload when reading the store throws', () => {
    expect(recordLoss(brokenGet, 1_000)).toBe(true);
  });

  it('still returns the decision when writing the store throws', () => {
    expect(recordLoss(brokenSet, 1_000)).toBe(true);
    expect(recordLoss(brokenSet, 2_000)).toBe(true);
    const third = { getItem: () => JSON.stringify([1_000, 2_000]), setItem: brokenSet.setItem };
    expect(recordLoss(third, 3_000)).toBe(false);
  });

  it('gives true, true, false over a round trip through a store', () => {
    const store = memStorage();
    expect([recordLoss(store, 1_000), recordLoss(store, 2_000), recordLoss(store, 3_000)]).toEqual([true, true, false]);
  });
});

describe('safeStorage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('defaults to localStorage when sessionStorage is also defined', () => {
    const local = memStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memStorage() });
    expect(safeStorage()).toBe(local);
  });

  it('returns null when sessionStorage is undefined', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: undefined });
    expect(safeStorage('sessionStorage')).toBeNull();
  });

  it('returns null when the sessionStorage getter throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(safeStorage('sessionStorage')).toBeNull();
  });

  it('returns the store when it is available', () => {
    const store = { getItem: () => null } as unknown as Storage;
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: store });
    expect(safeStorage('sessionStorage')).toBe(store);
  });
});
