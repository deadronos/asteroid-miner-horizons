import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { walletTotal, walletValue } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { GameSession } from '../src/session';
import { makeOutpost } from '../src/sim/automation';
import { newGame } from '../src/sim/create';
import { applyOffline, droneMix, offlineGains, offlineLog } from '../src/sim/offline';
import { readSlot, serialize, writeSlot } from '../src/sim/save';
import { makeShip, shipStats } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { SettingsStore } from '../src/settings';
import { memStorage } from './memStorage';

/** Always grants the slot lock: these tests fake `window`, which would send the real locker down the browser path. */
const granted = { acquire: () => ({ release() {} }) };

const HOUR = 3600;

/** A fresh game with `n` basic drones parked at the station. */
function withDrones(n: number, seed = 1): GameState {
  const s = newGame(seed);
  const st = s.run.system.station.pos;
  for (let i = 0; i < n; i++) s.run.ships.push(makeShip(s.run, s.profile, 'drone', `Drone-${i + 1}`, st));
  return s;
}

/** The drone rate the estimate should use for `s`, in units per second. */
function droneRate(s: GameState): number {
  const dps = s.run.ships.filter((x) => x.hullId === 'drone').reduce((sum, x) => sum + shipStats(x, s.profile).dps, 0);
  return dps * TUNING.offlineUnitsPerDps * TUNING.offlineEfficiency * (1 + 0.1 * s.profile.perks.yield);
}

describe('offlineGains', () => {
  it('earns nothing without drones or outposts', () => {
    const s = newGame(1);
    const before = serialize(s);
    expect(walletTotal(offlineGains(s, 2 * HOUR).bank)).toBe(0);
    expect(applyOffline(s, 2 * HOUR)).toBeNull();
    expect(serialize(s)).toBe(before);
    expect(s.out.log.some((e) => e.text.startsWith('While you were away'))).toBe(false);
  });

  it('pays each drone a flat rate from its laser dps, split by the reachable belts', () => {
    const s = withDrones(2);
    const g = offlineGains(s, HOUR);
    expect(walletTotal(g.bank)).toBeCloseTo(droneRate(s) * HOUR, 6);
    expect(g.mined).toBeCloseTo(walletTotal(g.bank), 6);
    const mix = droneMix(s);
    expect(g.bank.ore / walletTotal(g.bank)).toBeCloseTo(mix.ore, 6);
    expect(g.bank.ice).toBeGreaterThan(0);
    // System 1 has no crystal, and refined goods are never mined.
    expect(g.bank.crystal + g.bank.alloy + g.bank.fuel).toBe(0);
  });

  it('scales with the yield perk', () => {
    const a = withDrones(1);
    const b = withDrones(1);
    b.profile.perks.yield = 3;
    expect(walletTotal(offlineGains(b, HOUR).bank) / walletTotal(offlineGains(a, HOUR).bank)).toBeCloseTo(1.3, 6);
  });

  it('caps the time away', () => {
    const s = withDrones(1);
    const capped = offlineGains(s, 30 * HOUR);
    expect(capped.seconds).toBe(TUNING.offlineCapSec);
    expect(walletTotal(capped.bank)).toBeCloseTo(walletTotal(offlineGains(s, TUNING.offlineCapSec).bank), 6);
    expect(offlineGains(s, -50).seconds).toBe(0);
  });

  it('ignores belts out of drone range of the station', () => {
    const s = newGame(1);
    s.run.system.belts.push({ inner: 5000, outer: 5200, mix: { ore: 0, ice: 0, crystal: 1 }, initialCount: 999 });
    expect(droneMix(s).crystal).toBe(0);
  });

  it('fills outpost storage up to capacity when no hauler can ferry it', () => {
    const s = newGame(1);
    const rock = s.run.rocks.find((r) => r.size === 0)!;
    s.run.automation.outposts.push(makeOutpost(rock));
    const g = offlineGains(s, 8 * HOUR);
    expect(g.ferried).toBe(false);
    expect(g.stored).toBeCloseTo(TUNING.outpostCapacity, 6);
    expect(walletTotal(g.bank)).toBe(0);
  });

  it('banks outpost output, up to the reserve, when a hauler is in the fleet', () => {
    const s = newGame(1);
    const rock = s.run.rocks.find((r) => r.size === 0)!;
    const o = makeOutpost(rock);
    o.reserve = 50;
    s.run.automation.outposts.push(o);
    s.run.ships.push(makeShip(s.run, s.profile, 'hauler', 'Hauler-1', s.run.system.station.pos));
    const g = offlineGains(s, 8 * HOUR);
    expect(g.ferried).toBe(true);
    expect(g.extract[0]).toBe(50);
    expect(g.bank[o.kind]).toBeCloseTo(50, 6);
    expect(g.mined).toBe(0);
  });
});

