import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../src/session';
import { newGame } from '../src/sim/create';
import { type SlotLock, type SlotLocker, heartbeatLocker } from '../src/slotLock';
import { applyOffline } from '../src/sim/offline';
import { readSlot, writeSlot } from '../src/sim/save';
import { SettingsStore } from '../src/settings';
import { memStorage } from './memStorage';

vi.mock('../src/sim/offline', async (orig) => {
  const m = await orig<typeof import('../src/sim/offline')>();
  return { ...m, applyOffline: vi.fn<typeof m.applyOffline>(m.applyOffline) };
});

let store: Storage;

beforeEach(() => {
  vi.mocked(applyOffline).mockClear();
  store = memStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

function settings(): SettingsStore {
  const s = new SettingsStore(store);
  s.set({ autosaveSec: 10 });
  return s;
}

/** Locks shared by every "tab" built from it; a slot is held until its lock is released. */
function lockTable(): { tab(): SlotLocker; held: Set<number> } {
  const held = new Set<number>();
  return {
    held,
    tab: () => ({
      acquire(slot): SlotLock | null {
        if (held.has(slot)) return null;
        held.add(slot);
        return { release: () => held.delete(slot) };
      },
    }),
  };
}

function seedSlot(slot: number, seed: number): void {
  writeSlot(slot, newGame(seed));
}

describe('slot lock', () => {
  it('lets the first tab own the slot and autosave', () => {
    const table = lockTable();
    seedSlot(0, 3);
    const s = new GameSession(settings(), {}, table.tab());
    expect(s.readOnly).toBe(false);
    s.state.run.time = 42;
    s.saveNow();
    expect(readSlot(0)!.state.run.time).toBe(42);
  });

  it('opens a second tab on the same slot read-only: no writes, no offline credit', () => {
    const table = lockTable();
    seedSlot(0, 3);
    const first = new GameSession(settings(), {}, table.tab());
    first.state.run.time = 42;
    first.saveNow();
    const raw = store.getItem('asteroid-miner-horizons/slot/0');

    const spy = vi.spyOn(store, 'setItem');
    const second = new GameSession(settings(), {}, table.tab());
    expect(second.readOnly).toBe(true);
    second.state.run.time = 99;
    second.saveNow();
    second.start();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('/slot/0'), expect.anything());
    expect(store.getItem('asteroid-miner-horizons/slot/0')).toBe(raw);
    expect(second.state.out.log.some((e) => e.text.includes('read-only'))).toBe(true);
    second.stop();
  });

  it('refuses to restart or delete the slot while read-only', () => {
    const table = lockTable();
    seedSlot(0, 3);
    const first = new GameSession(settings(), {}, table.tab());
    expect(first.readOnly).toBe(false);
    const second = new GameSession(settings(), {}, table.tab());
    const raw = store.getItem('asteroid-miner-horizons/slot/0');
    second.newGame(0);
    second.remove(0);
    expect(store.getItem('asteroid-miner-horizons/slot/0')).toBe(raw);
  });

  it('releases the lock on a slot switch and takes the new one', () => {
    const table = lockTable();
    seedSlot(0, 3);
    seedSlot(1, 4);
    const s = new GameSession(settings(), {}, table.tab());
    expect([...table.held]).toEqual([0]);
    s.load(1);
    expect([...table.held]).toEqual([1]);
    expect(s.readOnly).toBe(false);
  });

  it('goes read-only when it switches to a slot another tab holds, and writes back when that slot frees', () => {
    const table = lockTable();
    seedSlot(0, 3);
    seedSlot(1, 4);
    const other = new GameSession(settings(), {}, table.tab());
    other.load(1);
    store.setItem('asteroid-miner-horizons/active-slot', '0');
    const mine = new GameSession(settings(), {}, table.tab());
    expect(mine.readOnly).toBe(false);
    const raw = store.getItem('asteroid-miner-horizons/slot/1');
    mine.load(1);
    expect(mine.readOnly).toBe(true);
    expect(store.getItem('asteroid-miner-horizons/slot/1')).toBe(raw);
  });

  it('waits for an async lock before crediting or saving, and notifies the hooks', async () => {
    seedSlot(0, 3);
    let grant!: (l: SlotLock | null) => void;
    const locker: SlotLocker = { acquire: () => new Promise((r) => (grant = r)) };
    const onAccess = vi.fn<(readOnly: boolean) => void>();
    const s = new GameSession(settings(), { onAccess }, locker);
    s.state.run.time = 7;
    s.saveNow();
    expect(readSlot(0)!.state.run.time).not.toBe(7);
    grant({ release() {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.readOnly).toBe(false);
    s.saveNow();
    expect(readSlot(0)!.state.run.time).toBe(7);
    expect(onAccess).toHaveBeenCalled();
  });

  it('marks the tab read-only when an async lock is denied', async () => {
    seedSlot(0, 3);
    const onAccess = vi.fn<(readOnly: boolean) => void>();
    const s = new GameSession(settings(), { onAccess }, { acquire: () => Promise.resolve(null) });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.readOnly).toBe(true);
    expect(onAccess).toHaveBeenLastCalledWith(true);
  });
});

describe('offline credit', () => {
  it('is applied to the owning tab on load and skipped for a read-only one', () => {
    const table = lockTable();
    writeSlot(0, newGame(3));
    const owner = new GameSession(settings(), {}, table.tab());
    expect(owner.readOnly).toBe(false);
    expect(applyOffline).toHaveBeenCalledTimes(1);
    const second = new GameSession(settings(), {}, table.tab());
    expect(second.readOnly).toBe(true);
    expect(applyOffline).toHaveBeenCalledTimes(1);
  });
});

describe('heartbeat fallback', () => {
  it('grants the first claimant and refuses a second while the beat is fresh', () => {
    let now = 1000;
    const a = heartbeatLocker(store, () => now);
    const b = heartbeatLocker(store, () => now);
    const lock = a.acquire(0, () => {}) as SlotLock;
    expect(lock).not.toBeNull();
    expect(b.acquire(0, () => {})).toBeNull();
    now += 60_000;
    expect(b.acquire(0, () => {})).not.toBeNull(); // the owner stopped beating
    lock.release();
  });

  it('frees the slot on release', () => {
    const a = heartbeatLocker(store, () => 1000);
    const b = heartbeatLocker(store, () => 1000);
    (a.acquire(1, () => {}) as SlotLock).release();
    expect(b.acquire(1, () => {})).not.toBeNull();
  });
});
