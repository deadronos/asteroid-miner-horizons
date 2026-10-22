import { describe, expect, it } from 'vitest';
import { COMPONENTS, COMPONENT_IDS, type Tier } from '../src/data/components';
import { RESOURCES, walletTotal, walletValue } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { dataGain, warpCost } from '../src/sim/economy';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { destroyRock } from '../src/sim/mining';
import { deserialize, exportText, parseImport, serialize } from '../src/sim/save';
import { damageShip, flagship, isFlagship, makeShip, shipStats } from '../src/sim/ships';
import { tick } from '../src/sim/update';
import type { GameState } from '../src/sim/types';
import { DT, runFor } from './helpers';

function totalUnits(state: GameState): number {
  return state.run.rocks.reduce((s, r) => s + r.units, 0) + state.run.pickups.reduce((s, p) => s + p.amount, 0);
}

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const a = newGame(42);
    const b = newGame(42);
    runFor(a, 20);
    runFor(b, 20);
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
    runFor(s, 8, { commands: [{ t: 'mine', shipId: ship.id, rockId: rock.id }] });
    expect(s.run.rocks.find((r) => r.id === rock.id)).toBeUndefined();
    runFor(s, 4, { commands: [{ t: 'dock', shipId: ship.id }] });
    runFor(s, 6);
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(walletTotal(ship.cargo)).toBe(0);
  });

  it('reports collected amounts and docking in the fx outbox', () => {
    const s = newGame(7);
    const ship = flagship(s.run);
    const st = s.run.system.station.pos;
    const rock = makeRock(s.run, 'ore', 2, { x: st.x + 120, z: st.z }, 5, 0);
    s.run.rocks.push(rock);
    ship.pos = { x: st.x + 40, z: st.z };
    s.out.fx.length = 0;
    runFor(s, 8, { commands: [{ t: 'mine', shipId: ship.id, rockId: rock.id }] });
    runFor(s, 4, { commands: [{ t: 'dock', shipId: ship.id }] });
    runFor(s, 6);
    let collected = 0;
    let docked = 0;
    for (const f of s.out.fx) {
      if (f.t === 'collect' && f.shipId === ship.id) collected += f.amount;
      if (f.t === 'dock' && f.shipId === ship.id) docked += f.value;
    }
    expect(collected).toBeGreaterThan(0);
    // Ore is worth 1 per unit, so everything picked up shows up as docked value.
    expect(docked).toBeCloseTo(collected, 6);
    expect(docked).toBeCloseTo(s.run.runValue, 6);
  });

  it('keeps a pickup sitting exactly on a ship finite', () => {
    const s = newGame(7);
    const ship = flagship(s.run);
    const st = s.run.system.station.pos;
    ship.pos = { x: st.x + 40, z: st.z };
    ship.vel = { x: 0, z: 0 };
    // More than the hold takes, so the pickup survives the tick with whatever velocity the tractor gave it.
    s.run.pickups.push({ id: 9001, kind: 'ore', amount: 1e6, pos: { ...ship.pos }, vel: { x: 0, z: 0 }, age: 0 });
    tick(s, DT, { thrust: { x: 0, z: 0 }, commands: [] }, new SimIndex());
    const p = s.run.pickups.find((q) => q.id === 9001)!;
    expect([p.pos.x, p.pos.z, p.vel.x, p.vel.z].every(Number.isFinite)).toBe(true);
  });
});

describe('progression', () => {
  it('every component can reach tier 3 (no cap blocks purchases)', () => {
    const s = newGame(3);
    const ship = flagship(s.run);
    s.run.bank = { ore: 1e6, ice: 1e6, crystal: 1e6, alloy: 1e6, fuel: 0 };
    ship.pos = { ...s.run.system.station.pos };
    const cmds: Command[] = [];
    ship.slots.forEach((_, i) =>
      cmds.push({ t: 'install', shipId: ship.id, slot: i, comp: 'cargo', variant: 'standard' }),
    );
    for (let n = 0; n < 2; n++) ship.slots.forEach((_, i) => cmds.push({ t: 'upgrade', shipId: ship.id, slot: i }));
    runFor(s, DT, { commands: cmds });
    expect(ship.slots.every((f) => f?.type === 'cargo' && f.tier === 3)).toBe(true);
  });

  it('tier costs rise monotonically in value', () => {
    for (const id of COMPONENT_IDS) {
      for (const v of COMPONENTS[id].variants) {
        const value = [1, 2, 3].map((t) => walletValue(v.cost(t as Tier)));
        expect(value[0]).toBeLessThan(value[1]!);
        expect(value[1]).toBeLessThan(value[2]!);
      }
    }
  });

  it('refits require docking', () => {
    const s = newGame(5);
    const ship = flagship(s.run);
    ship.pos = { x: 0, z: 2000 };
    s.run.bank.ore = 1000;
    runFor(s, DT, { commands: [{ t: 'install', shipId: ship.id, slot: 2, comp: 'shield', variant: 'standard' }] });
    expect(ship.slots[2]).toBeNull();
  });
});

