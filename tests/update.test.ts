import { describe, expect, it } from 'vitest';
import { RESOURCES, walletValue, type Wallet } from '../src/data/resources';
import type { Command } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { flagship, makeShip, shipStats } from '../src/sim/ships';
import { applyCommands } from '../src/sim/update';
import { DT, runTicks } from './helpers';

describe('applyCommands', () => {
  it('applies queued commands in order and drains the queue', () => {
    const state = newGame(7);
    const ship = flagship(state.run);
    ship.order = { kind: 'move', to: { x: 10, z: 20 } };
    const commands: Command[] = [
      { t: 'stop', shipId: ship.id },
      { t: 'dock', shipId: ship.id },
    ];

    applyCommands(state, commands);

    expect(commands).toHaveLength(0);
    expect(ship.order).toEqual({ kind: 'dock' });
  });
});

describe('tick critical mutation paths', () => {
  it('rebuilds a flagship at the station when its respawn timer elapses', () => {
    const state = newGame(11);
    const ship = flagship(state.run);
    // The default loadout has no shield, so fit one or the shield check is 0 === 0.
    ship.slots[ship.slots.length - 1] = { type: 'shield', variant: 'standard', tier: 1 };
    const st = shipStats(ship, state.profile);
    expect(st.maxShield).toBeGreaterThan(0);
    ship.hull = 0;
    ship.shield = 0;
    ship.pos = { x: 4321, z: -987 };
    ship.respawn = DT / 2;

    runTicks(state, 1);

    expect(ship.respawn).toBe(0);
    expect(ship.pos).toEqual(state.run.system.station.pos);
    expect(ship.hull).toBe(st.maxHull);
    expect(ship.shield).toBe(st.maxShield);
    expect(state.out.log.some((l) => l.text.includes('rebuilt at the station'))).toBe(true);
  });

  it('unloads docked flagship cargo into the bank and records value exactly once', () => {
    const state = newGame(13);
    const ship = flagship(state.run);
    ship.pos = { ...state.run.system.station.pos };
    ship.cargo = { ore: 17, ice: 9, crystal: 2, alloy: 3, fuel: 0 };

    const cargoBefore: Wallet = { ...ship.cargo };
    const bankBefore: Wallet = { ...state.run.bank };
    const unloadsBefore = state.profile.stats.unloads;
    const runValueBefore = state.run.runValue;
    const value = walletValue(cargoBefore);

    runTicks(state, 1);

    for (const r of RESOURCES) {
      expect(ship.cargo[r]).toBe(0);
      expect(state.run.bank[r]).toBe(bankBefore[r] + cargoBefore[r]);
    }
    expect(state.run.runValue).toBe(runValueBefore + value);
    expect(state.profile.stats.unloads).toBe(unloadsBefore + 1);
    expect(state.out.fx.some((f) => f.t === 'dock' && f.shipId === ship.id && f.value === value)).toBe(true);
    expect(state.out.log.some((l) => l.text.includes('unloaded'))).toBe(true);
  });

  it('warns about overheating only when crossing a 3-second boundary', () => {
    const state = newGame(17);
    const ship = flagship(state.run);
    ship.pos = { x: state.run.system.starRadius + 1, z: 0 };
    ship.vel = { x: 0, z: 0 };
    state.run.time = 2.99;

    runTicks(state, 1);

    expect(state.out.log.some((l) => l.text.includes('overheating near the star'))).toBe(true);

    state.out.log.length = 0;
    state.run.time = 3.1;
    runTicks(state, 1);

    expect(state.out.log.some((l) => l.text.includes('overheating near the star'))).toBe(false);

    // Crossing into second 4 is a boundary, but not a multiple of 3.
    state.run.time = 3.99;
    runTicks(state, 1);

    expect(state.out.log.some((l) => l.text.includes('overheating near the star'))).toBe(false);
  });

  it('warns about overheating only for the selected ship', () => {
    const state = newGame(17);
    const ship = flagship(state.run);
    const nearStar = { x: state.run.system.starRadius + 1, z: 0 };
    ship.pos = { ...nearStar };
    ship.vel = { x: 0, z: 0 };
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone', nearStar);
    state.run.ships.push(drone);
    state.run.time = 2.99;

    runTicks(state, 1);

    const warnings = state.out.log.filter((l) => l.text.includes('overheating near the star'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.text).toContain(ship.name);
  });

  it('applies one impact hit, then suppresses repeats while collision cooldown is active', () => {
    const state = newGame(19);
    const ship = flagship(state.run);
    ship.pos = { x: 1000, z: 0 };
    ship.vel = { x: 200, z: 0 };
    ship.collisionCd = 0;
    ship.order = null;

    state.run.rocks = [];
    const rock = makeRock(state.run, 'ore', 0, { x: 1005, z: 0 }, 12, 0);
    rock.vel = { x: 0, z: 0 };
    rock.comet = true;
    state.run.rocks.push(rock);

    const index = new SimIndex();
    const durabilityBefore = ship.hull + ship.shield;
    runTicks(state, 1, { index });

    const impactsAfterFirst = state.out.fx.filter((f) => f.t === 'impact');
    const durabilityAfterFirst = ship.hull + ship.shield;
    expect(impactsAfterFirst).toHaveLength(1);
    expect(durabilityAfterFirst).toBeLessThan(durabilityBefore);
    expect(ship.collisionCd).toBeGreaterThan(0);

    ship.pos = { x: 1000, z: 0 };
    ship.vel = { x: 200, z: 0 };
    runTicks(state, 1, { index });

    expect(state.out.fx.filter((f) => f.t === 'impact')).toHaveLength(1);
    expect(ship.hull + ship.shield).toBeGreaterThanOrEqual(durabilityAfterFirst);

    // Once the cooldown runs out, the next impact lands. Each bounce pushes the
    // ship clear, so put it back on a collision course every tick.
    for (let i = 0; i < 60 && state.out.fx.filter((f) => f.t === 'impact').length < 2; i++) {
      ship.pos = { x: 1000, z: 0 };
      ship.vel = { x: 200, z: 0 };
      runTicks(state, 1, { index });
    }

    expect(state.out.fx.filter((f) => f.t === 'impact')).toHaveLength(2);
  });
});
