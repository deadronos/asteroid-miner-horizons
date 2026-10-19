import { describe, expect, it } from 'vitest';
import { walletTotal } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { outpostAt, transfer } from '../src/sim/automation';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { flagship, isDrone, isFlagship, isHauler, makeShip } from '../src/sim/ships';
import type { GameState, Rock, Ship } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';
import { DT, runFor, send } from './helpers';

/** A plain large rock, with the flagship parked just off its surface and the bank able to pay. */
function setup(seed = 1): { s: GameState; rock: Rock; fs: Ship } {
  const s = newGame(seed);
  const rock = s.run.rocks.find((r) => r.size === 0 && !r.trait)!;
  const fs = flagship(s.run);
  fs.pos = { x: rock.pos.x + rock.radius + 20, z: rock.pos.z };
  s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 1000, fuel: 0 };
  return { s, rock, fs };
}

const lastLog = (s: GameState) => s.out.log.at(-1);

describe('ship roles', () => {
  it('classifies flagship, drone and hauler hulls', () => {
    const s = newGame(1);
    const at = s.run.system.station.pos;
    const drone = makeShip(s.run, s.profile, 'drone', 'D', at);
    const harvester = makeShip(s.run, s.profile, 'harvester', 'V', at);
    const hauler = makeShip(s.run, s.profile, 'hauler', 'H', at);
    const fs = flagship(s.run);
    expect([isFlagship(fs), isDrone(fs), isHauler(fs)]).toEqual([true, false, false]);
    expect([isFlagship(drone), isDrone(drone), isHauler(drone)]).toEqual([false, true, false]);
    expect([isFlagship(harvester), isDrone(harvester), isHauler(harvester)]).toEqual([false, true, false]);
    expect([isFlagship(hauler), isDrone(hauler), isHauler(hauler)]).toEqual([false, false, true]);
  });
});

describe('deployOutpost', () => {
  it('pays, records an outpost sized from the rock and leaves the rock intact', () => {
    const { s, rock } = setup();
    const units = rock.units;
    send(s, { t: 'deployOutpost', rockId: rock.id });
    const o = outpostAt(s, rock.id)!;
    expect(o).toBeDefined();
    expect(o.kind).toBe(rock.kind);
    expect(o.reserve).toBe(units * TUNING.outpostReserveMul);
    expect(walletTotal(o.stored)).toBe(0);
    expect(rock.units).toBe(units);
    expect(s.run.bank.ore).toBe(1000 - TUNING.outpostCost.ore);
    expect(s.run.bank.alloy).toBe(1000 - TUNING.outpostCost.alloy);
    expect(lastLog(s)).toMatchObject({ level: 'info' });
  });

  it('clears mine orders and drone targets on the host rock', () => {
    const { s, rock, fs } = setup();
    const drone = makeShip(s.run, s.profile, 'drone', 'Drone-1', fs.pos);
    s.run.ships.push(drone);
    fs.order = { kind: 'mine', rockId: rock.id };
    drone.aiTargetId = rock.id;
    send(s, { t: 'deployOutpost', rockId: rock.id });
    expect(fs.order).toBeNull();
    expect(drone.aiTargetId).toBeNull();
  });

  it.each([
    ['a small rock', (x: ReturnType<typeof setup>) => (x.rock.size = 2)],
    ['a comet', (x: ReturnType<typeof setup>) => (x.rock.comet = true)],
    ['a distant flagship', (x: ReturnType<typeof setup>) => (x.fs.pos = { x: 1e5, z: 1e5 })],
    ['a dead flagship', (x: ReturnType<typeof setup>) => (x.fs.respawn = 3)],
    ['an empty bank', (x: ReturnType<typeof setup>) => (x.s.run.bank.alloy = 0)],
  ])('rejects %s with a warning and changes nothing', (_label, spoil) => {
    const x = setup();
    spoil(x);
    const bank = { ...x.s.run.bank };
    send(x.s, { t: 'deployOutpost', rockId: x.rock.id });
    expect(x.s.run.automation.outposts).toEqual([]);
    expect(x.s.run.bank).toEqual(bank);
    expect(lastLog(x.s)).toMatchObject({ level: 'warn' });
  });

  it('rejects a second outpost on the same rock, a missing rock and going past the limit', () => {
    const { s, rock, fs } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    const bank = { ...s.run.bank };
    send(s, { t: 'deployOutpost', rockId: rock.id });
    send(s, { t: 'deployOutpost', rockId: -1 });
    expect(s.run.automation.outposts).toHaveLength(1);
    expect(s.run.bank).toEqual(bank);

    const others = s.run.rocks.filter((r) => r.size === 0 && r !== rock).slice(0, TUNING.outpostMax);
    for (const r of others) {
      fs.pos = { x: r.pos.x + r.radius + 20, z: r.pos.z };
      send(s, { t: 'deployOutpost', rockId: r.id });
    }
    expect(s.run.automation.outposts).toHaveLength(TUNING.outpostMax);
    expect(lastLog(s)?.text).toMatch(/limit/);
  });

  it('makes the mine command refuse the host rock', () => {
    const { s, rock, fs } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    send(s, { t: 'mine', shipId: fs.id, rockId: rock.id });
    expect(fs.order).toBeNull();
    expect(lastLog(s)).toMatchObject({ level: 'warn' });
  });
});