describe('applyOffline', () => {
  it('credits the bank, run value and units mined, and logs a summary toast', () => {
    const s = withDrones(3);
    const bank = walletTotal(s.run.bank);
    const g = applyOffline(s, 2 * HOUR)!;
    expect(walletTotal(s.run.bank) - bank).toBeCloseTo(walletTotal(g.bank), 6);
    expect(s.run.runValue).toBeCloseTo(walletValue(g.bank), 6);
    expect(s.profile.stats.unitsMined).toBeCloseTo(g.mined, 6);
    const line = s.out.log.at(-1)!;
    expect(line.level).toBe('major');
    expect(line.text).toMatch(/^While you were away \(2h 00m\): fleet banked \d+⬢ \d+❄\.$/);
    expect(line.toast).toMatchObject({ kicker: 'While you were away', title: '2h 00m' });
  });

  it('marks a capped absence in the summary', () => {
    const s = withDrones(1);
    applyOffline(s, 20 * HOUR);
    expect(s.out.log.at(-1)!.text).toContain('(8h 00m (cap))');
  });

  it('does nothing for a short absence', () => {
    const s = withDrones(1);
    const before = serialize(s);
    expect(applyOffline(s, TUNING.offlineMinSec - 1)).toBeNull();
    expect(serialize(s)).toBe(before);
  });

  it('moves extracted reserve into outpost storage without a hauler', () => {
    const s = newGame(1);
    const rock = s.run.rocks.find((r) => r.size === 0)!;
    const o = makeOutpost(rock);
    s.run.automation.outposts.push(o);
    const reserve = o.reserve;
    applyOffline(s, HOUR);
    expect(walletTotal(o.stored)).toBeCloseTo(TUNING.outpostCapacity, 6);
    expect(o.reserve).toBeCloseTo(reserve - TUNING.outpostCapacity, 6);
    expect(s.run.automation.extracted).toBeCloseTo(TUNING.outpostCapacity, 6);
    expect(s.out.log.at(-1)!.text).toContain('outposts stored 100 units');
  });

  it('leaves the RNG streams, rocks and ships untouched', () => {
    const s = withDrones(2);
    const rng = { run: s.run.rng.s, contracts: s.run.contracts.rng.s, hazards: s.run.hazards.rng.s };
    const rocks = JSON.stringify(s.run.rocks);
    const ships = JSON.stringify(s.run.ships);
    applyOffline(s, 5 * HOUR);
    expect({ run: s.run.rng.s, contracts: s.run.contracts.rng.s, hazards: s.run.hazards.rng.s }).toEqual(rng);
    expect(JSON.stringify(s.run.rocks)).toBe(rocks);
    expect(JSON.stringify(s.run.ships)).toBe(ships);
    expect(s.run.time).toBe(0);
  });
});

/** The offline-progress summary lines a session has logged. */
const aways = (s: GameSession): string[] =>
  s.state.out.log.filter((e) => e.text.startsWith('While you were away')).map((e) => e.text);

