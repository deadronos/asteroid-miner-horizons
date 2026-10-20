import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../src/session';
import { SAVE_VERSION, newGame } from '../src/sim/create';
import { readSlot, serialize, slotStatus, writeSlot } from '../src/sim/save';
import type { GameState } from '../src/sim/types';
import { SettingsStore } from '../src/settings';
import { memStorage } from './memStorage';

let store: Storage;

beforeEach(() => {
  store = memStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

/** Settings backed by the same in-memory storage, with a known autosave interval. */
function settings(autosaveSec: 0 | 10 | 30 | 60 = 10): SettingsStore {
  const s = new SettingsStore(store);
  s.set({ autosaveSec });
  return s;
}

/** A game at the given play time, so tests can tell saves apart by value. */
function atTime(state: GameState, time: number): GameState {
  state.run.time = time;
  return state;
}

describe('GameSession bootstrap', () => {
  it('starts the game stored in the remembered active slot', () => {
    writeSlot(1, newGame(7));
    store.setItem('asteroid-miner-horizons/active-slot', '1');
    const s = new GameSession(settings());
    expect(s.active()).toBe(1);
    expect(s.state.profile.seed).toBe(7);
  });

  it('starts a fresh game in slot 0 when nothing is stored', () => {
    const s = new GameSession(settings());
    expect(s.active()).toBe(0);
    expect(s.state.run.time).toBe(0);
    expect(s.state.profile.warps).toBe(0);
  });

  it('migrates the legacy single save on construction', () => {
    store.setItem('asteroid-miner-horizons/save', serialize(newGame(5)));
    const s = new GameSession(settings());
    expect(readSlot(0)!.state.profile.seed).toBe(5);
    expect(s.state.profile.seed).toBe(5);
  });
});

const slotKey = (i: number): string => `asteroid-miner-horizons/slot/${i}`;

/** A save record as a newer build would store it. */
function newerSave(): string {
  const st = JSON.parse(serialize(newGame(4))) as { version: number };
  st.version = SAVE_VERSION + 1;
  return JSON.stringify({ format: 'amh-save', savedAt: 1, state: st });
}

const warned = (s: GameSession, text: string): boolean =>
  s.state.out.log.some((e) => e.level === 'warn' && e.text.includes(text));

describe('GameSession with an unreadable active slot', () => {
  it('starts the new game in the first empty slot and leaves the unreadable one alone', () => {
    const raw = newerSave();
    store.setItem(slotKey(0), raw);
    writeSlot(1, newGame(2));
    const s = new GameSession(settings());
    s.start();
    s.saveNow();

    expect(s.active()).toBe(2);
    expect(s.saving()).toBe(true);
    expect(store.getItem('asteroid-miner-horizons/active-slot')).toBe('2');
    expect(store.getItem(slotKey(0))).toBe(raw);
    expect(readSlot(1)!.state.profile.seed).toBe(2);
    expect(readSlot(2)).not.toBeNull();
    expect(warned(s, `Slot 1 couldn't be loaded: This save is from a newer version (v${SAVE_VERSION + 1})`)).toBe(true);
    s.stop();
  });

  it('runs unsaved when no slot is free, so autosave, unload and save-now never overwrite it', () => {
    vi.useFakeTimers();
    try {
      const win = new EventTarget();
      Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
      Object.defineProperty(globalThis, 'document', { value: new EventTarget(), configurable: true });
      store.setItem(slotKey(0), 'garbage');
      writeSlot(1, newGame(2));
      writeSlot(2, newGame(3));
      const s = new GameSession(settings(10));
      s.start();
      atTime(s.state, 5);

      vi.advanceTimersByTime(20_000);
      win.dispatchEvent(new Event('beforeunload'));
      s.saveNow();
      s.newGame(1); // saving the old game first is skipped too

      expect(store.getItem(slotKey(0))).toBe('garbage');
      s.stop();
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('warns while unsaved, refuses an import over its own slot, and saves there once it is deleted', () => {
    store.setItem(slotKey(0), 'garbage');
    writeSlot(1, newGame(2));
    writeSlot(2, newGame(3));
    const s = new GameSession(settings());
    expect(s.active()).toBe(0);
    expect(s.saving()).toBe(false);
    expect(warned(s, "Not saving: slot 1 holds a save this build can't load. Not valid JSON.")).toBe(true);

    s.importTo(0, { savedAt: 1, state: newGame(9) });
    expect(store.getItem(slotKey(0))).toBe('garbage');

    atTime(s.state, 8);
    s.remove(0);
    expect(s.saving()).toBe(true);
    expect(readSlot(0)!.state.run.time).toBe(8);
  });

  it('loads another slot without writing over the unreadable one', () => {
    store.setItem(slotKey(0), 'garbage');
    writeSlot(1, newGame(2));
    writeSlot(2, newGame(3));
    const s = new GameSession(settings());
    s.load(1);
    expect(s.active()).toBe(1);
    expect(s.saving()).toBe(true);
    expect(store.getItem(slotKey(0))).toBe('garbage');
    expect(slotStatus(0).kind).toBe('unreadable');
  });
});

describe('GameSession write failures', () => {
  it('warns once per run of failed writes, and again after a success', () => {
    const s = new GameSession(settings());
    const setItem = store.setItem.bind(store);
    let full = true;
    store.setItem = (k, v) => {
      if (full && k.includes('/slot/')) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    };
    const failures = (): number => s.state.out.log.filter((e) => e.text.includes("Couldn't save to slot 1")).length;

    s.saveNow();
    s.saveNow();
    expect(failures()).toBe(1);
    expect(s.state.out.log.some((e) => e.text.includes('Saved to slot'))).toBe(false);

    full = false;
    s.saveNow();
    full = true;
    s.saveNow();
    expect(failures()).toBe(2);
  });

  it('reports a failed import instead of claiming success', () => {
    const s = new GameSession(settings());
    store.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    s.importTo(1, { savedAt: 1, state: newGame(9) });
    expect(warned(s, "Couldn't save to slot 2")).toBe(true);
    expect(s.state.out.log.some((e) => e.text.includes('Imported'))).toBe(false);
  });
});

describe('GameSession slot switching', () => {
  it('saves the running game to its own slot before loading another', () => {
    writeSlot(0, atTime(newGame(1), 42));
    writeSlot(2, newGame(3));
    let switched = 0;
    const s = new GameSession(settings(), { onSwitch: () => switched++ });
    // Unsaved progress in the running game: only the switch can persist it.
    atTime(s.state, 43);

    s.load(2);

    expect(readSlot(0)!.state.run.time).toBe(43);
    expect(s.active()).toBe(2);
    expect(s.state.profile.seed).toBe(3);
    expect(readSlot(2)!.state.profile.seed).toBe(3);
    expect(switched).toBe(1);
    expect(s.state.out.log.some((e) => e.text.includes('Slot 3 loaded'))).toBe(true);
  });

  it('ignores a load from an empty slot', () => {
    let switched = 0;
    const s = new GameSession(settings(), { onSwitch: () => switched++ });
    atTime(s.state, 9);

    s.load(1);

    expect(s.active()).toBe(0);
    expect(s.state.run.time).toBe(9);
    expect(switched).toBe(0);
    expect(readSlot(0)).toBeNull();
  });

  it('restarts the running slot with a fresh game saved in it', () => {
    writeSlot(0, atTime(newGame(1), 99));
    let switched = 0;
    const s = new GameSession(settings(), { onSwitch: () => switched++ });

    s.newGame(0);

    expect(s.active()).toBe(0);
    expect(s.state.run.time).toBe(0);
    expect(readSlot(0)!.state.run.time).toBe(0);
    expect(readSlot(0)!.state.profile.seed).toBe(s.state.profile.seed);
    expect(switched).toBe(1);
  });

  it('saves the running game before starting a new one in another slot', () => {
    const s = new GameSession(settings());
    atTime(s.state, 12);

    s.newGame(2);

    expect(readSlot(0)!.state.run.time).toBe(12);
    expect(s.active()).toBe(2);
    expect(s.state.run.time).toBe(0);
    expect(readSlot(2)!.state.run.time).toBe(0);
  });

  it('imports a save into an empty slot without touching the running game', () => {
    const s = new GameSession(settings());
    const running = atTime(s.state, 30);

    s.importTo(1, { savedAt: 1234, state: newGame(11) });

    expect(readSlot(1)!.state.profile.seed).toBe(11);
    expect(s.active()).toBe(0);
    expect(s.state).toBe(running);
    expect(s.state.run.time).toBe(30);
    expect(s.state.out.log.some((e) => e.text.includes('Imported a save into slot 2'))).toBe(true);
  });

  it('deletes another slot but never the running one', () => {
    writeSlot(0, newGame(1));
    writeSlot(1, newGame(2));
    const s = new GameSession(settings());

    s.remove(1);
    expect(readSlot(1)).toBeNull();

    s.remove(0);
    expect(readSlot(0)).not.toBeNull();
  });
});

describe('GameSession sim index', () => {
  it('clears the sim index when the session switches games', () => {
    writeSlot(1, newGame(3));
    const s = new GameSession(settings());
    s.sim.rebuild(s.state);
    expect(s.sim.rockById.size).toBeGreaterThan(0);
    s.load(1);
    expect(s.sim.rockById.size).toBe(0);
    expect(s.sim.stats.size).toBe(0);
  });

  it('clears the sim index when starting a new game', () => {
    const s = new GameSession(settings());
    s.sim.rebuild(s.state);
    expect(s.sim.rockById.size).toBeGreaterThan(0);
    s.newGame(2);
    expect(s.sim.rockById.size).toBe(0);
  });
});

describe('GameSession saving', () => {
  it('saves the running game to the active slot and logs a notice', () => {
    const s = new GameSession(settings());
    atTime(s.state, 7);
    const before = s.state.out.log.length;

    s.saveNow();

    expect(readSlot(0)!.state.run.time).toBe(7);
    const added = s.state.out.log.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].text).toContain('Saved to slot 1');
  });
});

/** Node has no requestIdleCallback, so a queued autosave runs on a zero timeout (clamped to 1 ms). */
const idle = (): void => {
  vi.advanceTimersByTime(1);
};

describe('GameSession autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('persists to the active slot on the interval without logging', () => {
    const s = new GameSession(settings(10));
    atTime(s.state, 7);
    const before = s.state.out.log.length;

    s.start();
    vi.advanceTimersByTime(10_000);
    expect(readSlot(0)).toBeNull();
    idle();

    expect(readSlot(0)!.state.run.time).toBe(7);
    expect(s.state.out.log).toHaveLength(before);
  });

  it('stays off when the interval is zero', () => {
    const s = new GameSession(settings(0));
    atTime(s.state, 5);

    s.start();
    vi.advanceTimersByTime(120_000);

    expect(readSlot(0)).toBeNull();
  });

  it('keeps its schedule through unrelated settings changes', () => {
    const set = settings(10);
    const s = new GameSession(set);
    atTime(s.state, 4);
    s.start();

    vi.advanceTimersByTime(6_000);
    set.set({ volMaster: 0.3 });
    vi.advanceTimersByTime(4_000);
    idle();

    expect(readSlot(0)!.state.run.time).toBe(4);
  });

  it('re-arms when the interval changes, and stops when it is set to off', () => {
    const set = settings(10);
    const s = new GameSession(set);
    atTime(s.state, 4);
    s.start();

    set.set({ autosaveSec: 30 });
    vi.advanceTimersByTime(29_000);
    expect(readSlot(0)).toBeNull();
    vi.advanceTimersByTime(1_000);
    idle();
    expect(readSlot(0)!.state.run.time).toBe(4);

    set.set({ autosaveSec: 0 });
    atTime(s.state, 8);
    vi.advanceTimersByTime(120_000);
    expect(readSlot(0)!.state.run.time).toBe(4);
  });

  it('stop() cancels the timer, and later settings changes do not restart it', () => {
    const set = settings(10);
    const s = new GameSession(set);
    atTime(s.state, 5);

    s.start();
    s.stop();
    set.set({ autosaveSec: 30 });
    vi.advanceTimersByTime(120_000);

    expect(readSlot(0)).toBeNull();
  });
});