describe('outposts', () => {
  it('extract at their rate into storage, follow the rock and never touch its units', () => {
    const { s, rock } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    const o = outpostAt(s, rock.id)!;
    const units = rock.units;
    const reserve = o.reserve;
    runFor(s, 10);
    expect(o.stored[rock.kind]).toBeCloseTo(TUNING.outpostRate * 10, 1);
    expect(o.reserve + o.stored[rock.kind]).toBeCloseTo(reserve, 6);
    expect(s.run.automation.extracted).toBeCloseTo(o.stored[rock.kind], 6);
    expect(rock.units).toBe(units);
    expect(o.pos).toEqual(rock.pos);
  });

  it('stall at capacity until collected', () => {
    const { s, rock } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    runFor(s, TUNING.outpostCapacity / TUNING.outpostRate + 30);
    expect(walletTotal(outpostAt(s, rock.id)!.stored)).toBeCloseTo(TUNING.outpostCapacity, 6);
  });

  it('apply the yield perk to what they extract', () => {
    const { s, rock } = setup();
    s.profile.perks.yield = 2;
    send(s, { t: 'deployOutpost', rockId: rock.id });
    runFor(s, 10);
    expect(outpostAt(s, rock.id)!.stored[rock.kind]).toBeCloseTo(TUNING.outpostRate * 10 * 1.2, 1);
  });

  it('are dismantled once the reserve and storage are both empty', () => {
    const { s, rock } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    const o = outpostAt(s, rock.id)!;
    o.reserve = 0.1;
    runFor(s, 1);
    expect(o.reserve).toBe(0);
    expect(outpostAt(s, rock.id)).toBeDefined(); // still holding what it extracted
    o.stored[rock.kind] = 0;
    runFor(s, DT);
    expect(outpostAt(s, rock.id)).toBeUndefined();
    expect(s.run.rocks).toContain(rock);
  });

  it('do not draw from run.rng', () => {
    const a = setup();
    const b = setup();
    send(a.s, { t: 'deployOutpost', rockId: a.rock.id });
    b.s.run.bank = { ...a.s.run.bank };
    runFor(a.s, 5);
    runFor(b.s, 5);
    expect(a.s.run.rng.s).toBe(b.s.run.rng.s);
  });

  it('are left alone by mining drones', () => {
    const { s, rock, fs } = setup();
    send(s, { t: 'deployOutpost', rockId: rock.id });
    // Every other rock is gone, so the host is the only one in reach.
    s.run.rocks = [rock];
    const drone = makeShip(s.run, s.profile, 'drone', 'Drone-1', fs.pos);
    s.run.ships.push(drone);
    runFor(s, 3);
    expect(drone.aiTargetId).toBeNull();
    expect(drone.beamOn).toBe(false);
  });
});

