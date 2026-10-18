import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTS } from '../src/sim/assists';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { chainTarget, droneThink, steer, type TickCtx } from '../src/sim/pilot';
import { makeShip } from '../src/sim/ships';

const DT = 1 / 60;

function ctxFor(state: ReturnType<typeof newGame>): TickCtx {
  const index = new SimIndex();
  index.rebuild(state);
  return { state, index, dt: DT, assists: DEFAULT_ASSISTS, hazards: 'off' };
}

describe('pilot scratch reuse', () => {
  it('steer writes its avoidance result into the shared index scratch', () => {
    const state = newGame(1);
    const ctx = ctxFor(state);
    const ship = state.run.ships[0]!;
    state.run.rocks.push(makeRock(state.run, 'ore', 0, { x: ship.pos.x + 40, z: ship.pos.z }, 30, 0));
    ctx.index.rebuild(state);
    const scratch = ctx.index.avoid;
    const st = ctx.index.stats.get(ship.id)!;
    steer(ctx, ship, st, 1, 0, true);
    expect(ctx.index.avoid).toBe(scratch);
    // A rock 40 units ahead (radius 30) is in the corridor and nearly touching,
    // so avoidance must push back/sideways — not just produce a finite number.
    expect(Math.hypot(ctx.index.avoid.x, ctx.index.avoid.z)).toBeGreaterThan(0);
  });

  it('droneThink writes its home slot into the shared index scratch', () => {
    const state = newGame(1);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 100, z: 0 });
    state.run.ships.push(drone);
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(drone.id)!;
    const scratch = ctx.index.home;
    droneThink(ctx, drone, st);
    expect(ctx.index.home).toBe(scratch);
    expect(Number.isFinite(ctx.index.home.x)).toBe(true);
    expect(Number.isFinite(ctx.index.home.z)).toBe(true);
  });
});

describe('chainTarget', () => {
  it('chains onto the closest fragment inside laser reach', () => {
    const state = newGame(1);
    const ship = state.run.ships[0]!;
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(ship.id)!;
    const near = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range, z: ship.pos.z }, 2, 0);
    const far = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range * 5, z: ship.pos.z }, 2, 0);
    expect(chainTarget(ctx, ship, st, [far, near])).toBe(near.id);
  });

  it('falls back to the nearest rock when no fragment is in reach', () => {
    const state = newGame(1);
    state.run.rocks = [];
    const ship = state.run.ships[0]!;
    const rock = makeRock(state.run, 'ore', 0, { x: ship.pos.x + 50, z: ship.pos.z }, 30, 0);
    state.run.rocks.push(rock);
    const ctx = ctxFor(state);
    const st = ctx.index.stats.get(ship.id)!;
    const far = makeRock(state.run, 'ore', 2, { x: ship.pos.x + st.range * 5, z: ship.pos.z }, 2, 0);
    expect(chainTarget(ctx, ship, st, [far])).toBe(rock.id);
  });
});
