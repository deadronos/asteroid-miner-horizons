import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../src/session';
import { newGame } from '../src/sim/create';
import { readSlot, serialize, writeSlot } from '../src/sim/save';
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

describe('GameSession autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('persists to the active slot on the interval without logging', () => {
    const s = new GameSession(settings(10));
    atTime(s.state, 7);
    const before = s.state.out.log.length;

    s.start();
    vi.advanceTimersByTime(10_000);

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
