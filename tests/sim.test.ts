import { describe, expect, it } from 'vitest';
import { COMPONENTS, type Tier } from '../src/data/components';
import { RESOURCES, walletTotal } from '../src/data/resources';
import type { Command } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { dataGain, warpCost } from '../src/sim/economy';
import { makeRock } from '../src/sim/generate';
import { destroyRock } from '../src/sim/mining';
import { deserialize, exportText, parseImport, serialize } from '../src/sim/save';
import { flagship, shipStats } from '../src/sim/ships';
import { tick } from '../src/sim/update';
import type { GameState } from '../src/sim/types';

const DT = 1 / 60;

function run(state: GameState, seconds: number, commands: Command[] = []): void {
  const input = { thrust: { x: 0, z: 0 }, commands };
  for (let t = 0; t < seconds; t += DT) tick(state, DT, input);
}

function totalUnits(state: GameState): number {
  return (
    state.run.rocks.reduce((s, r) => s + r.units, 0) +
    state.run.pickups.reduce((s, p) => s + p.amount, 0)
  );
}

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const a = newGame(42);
    const b = newGame(42);
    run(a, 20);
    run(b, 20);
    expect(serialize(a)).toEqual(serialize(b));
  });
});

describe('cracking', () => {
  it('conserves resource units from large rock down to debris', () => {
    const s = newGame(1);
    s.run.rocks = [];
    const rock = makeRock(s.run, 'ore', 0, { x: 0, z: 0 }, 40, 0);
    s.run.rocks.push(rock);
    const before = totalUnits(s);
    let frags = destroyRock(s, rock);
    expect(frags).toHaveLength(3);
    for (const f of frags) for (const g of destroyRock(s, f)) destroyRock(s, g);
    expect(s.run.rocks).toHaveLength(0);
    expect(totalUnits(s)).toBeCloseTo(before, 6);
  });
});

describe('mining loop', () => {
  it('flagship mines a rock, collects debris and banks it at the station', () => {
    const s = newGame(7);
    const ship = flagship(s.run);
    const st = s.run.system.station.pos;
    // Plant a small rock right next to the station.
    const rock = makeRock(s.run, 'ore', 2, { x: st.x + 120, z: st.z }, 5, 0);
    s.run.rocks.push(rock);
    ship.pos = { x: st.x + 40, z: st.z };
    run(s, 8, [{ t: 'mine', shipId: ship.id, rockId: rock.id }]);
    expect(s.run.rocks.find((r) => r.id === rock.id)).toBeUndefined();
    run(s, 4, [{ t: 'dock', shipId: ship.id }]);
    run(s, 6);
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(walletTotal(ship.cargo)).toBe(0);
  });
});

describe('progression', () => {
  it('every component can reach tier 3 (no cap blocks purchases)', () => {
    const s = newGame(3);
    const ship = flagship(s.run);
    s.run.bank = { ore: 1e6, ice: 1e6, crystal: 1e6 };
    ship.pos = { ...s.run.system.station.pos };
    const cmds: Command[] = [];
    ship.slots.forEach((_, i) => cmds.push({ t: 'install', shipId: ship.id, slot: i, comp: 'cargo' }));
    for (let n = 0; n < 2; n++) ship.slots.forEach((_, i) => cmds.push({ t: 'upgrade', shipId: ship.id, slot: i }));
    run(s, DT, cmds);
    expect(ship.slots.every((f) => f?.type === 'cargo' && f.tier === 3)).toBe(true);
  });

  it('tier costs rise monotonically', () => {
    for (const c of Object.values(COMPONENTS)) {
      const ore = [1, 2, 3].map((t) => c.cost(t as Tier).ore ?? 0);
      expect(ore[0]).toBeLessThan(ore[1]!);
      expect(ore[1]).toBeLessThan(ore[2]!);
    }
  });

  it('refits require docking', () => {
    const s = newGame(5);
    const ship = flagship(s.run);
    ship.pos = { x: 0, z: 2000 };
    s.run.bank.ore = 1000;
    run(s, DT, [{ t: 'install', shipId: ship.id, slot: 2, comp: 'shield' }]);
    expect(ship.slots[2]).toBeNull();
  });
});

describe('warp / prestige', () => {
  it('resets the run, keeps the profile and grants Horizon Data', () => {
    const s = newGame(11);
    s.run.runValue = 5000;
    s.run.bank.ice = warpCost(s);
    s.run.bank.ore = 999;
    const gain = dataGain(s);
    expect(gain).toBeGreaterThan(0);
    const oldName = s.run.system.name;
    run(s, DT, [{ t: 'warp' }]);
    expect(s.profile.warps).toBe(1);
    expect(s.profile.data).toBe(gain);
    expect(s.run.system.number).toBe(2);
    expect(s.run.system.name).not.toBe(oldName);
    expect(s.run.bank.ore).toBeLessThan(999);
    expect(s.run.runValue).toBe(0);
  });

  it('refuses to warp without fuel', () => {
    const s = newGame(12);
    run(s, DT, [{ t: 'warp' }]);
    expect(s.profile.warps).toBe(0);
  });

  it('perks apply to ship stats', () => {
    const s = newGame(13);
    const ship = flagship(s.run);
    const before = shipStats(ship, s.profile).dps;
    s.profile.data = 10;
    run(s, DT, [{ t: 'buyPerk', perk: 'optics' }]);
    expect(shipStats(ship, s.profile).dps).toBeCloseTo(before * 1.12);
  });

  it('crystal only appears after warping', () => {
    const s = newGame(21);
    expect(s.run.rocks.some((r) => r.kind === 'crystal')).toBe(false);
  });
});

describe('save', () => {
  it('round-trips through JSON', () => {
    const s = newGame(99);
    run(s, 3);
    const back = deserialize(serialize(s))!;
    expect(serialize(back)).toEqual(serialize(s));
    for (const r of RESOURCES) expect(back.run.bank[r]).toBe(s.run.bank[r]);
  });

  it('export text imports back to the same state', () => {
    const s = newGame(77);
    run(s, 2);
    const res = parseImport(exportText(s, 1234));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.record.savedAt).toBe(1234);
      expect(serialize(res.record.state)).toEqual(serialize(s));
    }
    // A bare serialized state is accepted too.
    expect(parseImport(serialize(s)).ok).toBe(true);
  });

  it('import explains what is wrong', () => {
    expect(parseImport('{oops')).toEqual({ ok: false, error: 'Not valid JSON.' });
    const bad = parseImport('{"format":"amh-save","state":{"version":1}}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/version 1/);
    expect(parseImport('{"hello":"world"}').ok).toBe(false);
  });

  it('rejects foreign data', () => {
    expect(deserialize('{"version":1}')).toBeNull();
    expect(deserialize('not json')).toBeNull();
  });
});
