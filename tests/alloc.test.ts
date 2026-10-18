import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { destroyRock } from '../src/sim/mining';
import { damageShip, makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { tick, type TickInput } from '../src/sim/update';

const DT = 1 / 60;

/** Ticks `state` with no input for `seconds` (default: one tick). */
function runTick(state: GameState, seconds = DT): void {
  const index = new SimIndex();
  const input: TickInput = { thrust: { x: 0, z: 0 }, commands: [] };
  for (let t = 0; t < seconds; t += DT) tick(state, DT, input, index);
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
  });
});