describe('warp / prestige', () => {
  it('resets the run, keeps the profile and grants Horizon Data', () => {
    const s = newGame(11);
    s.run.runValue = 5000;
    s.run.bank.fuel = warpCost(s);
    s.run.bank.ore = 999;
    const gain = dataGain(s);
    expect(gain).toBeGreaterThan(0);
    const oldName = s.run.system.name;
    runFor(s, DT, { commands: [{ t: 'warp' }] });
    expect(s.profile.warps).toBe(1);
    expect(s.profile.data).toBe(gain);
    expect(s.run.system.number).toBe(2);
    expect(s.run.system.name).not.toBe(oldName);
    expect(s.run.bank.ore).toBeLessThan(999);
    expect(s.run.runValue).toBe(0);
  });

  it('prices the first warp on its own knob and later warps on the growth curve', () => {
    const s = newGame(11);
    expect(warpCost(s)).toBe(TUNING.firstWarpFuel);
    s.profile.warps = 1;
    expect(warpCost(s)).toBe(Math.round(TUNING.warpBaseFuel * TUNING.warpCostGrowth));
  });

  it('refuses to warp without fuel', () => {
    const s = newGame(12);
    runFor(s, DT, { commands: [{ t: 'warp' }] });
    expect(s.profile.warps).toBe(0);
  });

  it('perks apply to ship stats', () => {
    const s = newGame(13);
    const ship = flagship(s.run);
    const before = shipStats(ship, s.profile).dps;
    s.profile.data = 10;
    runFor(s, DT, { commands: [{ t: 'buyPerk', perk: 'optics' }] });
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
    runFor(s, 3);
    const back = deserialize(serialize(s))!;
    expect(serialize(back)).toEqual(serialize(s));
    for (const r of RESOURCES) expect(back.run.bank[r]).toBe(s.run.bank[r]);
  });

  it('export text imports back to the same rounded state', () => {
    const s = newGame(77);
    runFor(s, 2);
    const text = exportText(s, 1234);
    const res = parseImport(text);
    if (!res.ok) throw new Error(`import failed: ${res.error}`);
    expect(res.record.savedAt).toBe(1234);
    // Export rounds floats, so re-exporting the imported state reproduces the text exactly.
    expect(exportText(res.record.state, 1234)).toEqual(text);
    // A bare serialized state is accepted too.
    expect(parseImport(serialize(s)).ok).toBe(true);
  });

  it('import explains what is wrong', () => {
    expect(parseImport('{oops')).toEqual({ ok: false, error: 'Not valid JSON.' });
    expect(parseImport('{"format":"amh-save","state":{"version":1}}')).toEqual({
      ok: false,
      error: expect.stringMatching(/version 1/),
    });
    expect(parseImport('{"hello":"world"}').ok).toBe(false);
  });

  it('rejects foreign data', () => {
    expect(deserialize('{"version":1}')).toBeNull();
    expect(deserialize('not json')).toBeNull();
  });
});

describe('multiple games', () => {
  it('ticks two games independently when interleaved', () => {
    const input = { thrust: { x: 0, z: 0 }, commands: [] as Command[] };
    const a1 = newGame(101),
      a2 = newGame(202); // interleaved pair
    const b1 = newGame(101),
      b2 = newGame(202); // sequential pair, same seeds
    const i1 = new SimIndex(),
      i2 = new SimIndex();
    const j1 = new SimIndex(),
      j2 = new SimIndex();
    for (let t = 0; t < 10; t += DT) {
      tick(a1, DT, input, i1);
      tick(a2, DT, input, i2);
    }
    runFor(b1, 10, { index: j1 });
    runFor(b2, 10, { index: j2 });
    expect(serialize(a1)).toEqual(serialize(b1));
    expect(serialize(a2)).toEqual(serialize(b2));
    // Distinct instances: a shared index would still pass the equality checks
    // above, since `tick` rebuilds the index from its own state every tick.
    expect(i1).not.toBe(i2);
    expect(i1.rockHash).not.toBe(i2.rockHash);
  });
});

describe('ship loss', () => {
  it('flags a drone removal and a flagship rebuild with the same identity', () => {
    const state = newGame(2);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone', {
      x: 200,
      z: 0,
    });
    state.run.ships.push(drone);
    state.out.log.length = 0;

    damageShip(state, drone, 9999);
    expect(state.run.ships).not.toContain(drone);
    expect(state.out.log.at(-1)).toMatchObject({
      level: 'major',
      event: 'shipLoss',
    });

    const flagshipShip = state.run.ships.find(isFlagship)!;
    state.out.log.length = 0;
    damageShip(state, flagshipShip, 9999);
    expect(flagshipShip.respawn).toBeGreaterThan(0);
    expect(state.out.log.at(-1)).toMatchObject({
      level: 'major',
      event: 'shipLoss',
    });
  });
});
