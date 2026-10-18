import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { destroyRock } from '../src/sim/mining';
import { damageShip, flagship, makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';

const DT = 1 / 60;

/** Ticks `state` with no input for `seconds` (default: one tick). */
function runTick(state: GameState, seconds = DT): void {
  const index = new SimIndex();
  const input: TickInput = { thrust: { x: 0, z: 0 }, commands: [] };
  for (let t = 0; t < seconds; t += DT) tick(state, DT, input, index);
}

/** A pickup at `5000 + id`, with the given age. */
function mk(id: number, age: number) {
  return {
    id,
    kind: 'ore' as const,
    amount: 1,
    pos: { x: 5000 + id, z: 5000 },
    vel: { x: 0, z: 0 },
    age,
  };
}

describe('in-place ship removal', () => {
  it('damageShip keeps the ships array identity', () => {
    const state = newGame(1);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
    state.run.ships.push(drone);
    const ships = state.run.ships;
    damageShip(state, drone, 1e6);
    expect(state.run.ships).toBe(ships); // not reassigned by a filter
    expect(ships).not.toContain(drone);
  });

  it('still updates every surviving ship when one dies mid-loop', () => {
    const state = newGame(1); // system 1 is class G: starRadius 75, heatRadius 150
    const run = state.run;
    run.rocks = [];
    for (const ship of run.ships) ship.pos = { x: 1e5, z: 1e5 }; // flagship out of the star's heat
    const drones = [0, 1, 2].map((i) => {
      const d = makeShip(run, state.profile, 'drone', `Drone-${i}`, { x: 100, z: i * 4 });
      d.hull = 100;
      run.ships.push(d);
      return d;
    });
    drones[1]!.hull = 0.01; // dies to star heat (30 dps at ~0.67 falloff ≈ 0.33 hull/tick)
    runTick(state);
    expect(run.ships).not.toContain(drones[1]);
    expect(drones[0]!.hull).toBeLessThan(100);
    expect(drones[2]!.hull).toBeLessThan(100); // the ship after the removed one still ran
  });
});

describe('in-place rock removal', () => {
  it('destroyRock keeps the rocks array identity and order', () => {
    const state = newGame(1);
    const rocks = state.run.rocks;
    expect(rocks.length).toBeGreaterThan(10);
    const target = rocks[5]!;
    const next = rocks[6]!;
    const before = rocks.length;
    const frags = destroyRock(state, target);
    expect(state.run.rocks).toBe(rocks); // no reassignment
    expect(rocks[5]).toBe(next); // the next rock shifted into the freed slot
    expect(rocks).not.toContain(target);
    expect(rocks.length).toBe(before - 1 + frags.length); // fragments are appended
    expect(rocks.slice(before - 1)).toEqual(frags); // ...after the survivors, in order
  });
});

describe('pickups tick in place', () => {
  it('keeps the pickups array identity over a tick', () => {
    const state = newGame(1);
    state.run.pickups = [{ id: 1, kind: 'ore', amount: 1, pos: { x: 5000, z: 5000 }, vel: { x: 0, z: 0 }, age: 0 }];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups).toHaveLength(1);
  });

  it('drops expired pickups in place, preserving the order of the rest', () => {
    const state = newGame(1);
    state.run.pickups = [mk(1, 1), mk(2, TUNING.pickupLifetime + 1), mk(3, 3)];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups.map((p) => p.id)).toEqual([1, 3]);
  });

  it('ignores dead ships when pulling pickups', () => {
    const state = newGame(1);
    const fs = flagship(state.run);
    fs.respawn = 5; // not alive this tick
    state.run.pickups = [
      { id: 1, kind: 'ore', amount: 1, pos: { x: fs.pos.x + 10, z: fs.pos.z }, vel: { x: 0, z: 0 }, age: 0 },
    ];
    const pickups = state.run.pickups;
    runTick(state);
    expect(state.run.pickups).toBe(pickups);
    expect(pickups[0]!.vel).toEqual({ x: 0, z: 0 });
  });
});
