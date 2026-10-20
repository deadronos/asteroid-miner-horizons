import { describe, expect, it } from 'vitest';
import { variantDef } from '../src/data/components';
import { HULLS } from '../src/data/hulls';
import { TUNING } from '../src/data/tuning';
import { DEFAULT_FLEET_AUTO } from '../src/sim/assists';
import { newGame } from '../src/sim/create';
import { isDocked, repairCost, slotCost } from '../src/sim/economy';
import { BUILD_ORDER, cheapestStep, nextBuildType, serviceDocked } from '../src/sim/fleetAuto';
import { SimIndex } from '../src/sim/index';
import { flagship, makeShip, shipStats } from '../src/sim/ships';
import type { GameState, Ship } from '../src/sim/types';
import { runTicks, send } from './helpers';

const bank = (n: number) => ({ ore: n, ice: n, crystal: n, alloy: n, fuel: n });

/** A game with one drone parked at the station and the flagship out of the way. */
function docked(hullId: 'drone' | 'hauler' = 'drone'): { s: GameState; d: Ship } {
  const s = newGame(1);
  s.run.rocks = [];
  flagship(s.run).pos = { x: 1e5, z: 1e5 };
  const d = makeShip(s.run, s.profile, hullId, 'Drone-1', { ...s.run.system.station.pos });
  s.run.ships.push(d);
  return { s, d };
}

const service = (s: GameState, d: Ship, auto = DEFAULT_FLEET_AUTO) =>
  serviceDocked(s, new SimIndex(), d, shipStats(d, s.profile), auto);

describe('build order', () => {
  it('fills a drone laser-first and a hauler cargo-first, counting what is already fitted', () => {
    const { s, d } = docked();
    expect(nextBuildType(d)).toBe('cargo'); // the loadout's laser takes the first place
    d.slots[1] = { type: 'cargo', variant: 'standard', tier: 1 };
    expect(nextBuildType(d)).toBe('engine');
    const h = makeShip(s.run, s.profile, 'hauler', 'Hauler-1', { x: 0, z: 0 });
    expect(nextBuildType(h)).toBe('cargo'); // the hauler's engine counts toward its second place
  });
});

describe('cheapestStep', () => {
  it('picks the lowest-value affordable step', () => {
    const { d } = docked();
    // Empty slot 1 → a T1 cargo pod (cheaper than taking the laser to T2).
    expect(cheapestStep(d, bank(1e4), 0)).toMatchObject({ step: { kind: 'install', slot: 1, type: 'cargo' } });
  });

  it('keeps the reserve: nothing is affordable when the bank is at the reserve', () => {
    const { d } = docked();
    expect(cheapestStep(d, bank(100), 100)).toBeNull();
    expect(cheapestStep(d, bank(100 + 20), 100)).not.toBeNull();
  });

  it('buys a slot once every slot is filled and the slot is the cheapest step', () => {
    const { d } = docked();
    d.slots = [
      { type: 'laser', variant: 'focused', tier: 3 },
      { type: 'cargo', variant: 'standard', tier: 3 },
    ];
    expect(cheapestStep(d, bank(1e4), 0)).toEqual({ step: { kind: 'slot' }, cost: slotCost(d) });
  });
});