describe('GameSession offline progress', () => {
  let store: Storage;
  const T0 = Date.UTC(2026, 9, 19, 12);

  beforeEach(() => {
    store = memStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function settings(offlineProgress = true): SettingsStore {
    const s = new SettingsStore(store);
    s.set({ offlineProgress });
    return s;
  }

  it('credits the time since the save was written, once', () => {
    const game = withDrones(2);
    game.run.time = 100;
    writeSlot(0, game);
    vi.setSystemTime(T0 + 3 * HOUR * 1000);

    const s = new GameSession(settings());
    const gained = walletTotal(s.state.run.bank) - walletTotal(game.run.bank);
    expect(gained).toBeCloseTo(droneRate(game) * 3 * HOUR, 3);
    expect(s.state.out.log.some((e) => e.text.startsWith('While you were away (3h 00m)'))).toBe(true);
    // Saved straight away, so reloading now credits nothing more.
    expect(readSlot(0)!.savedAt).toBe(T0 + 3 * HOUR * 1000);
    const again = new GameSession(settings());
    expect(walletTotal(again.state.run.bank)).toBeCloseTo(walletTotal(s.state.run.bank), 6);
  });

  it('credits a slot loaded from the menu', () => {
    writeSlot(0, newGame(2));
    writeSlot(1, withDrones(1, 3));
    const s = new GameSession(settings());
    vi.setSystemTime(T0 + HOUR * 1000);
    s.load(1);
    expect(s.state.out.log.some((e) => e.text.startsWith('While you were away (1h 00m)'))).toBe(true);
  });

  it('credits each slot for its own time since savedAt, not for time spent playing another slot', () => {
    const a = withDrones(2, 2);
    const b = withDrones(1, 3);
    writeSlot(0, a);
    writeSlot(1, b);
    const s = new GameSession(settings());

    // Two hours on slot A, then slot B wakes up with its own two hours.
    vi.setSystemTime(T0 + 2 * HOUR * 1000);
    s.load(1);
    expect(walletTotal(s.state.run.bank) - walletTotal(b.run.bank)).toBeCloseTo(droneRate(b) * 2 * HOUR, 3);
    // Slot A was saved at the switch, so it holds no credit for the time spent on B.
    expect(readSlot(0)!.savedAt).toBe(T0 + 2 * HOUR * 1000);

    // One more hour on B: A is credited that hour alone, not the three since it first loaded.
    const aSaved = readSlot(0)!.state;
    vi.setSystemTime(T0 + 3 * HOUR * 1000);
    s.load(0);
    expect(walletTotal(s.state.run.bank) - walletTotal(aSaved.run.bank)).toBeCloseTo(droneRate(a) * HOUR, 3);
    expect(s.state.out.log.some((e) => e.text.startsWith('While you were away (1h 00m)'))).toBe(true);
  });

  it('credits nothing when the setting is off', () => {
    const game = withDrones(2);
    writeSlot(0, game);
    vi.setSystemTime(T0 + 3 * HOUR * 1000);
    const s = new GameSession(settings(false));
    expect(s.state.run.bank).toEqual(game.run.bank);
    expect(s.state.out.log.some((e) => e.text.startsWith('While you were away'))).toBe(false);
  });

  /** A session on a saved drone game, loaded at the current (fake) time so nothing is credited yet. */
  function running(offlineProgress = true): GameSession {
    writeSlot(0, withDrones(2));
    return new GameSession(settings(offlineProgress), {}, granted);
  }

  describe('in a hidden tab', () => {
    let doc: EventTarget & { hidden: boolean };

    beforeEach(() => {
      doc = Object.assign(new EventTarget(), { hidden: false });
      Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
      Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
    });
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'document');
    });

    const setHidden = (hidden: boolean): void => {
      doc.hidden = hidden;
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    it('credits the hidden span once, when the tab is shown again, and saves it', () => {
      const s = running();
      s.start();
      const bank0 = walletTotal(s.state.run.bank);
      setHidden(true);
      vi.setSystemTime(T0 + HOUR * 1000);
      setHidden(false);

      expect(walletTotal(s.state.run.bank) - bank0).toBeCloseTo(droneRate(s.state) * HOUR, 3);
      expect(aways(s)).toEqual([expect.stringMatching(/^While you were away \(1h 00m\)/)]);
      expect(readSlot(0)!.savedAt).toBe(T0 + HOUR * 1000);

      // A second visible event, or a reload now, credits nothing more.
      const bank1 = walletTotal(s.state.run.bank);
      setHidden(false);
      expect(walletTotal(s.state.run.bank)).toBe(bank1);
      const again = new GameSession(settings(), {}, granted);
      expect(walletTotal(again.state.run.bank)).toBeCloseTo(bank1, 6);
      s.stop();
    });

    it('does not credit the span again after hide, reload, show', () => {
      const s = running();
      s.start();
      setHidden(true); // saves at T0
      s.stop(); // the page goes away
      vi.setSystemTime(T0 + HOUR * 1000);
      const reloaded = new GameSession(settings(), {}, granted); // credits the hour from savedAt
      reloaded.start();
      setHidden(false);
      expect(aways(reloaded)).toHaveLength(1);
      reloaded.stop();
    });

    it('ignores short hides and respects the setting', () => {
      const s = running();
      s.start();
      setHidden(true);
      vi.setSystemTime(T0 + 30_000);
      setHidden(false);
      expect(aways(s)).toEqual([]);
      s.stop();

      vi.setSystemTime(T0);
      const off = running(false);
      off.start();
      setHidden(true);
      vi.setSystemTime(T0 + HOUR * 1000);
      setHidden(false);
      expect(aways(off)).toEqual([]);
      off.stop();
    });

    it('counts a page opened in a background tab as hidden from start()', () => {
      doc.hidden = true;
      const s = running();
      s.start();
      vi.setSystemTime(T0 + HOUR * 1000);
      setHidden(false);
      expect(aways(s)).toHaveLength(1);
      s.stop();
    });

    it('credits nothing while saving is suspended after an error', () => {
      const s = running();
      s.start();
      s.suspendAutosave();
      setHidden(true);
      vi.setSystemTime(T0 + HOUR * 1000);
      setHidden(false);
      expect(aways(s)).toEqual([]);
      s.stop();
    });
  });
});

describe('offlineLog', () => {
  it('still reads as a sentence when every resource rounds below a unit', () => {
    const s = withDrones(1);
    const g = offlineGains(s, 60);
    g.bank = { ore: 0.4, ice: 0.4, crystal: 0.4, alloy: 0, fuel: 0 };
    const line = offlineLog(g, false);
    expect(line.text).toBe('While you were away (1m): fleet banked a few scraps.');
    expect(line.toast!.detail).toBe('Fleet banked a few scraps.');
  });
});
