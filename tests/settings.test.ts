import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  HELP_MODES,
  LOG_VERBOSITY_IDS,
  QUALITY,
  QUALITY_IDS,
  QUALITY_MODES,
  SHAKE_IDS,
  SHAKE_SCALE,
  SettingsStore,
  TOUCH_MODES,
  actionFor,
} from '../src/settings';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { flagship, makeShip } from '../src/sim/ships';
import type { Assists } from '../src/sim/assists';
import { runFor } from './helpers';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('settings store', () => {
  it('fills defaults and ignores wrongly typed stored values', () => {
    const st = new MemStorage();
    st.setItem(
      'asteroid-miner-horizons/settings',
      JSON.stringify({ hudScale: 1.2, quality: 42, keys: { up: ['KeyI', null], down: 'nope' } }),
    );
    const s = new SettingsStore(st as unknown as Storage).value;
    expect(s.hudScale).toBe(1.2);
    expect(s.quality).toBe(DEFAULTS.quality);
    expect(s.keys.up).toEqual(['KeyI', null]);
    expect(s.keys.down).toEqual(DEFAULTS.keys.down);
    expect(s.pauseInMenus).toBe(true);
  });

  it('settings: unknown builderReserve falls back to 25', () => {
    expect(SettingsStore.merge(null).builderReserve).toBe(25);
    expect(SettingsStore.merge({ builderReserve: 50 }).builderReserve).toBe(50);
    expect(SettingsStore.merge({ builderReserve: 7 }).builderReserve).toBe(25);
    expect(SettingsStore.merge({ builderReserve: 'lots' }).builderReserve).toBe(25);
  });

  it('defaults hazards to normal and rejects unknown stored levels', () => {
    expect(SettingsStore.merge(null).hazards).toBe('normal');
    expect(SettingsStore.merge({ hazards: 'harsh' }).hazards).toBe('harsh');
    expect(SettingsStore.merge({ hazards: 'off' }).hazards).toBe('off');
    expect(SettingsStore.merge({ hazards: 'brutal' }).hazards).toBe('normal');
    expect(SettingsStore.merge({ hazards: 3 }).hazards).toBe('normal');
  });

  it('loads the help mode, mapping the old on/off toggle', () => {
    expect(SettingsStore.merge(null).help).toBe('auto');
    expect(SettingsStore.merge({ showHelp: true }).help).toBe('auto');
    expect(SettingsStore.merge({ showHelp: false }).help).toBe('off');
    for (const help of HELP_MODES) expect(SettingsStore.merge({ help, showHelp: false }).help).toBe(help);
    expect(SettingsStore.merge({ help: 'sometimes' }).help).toBe('auto');
  });

  it('loads the touch-controls mode, defaulting to auto', () => {
    expect(SettingsStore.merge(null).touchControls).toBe('auto');
    for (const touchControls of TOUCH_MODES)
      expect(SettingsStore.merge({ touchControls }).touchControls).toBe(touchControls);
    expect(SettingsStore.merge({ touchControls: true }).touchControls).toBe('auto');
    expect(SettingsStore.merge({ touchControls: 'always' }).touchControls).toBe('auto');
  });

  it('keeps only known panels with boolean collapse choices', () => {
    const s = SettingsStore.merge({ hudCollapsed: { fleet: true, refinery: false, ship: 'yes', map: true } });
    expect(s.hudCollapsed).toEqual({ fleet: true, refinery: false });
    expect(SettingsStore.merge({ hudCollapsed: 'all' }).hudCollapsed).toEqual({});
    expect(SettingsStore.merge({ hudCompact: true }).hudCompact).toBe(true);
  });

  it('never shares the default collapse object', () => {
    const s = SettingsStore.merge({ hudCollapsed: { contracts: true } });
    expect(DEFAULTS.hudCollapsed).toEqual({});
    expect(SettingsStore.merge(null).hudCollapsed).not.toBe(DEFAULTS.hudCollapsed);
    expect(s.hudCollapsed).toEqual({ contracts: true });
  });

  it('rejects unknown stored enums and leaves defaults usable', () => {
    const s = SettingsStore.merge({ quality: 'ultra', shake: 'max', logVerbosity: 'loud' });
    expect(s.quality).toBe(DEFAULTS.quality);
    expect(s.shake).toBe(DEFAULTS.shake);
    expect(s.logVerbosity).toBe(DEFAULTS.logVerbosity);
    expect(QUALITY[QUALITY_IDS[0]]).toBeDefined();
    expect(SHAKE_SCALE[s.shake]).toBeDefined();
  });

  it('preserves every allowed enum value and autosave interval', () => {
    for (const quality of QUALITY_IDS) expect(SettingsStore.merge({ quality }).quality).toBe(quality);
    for (const shake of SHAKE_IDS) expect(SettingsStore.merge({ shake }).shake).toBe(shake);
    for (const logVerbosity of LOG_VERBOSITY_IDS)
      expect(SettingsStore.merge({ logVerbosity }).logVerbosity).toBe(logVerbosity);
    for (const autosaveSec of [0, 10, 30, 60] as const)
      expect(SettingsStore.merge({ autosaveSec }).autosaveSec).toBe(autosaveSec);
  });

  it('supports Auto quality and validates the independent render scale', () => {
    expect(QUALITY_MODES).toEqual(['auto', 'low', 'medium', 'high']);
    expect(SettingsStore.merge({ quality: 'auto', renderScale: 0.75 })).toMatchObject({
      quality: 'auto',
      renderScale: 0.75,
    });
    expect(SettingsStore.merge({ renderScale: 0.5 }).renderScale).toBe(DEFAULTS.renderScale);
    expect(SettingsStore.merge({ renderScale: '75%' }).renderScale).toBe(DEFAULTS.renderScale);
  });

  it('falls back on non-finite and out-of-range numbers', () => {
    const s = SettingsStore.merge({
      hudScale: NaN,
      zoomSpeed: Infinity,
      volMaster: 2,
      volSfx: -1,
      volMusic: 1.5,
      autosaveSec: 15,
    });
    expect(s.hudScale).toBe(DEFAULTS.hudScale);
    expect(s.zoomSpeed).toBe(DEFAULTS.zoomSpeed);
    expect(s.volMaster).toBe(DEFAULTS.volMaster);
    expect(s.volSfx).toBe(DEFAULTS.volSfx);
    expect(s.volMusic).toBe(DEFAULTS.volMusic);
    expect(s.autosaveSec).toBe(DEFAULTS.autosaveSec);
  });

  it('preserves in-range boundary values', () => {
    const s = SettingsStore.merge({
      hudScale: 0.5,
      zoomSpeed: 4,
      volMaster: 0,
      volSfx: 1,
      volMusic: 0.25,
      autosaveSec: 60,
    });
    expect(s.hudScale).toBe(0.5);
    expect(s.zoomSpeed).toBe(4);
    expect(s.volMaster).toBe(0);
    expect(s.volSfx).toBe(1);
    expect(s.volMusic).toBe(0.25);
    expect(s.autosaveSec).toBe(60);
  });

  it('persists changes and notifies subscribers', () => {
    const st = new MemStorage();
    const a = new SettingsStore(st as unknown as Storage);
    let seen = 0;
    a.onChange(() => seen++);
    a.set({ shake: 'off' });
    expect(seen).toBe(1);
    expect(new SettingsStore(st as unknown as Storage).value.shake).toBe('off');
  });

  it('rebinding a key steals it from the other action', () => {
    const a = new SettingsStore(new MemStorage() as unknown as Storage);
    const stolen = a.bind('map', 1, 'KeyW');
    expect(stolen).toBe('up');
    expect(a.value.keys.up[0]).toBeNull();
    expect(actionFor(a.value.keys, 'KeyW')).toBe('map');
    a.resetKeys();
    expect(actionFor(a.value.keys, 'KeyW')).toBe('up');
  });

  it('binds the sensor ping to Q by default', () => {
    expect(DEFAULTS.keys.ping).toEqual(['KeyQ', null]);
    expect(actionFor(DEFAULTS.keys, 'KeyQ')).toBe('ping');
  });

  it('starts with defaults when storage is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      const s = new SettingsStore();
      expect(s.value.quality).toBe(DEFAULTS.quality);
      expect(() => s.set({ quality: 'low' })).not.toThrow();
      expect(s.value.quality).toBe('low');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('assists', () => {
  const ON: Assists = { avoid: true, autoDock: true, chain: true };

  it('chain off: mining order ends when the rock breaks', () => {
    for (const chain of [true, false]) {
      const s = newGame(9);
      const ship = flagship(s.run);
      const st = s.run.system.station.pos;
      ship.pos = { x: st.x, z: st.z };
      const rock = makeRock(s.run, 'ore', 1, { x: st.x + 100, z: st.z }, 10, 0);
      s.run.rocks.push(rock);
      runFor(s, 8, { assists: { ...ON, chain }, commands: [{ t: 'mine', shipId: ship.id, rockId: rock.id }] });
      expect(s.run.rocks.includes(rock)).toBe(false);
      // With chaining the order moves on to a fragment; without it the order ends.
      expect(ship.order !== null).toBe(chain);
    }
  });

  it('auto-dock off: a full drone does not return to unload', () => {
    for (const autoDock of [true, false]) {
      const s = newGame(10);
      const st = s.run.system.station.pos;
      const drone = makeShip(s.run, s.profile, 'drone', 'D', { x: st.x + 400, z: st.z });
      drone.cargo.ore = 40; // full hold
      s.run.ships.push(drone);
      // Park the flagship away from the station so "escorting" it doesn't dock the drone by accident.
      flagship(s.run).pos = { x: st.x + 600, z: st.z };
      runFor(s, 15, { assists: { ...ON, autoDock } });
      // Assert the unload itself rather than an empty hold: a faster drone
      // starts re-mining within the window, so its hold is non-empty again.
      expect(s.run.runValue > 0).toBe(autoDock);
    }
  });
});

describe('colour vision setting (#210)', () => {
  it('defaults, round-trips valid modes and ignores unknown values', () => {
    expect(SettingsStore.merge(null).colourVision).toBe('default');
    expect(SettingsStore.merge({ colourVision: 'tritan' }).colourVision).toBe('tritan');
    expect(SettingsStore.merge({ colourVision: 'deutan' }).colourVision).toBe('deutan');
    expect(SettingsStore.merge({ colourVision: 'protan' }).colourVision).toBe('default');
    expect(SettingsStore.merge({ colourVision: 3 }).colourVision).toBe('default');
  });
});
