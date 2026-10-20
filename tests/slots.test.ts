import { beforeEach, describe, expect, it } from 'vitest';
import { SAVE_VERSION, newGame } from '../src/sim/create';
import {
  activeSlot,
  clearSlot,
  firstEmptySlot,
  migrateLegacy,
  readSlot,
  safeStorage,
  serialize,
  setActiveSlot,
  slotStatus,
  writeSlot,
} from '../src/sim/save';
import { memStorage } from './memStorage';

const LEGACY = 'asteroid-miner-horizons/save';
const slotKey = (i: number): string => `asteroid-miner-horizons/slot/${i}`;

/** A save record as a newer build would store it. */
function newerSave(): string {
  const st = JSON.parse(serialize(newGame(4))) as { version: number };
  st.version = SAVE_VERSION + 1;
  return JSON.stringify({ format: 'amh-save', savedAt: 1, state: st });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage(), configurable: true });
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
    localStorage.setItem(LEGACY, serialize(g));
    migrateLegacy();
    expect(readSlot(0)!.state.profile.seed).toBe(5);
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it('keeps an unreadable legacy save', () => {
    localStorage.setItem(LEGACY, '{"version":1,"oops');
    migrateLegacy();
    expect(localStorage.getItem(LEGACY)).toBe('{"version":1,"oops');
    expect(slotStatus(0).kind).toBe('empty');
  });

  it('moves the legacy save to the first empty slot when slot 0 is taken, and keeps it when none is free', () => {
    writeSlot(0, newGame(1));
    localStorage.setItem(LEGACY, serialize(newGame(5)));
    migrateLegacy();
    expect(readSlot(0)!.state.profile.seed).toBe(1);
    expect(readSlot(1)!.state.profile.seed).toBe(5);
    expect(localStorage.getItem(LEGACY)).toBeNull();

    writeSlot(2, newGame(3));
    localStorage.setItem(LEGACY, serialize(newGame(6)));
    migrateLegacy();
    expect(localStorage.getItem(LEGACY)).not.toBeNull();
  });

  it('safeStorage returns null when localStorage is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(safeStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('slot status', () => {
  it('tells an empty slot from a save and from text it cannot load', () => {
    writeSlot(0, newGame(1));
    localStorage.setItem(slotKey(1), 'not json at all');
    expect(slotStatus(0)).toMatchObject({ kind: 'ok', record: { state: { profile: { seed: 1 } } } });
    expect(slotStatus(1)).toEqual({ kind: 'unreadable', reason: 'Not valid JSON.', raw: 'not json at all' });
    expect(slotStatus(2)).toEqual({ kind: 'empty' });
    expect(readSlot(1)).toBeNull();
    expect(firstEmptySlot()).toBe(2);
  });

  it('names the version of a save from a newer build', () => {
    const raw = newerSave();
    localStorage.setItem(slotKey(0), raw);
    const st = slotStatus(0);
    expect(st.kind).toBe('unreadable');
    if (st.kind !== 'unreadable') return;
    expect(st.reason).toContain(`newer version (v${SAVE_VERSION + 1})`);
    expect(st.raw).toBe(raw);
  });

  it('reports no empty slot when every slot holds something', () => {
    for (let i = 0; i < 3; i++) localStorage.setItem(slotKey(i), 'x');
    expect(firstEmptySlot()).toBe(-1);
  });
});

describe('writeSlot failures', () => {
  it('returns false instead of throwing when storage is full', () => {
    const store = memStorage();
    store.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    expect(writeSlot(0, newGame(1))).toBe(false);
  });

  it('returns true when the save is written', () => {
    expect(writeSlot(0, newGame(1))).toBe(true);
  });
});
