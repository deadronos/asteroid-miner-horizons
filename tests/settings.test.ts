import { describe, expect, it } from 'vitest';
import { DEFAULTS, SettingsStore, actionFor } from '../src/settings';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { flagship, makeShip } from '../src/sim/ships';
import type { Assists } from '../src/sim/assists';
import { tick } from '../src/sim/update';
import type { GameState } from '../src/sim/types';

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
});

function runFor(s: GameState, sec: number, assists: Assists, cmds: Parameters<typeof tick>[2]['commands'] = []): void {
  const input = { thrust: { x: 0, z: 0 }, commands: cmds, assists };
  const index = new SimIndex();
  for (let t = 0; t < sec; t += 1 / 60) tick(s, 1 / 60, input, index);
}

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
      runFor(s, 8, { ...ON, chain }, [{ t: 'mine', shipId: ship.id, rockId: rock.id }]);
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
      runFor(s, 15, { ...ON, autoDock });
      expect(drone.cargo.ore === 0).toBe(autoDock);
    }
  });
});