describe('transfer', () => {
  it('moves at most the budget and conserves units', () => {
    const from = { ore: 3, ice: 4, crystal: 0, alloy: 0, fuel: 0 };
    const to = { ore: 1, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    expect(transfer(from, to, 5)).toBe(5);
    expect(from).toEqual({ ore: 0, ice: 2, crystal: 0, alloy: 0, fuel: 0 });
    expect(to).toEqual({ ore: 4, ice: 2, crystal: 0, alloy: 0, fuel: 0 });
    expect(transfer(from, to, 10)).toBe(2);
  });
});

/** A fresh game with every rock cleared away, the flagship parked at the station and one hauler beside it. */
function haulerSetup(): { s: GameState; hauler: Ship } {
  const s = newGame(1);
  s.run.rocks = [];
  const st = s.run.system.station.pos;
  flagship(s.run).pos = { ...st };
  const hauler = makeShip(s.run, s.profile, 'hauler', 'Hauler-1', { x: st.x + 20, z: st.z });
  s.run.ships.push(hauler);
  return { s, hauler };
}

describe('haulers', () => {
  it('carry a mining drone’s load to the station without losing a unit', () => {
    const { s, hauler } = haulerSetup();
    const st = s.run.system.station.pos;
    const drone = makeShip(s.run, s.profile, 'drone', 'Drone-1', { x: st.x + 500, z: st.z });
    drone.cargo.ore = 30; // 75% of a 40-unit hold
    s.run.ships.push(drone);
    const total = (): number => walletTotal(drone.cargo) + walletTotal(hauler.cargo) + s.run.bank.ore;
    const before = total();
    let loaded = false;
    const index = new SimIndex();
    const input: TickInput = { thrust: { x: 0, z: 0 }, commands: [] };
    for (let t = 0; t < 40 && s.run.bank.ore < before - 1; t += DT) {
      tick(s, DT, input, index);
      if (hauler.cargo.ore > 0) loaded = true;
      expect(total()).toBeCloseTo(before, 6);
    }
    expect(loaded).toBe(true);
    expect(s.run.bank.ore).toBeCloseTo(before, 6);
    expect(walletTotal(hauler.cargo)).toBe(0);
  });

  it('ignore a drone carrying less than their pickup threshold', () => {
    const { s, hauler } = haulerSetup();
    const st = s.run.system.station.pos;
    const drone = makeShip(s.run, s.profile, 'drone', 'Drone-1', { x: st.x + 500, z: st.z });
    drone.cargo.ore = 40 * TUNING.haulMinShare - 1;
    s.run.ships.push(drone);
    runFor(s, 2);
    expect(hauler.aiTargetId).toBeNull();
  });

  it('empty an outpost and unload it at the station', () => {
    const { s } = haulerSetup();
    const g = newGame(1);
    const rock = g.run.rocks.find((r) => r.size === 0 && !r.trait)!;
    s.run.rocks = [rock];
    s.run.automation.outposts.push({
      rockId: rock.id,
      kind: rock.kind,
      pos: { ...rock.pos },
      stored: { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0, [rock.kind]: 50 },
      reserve: 0,
    });
    const bank = s.run.bank[rock.kind];
    runFor(s, 90);
    expect(s.run.automation.outposts).toEqual([]); // emptied with no reserve left: dismantled
    expect(s.run.bank[rock.kind]).toBeCloseTo(bank + 50, 6);
  });

  it('wait by the station when there is nothing to haul', () => {
    const { s, hauler } = haulerSetup();
    runFor(s, 5);
    expect(hauler.aiTargetId).toBeNull();
    const d = Math.hypot(hauler.pos.x - s.run.system.station.pos.x, hauler.pos.z - s.run.system.station.pos.z);
    expect(d).toBeLessThan(200);
  });
});

describe('idle automation', () => {
  it('keeps earning with the flagship parked at the station', () => {
    const s = newGame(1000);
    const st = s.run.system.station.pos;
    const fs = flagship(s.run);
    fs.pos = { ...st };
    s.profile.perks.bay = 1;
    for (const name of ['Drone-1', 'Drone-2']) s.run.ships.push(makeShip(s.run, s.profile, 'drone', name, st));
    const hauler = makeShip(s.run, s.profile, 'hauler', 'Hauler-1', st);
    s.run.ships.push(hauler);
    let haulerValue = 0;
    const index = new SimIndex();
    const input: TickInput = { thrust: { x: 0, z: 0 }, commands: [] };
    for (let t = 0; t < 300; t += DT) {
      tick(s, DT, input, index);
      for (const f of s.out.fx) if (f.t === 'dock' && f.shipId === hauler.id) haulerValue += f.value;
      s.out.fx.length = 0;
    }
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(haulerValue).toBeGreaterThan(0);
  });
});