/** How many save-slot writes a `setItem` spy has seen. */
const slotWrites = (spy: { mock: { calls: unknown[][] } }): number =>
  spy.mock.calls.filter(([k]) => String(k).includes('/slot/')).length;

describe('GameSession page lifecycle', () => {
  let win: EventTarget;
  let doc: EventTarget & { hidden: boolean };

  beforeEach(() => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false });
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('saves when the tab is hidden or closed, not when it becomes visible', () => {
    const s = new GameSession(settings(0));
    s.start();
    atTime(s.state, 3);

    doc.dispatchEvent(new Event('visibilitychange'));
    expect(readSlot(0)).toBeNull();

    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(readSlot(0)!.state.run.time).toBe(3);

    atTime(s.state, 6);
    win.dispatchEvent(new Event('beforeunload'));
    expect(readSlot(0)!.state.run.time).toBe(6);
  });

  it('registers its listeners once, however often it is started, and drops them on stop()', () => {
    const s = new GameSession(settings(0));
    const write = vi.spyOn(store, 'setItem');

    s.start();
    s.start();
    win.dispatchEvent(new Event('beforeunload'));
    expect(slotWrites(write)).toBe(1);

    s.stop();
    win.dispatchEvent(new Event('beforeunload'));
    expect(slotWrites(write)).toBe(1);
  });
});

describe('GameSession idle autosave', () => {
  let queued: Map<number, () => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    queued = new Map();
    let next = 1;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      queued.set(next, cb);
      return next++;
    });
    vi.stubGlobal('cancelIdleCallback', (id: number) => queued.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Run every queued idle callback, as the browser would between frames. */
  const flushIdle = (): void => {
    const cbs = [...queued.values()];
    queued.clear();
    for (const cb of cbs) cb();
  };

  it('waits for an idle moment, and queues one save however many intervals pass', () => {
    const s = new GameSession(settings(10));
    atTime(s.state, 3);
    s.start();

    vi.advanceTimersByTime(30_000);
    expect(readSlot(0)).toBeNull();
    expect(queued.size).toBe(1);

    flushIdle();
    expect(readSlot(0)!.state.run.time).toBe(3);
  });

  it('drops the queued save on stop() and after an immediate save', () => {
    const s = new GameSession(settings(10));
    s.start();
    vi.advanceTimersByTime(10_000);
    s.saveNow();
    expect(queued.size).toBe(0);

    vi.advanceTimersByTime(10_000);
    s.stop();
    expect(queued.size).toBe(0);
  });
});
