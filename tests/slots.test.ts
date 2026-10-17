import { beforeEach, describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { activeSlot, clearSlot, migrateLegacy, readSlot, serialize, setActiveSlot, writeSlot } from '../src/sim/save';

// Minimal in-memory localStorage for the node test environment.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
});

describe('save slots', () => {
  it('writes, reads and clears independent slots', () => {
    const a = newGame(1);
    const b = newGame(2);
    writeSlot(0, a);
    writeSlot(2, b);
    expect(serialize(readSlot(0)!.state)).toEqual(serialize(a));
    expect(readSlot(1)).toBeNull();
    expect(readSlot(2)!.state.profile.seed).toBe(2);
    clearSlot(2);
    expect(readSlot(2)).toBeNull();
  });

  it('remembers the active slot and guards bad values', () => {
    expect(activeSlot()).toBe(0);
    setActiveSlot(2);
    expect(activeSlot()).toBe(2);
    localStorage.setItem('asteroid-miner-horizons/active-slot', '9');
    expect(activeSlot()).toBe(0);
  });

  it('migrates the old single save into slot 0', () => {
    const g = newGame(5);
    localStorage.setItem('asteroid-miner-horizons/save', serialize(g));
    migrateLegacy();
    expect(readSlot(0)!.state.profile.seed).toBe(5);
    expect(localStorage.getItem('asteroid-miner-horizons/save')).toBeNull();
  });
});