describe('serviceDocked', () => {
  it('does nothing with both toggles off', () => {
    const { s, d } = docked();
    d.hull = 1;
    s.run.bank = bank(1e4);
    service(s, d);
    expect(d.hull).toBe(1);
    expect(d.slots[1]).toBeNull();
    expect(s.run.bank).toEqual(bank(1e4));
  });

  it('autorepair repairs fully and debits the ore', () => {
    const { s, d } = docked();
    d.autoRepair = true;
    d.hull = 10;
    s.run.bank = bank(1e4);
    const ore = repairCost(s, d);
    service(s, d);
    expect(d.hull).toBe(shipStats(d, s.profile).maxHull);
    expect(s.run.bank.ore).toBe(1e4 - ore);
  });

  it('waits for money above the reserve, warns once, and does not upgrade meanwhile', () => {
    const { s, d } = docked();
    d.autoRepair = true;
    d.autoUpgrade = true;
    d.hull = 1;
    s.run.bank = { ...bank(1e4), ore: 105 }; // under the reserve once the repair is paid
    const index = new SimIndex();
    const st = shipStats(d, s.profile);
    serviceDocked(s, index, d, st, DEFAULT_FLEET_AUTO);
    serviceDocked(s, index, d, st, DEFAULT_FLEET_AUTO);
    expect(d.hull).toBe(1);
    expect(d.slots[1]).toBeNull();
    expect(s.out.log.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('autoupgrade takes one step per call and never touches a fitted part', () => {
    const { s, d } = docked();
    d.autoUpgrade = true;
    s.run.bank = bank(1e4);
    const laser = d.slots[0];
    service(s, d);
    expect(d.slots[1]).toEqual({ type: 'cargo', variant: 'standard', tier: 1 });
    expect(s.run.bank.ore).toBe(1e4 - variantDef('cargo', 'standard').cost(1).ore!);
    expect(d.slots[0]).toBe(laser);
    // Only the player's own installs count toward the stat (and the first-steps goal).
    expect(s.profile.stats.installs).toBe(0);
  });

  it('waits autoUpgradeInterval between steps on the same ship', () => {
    const { s, d } = docked();
    d.autoUpgrade = true;
    s.run.bank = bank(1e6);
    const index = new SimIndex();
    const step = () => serviceDocked(s, index, d, shipStats(d, s.profile), DEFAULT_FLEET_AUTO);
    const steps = () => s.out.log.filter((l) => l.text.startsWith(d.name)).length;
    step();
    step();
    expect(steps()).toBe(1);
    s.run.time += TUNING.autoUpgradeInterval;
    step();
    expect(steps()).toBe(2);
  });

  it('grows a ship to its slot cap given enough money', () => {
    const { s, d } = docked();
    d.autoUpgrade = true;
    s.run.bank = bank(1e6);
    for (let i = 0; i < 100; i++) service(s, d); // a fresh index each call, so no interval
    expect(d.slots).toHaveLength(HULLS.drone.maxSlots);
    expect(d.slots.every((f) => f?.tier === 3)).toBe(true);
    expect(new Set(d.slots.map((f) => f!.type))).toEqual(new Set(BUILD_ORDER.drone)); // one of each type
  });
});

describe('autorepair trip', () => {
  it('a damaged drone below the threshold flies home, repairs and resumes', () => {
    const { s, d } = docked();
    d.pos = { x: s.run.system.station.pos.x + 600, z: s.run.system.station.pos.z };
    d.autoRepair = true;
    d.hull = shipStats(d, s.profile).maxHull * 0.3;
    s.run.bank = bank(1e4);
    let docks = false;
    for (let i = 0; i < 60 * 30 && !docks; i++) {
      runTicks(s, 1);
      docks = isDocked(s.run, d);
    }
    expect(docks).toBe(true);
    runTicks(s, 1);
    expect(d.hull).toBe(shipStats(d, s.profile).maxHull);
  });

  it('a drone above the threshold keeps working', () => {
    const { s, d } = docked();
    const far = { x: s.run.system.station.pos.x + 600, z: s.run.system.station.pos.z };
    d.pos = { ...far };
    d.autoRepair = true;
    d.hull = shipStats(d, s.profile).maxHull * 0.8;
    d.order = { kind: 'move', to: { x: far.x + 200, z: far.z } };
    runTicks(s, 60);
    expect(d.pos.x).toBeGreaterThan(far.x);
  });
});

describe('shipAuto command', () => {
  it('toggles a drone and rejects the flagship', () => {
    const { s, d } = docked();
    send(s, { t: 'shipAuto', shipId: d.id, kind: 'repair', on: true });
    send(s, { t: 'shipAuto', shipId: d.id, kind: 'upgrade', on: true });
    expect([d.autoRepair, d.autoUpgrade]).toEqual([true, true]);
    send(s, { t: 'shipAuto', shipId: d.id, kind: 'upgrade', on: false });
    expect(d.autoUpgrade).toBe(false);
    const fs = flagship(s.run);
    send(s, { t: 'shipAuto', shipId: fs.id, kind: 'repair', on: true });
    expect(fs.autoRepair).toBe(false);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });
});
