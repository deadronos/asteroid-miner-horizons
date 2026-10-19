import { describe, expect, it } from 'vitest';
import { FLARES } from '../src/data/hazards';
import { TUNING } from '../src/data/tuning';
import { DEFAULT_ASSISTS } from '../src/sim/assists';
import { newGame, newProfile, newRun, SAVE_VERSION } from '../src/sim/create';
import { isDocked } from '../src/sim/economy';
import { cometPathEscape } from '../src/sim/hazards';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { chainTarget, droneThink, steer, type TickCtx } from '../src/sim/pilot';
import { flagship, makeShip } from '../src/sim/ships';
import type { GameState, Ship, StarClass } from '../src/sim/types';
import { tick } from '../src/sim/update';

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

/** A game in system 2 (hazards scheduled) with no rocks, the flagship parked far away and one auto drone at `pos`. */
function hazardGame(starClass: StarClass, pos: { x: number; z: number }): { state: GameState; drone: Ship } {
  const profile = { ...newProfile(1), warps: 1 };
  const state: GameState = { version: SAVE_VERSION, profile, run: newRun(profile), out: { fx: [], log: [] } };
  state.run.system.starClass = starClass;
  state.run.rocks = [];
  flagship(state.run).pos = { x: 1e5, z: 1e5 };
  const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', pos);
  drone.aiMode = 'auto';
  state.run.ships.push(drone);
  return { state, drone };
}

function run(state: GameState, seconds: number): void {
  const index = new SimIndex();
  const input = { thrust: { x: 0, z: 0 }, commands: [], hazards: 'normal' as const };
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(state, DT, input, index);
}

describe('droneThink hazard reflexes', () => {
  it('docks near the station during a flare warning and stays docked, unhurt, through the flare', () => {
    const { state, drone } = hazardGame('M', { x: 0, z: 0 });
    const st = state.run.system.station.pos;
    drone.pos = { x: st.x * 1.14, z: st.z * 1.14 }; // inside the zone, closer to the station than the way out
    // Anchored to a flagship idling in the zone, so only the reflex takes it to the station.
    drone.aiMode = 'assist';
    flagship(state.run).pos = { ...drone.pos };
    const hull = drone.hull;
    state.run.hazards.flare = { phase: 'warning', timeLeft: TUNING.flareWarning };
    run(state, TUNING.flareWarning + 1);
    expect(state.run.hazards.flare?.phase).toBe('active');
    expect(isDocked(state.run, drone)).toBe(true);
    run(state, TUNING.flareDuration - 2);
    expect(isDocked(state.run, drone)).toBe(true);
    expect(drone.hull).toBe(hull);
  });

  it('flees past the flare reach when the station is the long way round', () => {
    const { state, drone } = hazardGame('M', { x: 0, z: 0 });
    const st = state.run.system.station.pos;
    drone.pos = { x: -st.x * 1.2, z: -st.z * 1.2 };
    const hull = drone.hull;
    state.run.hazards.flare = { phase: 'warning', timeLeft: TUNING.flareWarning };
    run(state, TUNING.flareWarning + TUNING.flareDuration - 1);
    expect(state.run.hazards.flare?.phase).toBe('active');
    expect(Math.hypot(drone.pos.x, drone.pos.z)).toBeGreaterThan(FLARES.M!.reach);
    expect(drone.hull).toBe(hull);
  });

  it('steps out of a pending comet path', () => {
    const { state, drone } = hazardGame('G', { x: 0, z: 610 });
    // Anchored to a flagship idling on the path, so only the reflex takes it off.
    drone.aiMode = 'assist';
    flagship(state.run).pos = { x: 0, z: 600 };
    state.run.hazards.comet = { from: { x: -3200, z: 600 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 8 };
    run(state, 3);
    expect(cometPathEscape(state.run, [], drone.pos, TUNING.cometDodgePad, { x: 0, z: 0 })).toBe(false);
    expect(drone.pos.z).toBeGreaterThan(600);
  });

  it('passes over a rock in a comet path for a farther one outside it', () => {
    const { state, drone } = hazardGame('G', { x: 0, z: 300 });
    drone.aiMode = 'assist';
    flagship(state.run).pos = { x: 0, z: 300 };
    state.run.hazards.comet = { from: { x: -3200, z: 0 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 8 };
    const inPath = makeRock(state.run, 'ore', 0, { x: 0, z: 60 }, 30, 0);
    const clear = makeRock(state.run, 'ore', 0, { x: 0, z: 600 }, 30, 0);
    state.run.rocks.push(inPath, clear);
    const ctx = ctxFor(state);
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(drone.aiTargetId).toBe(clear.id);
  });
});

/**
 * A tier-1 assist drone and a parked flagship at the origin, with no pickups
 * and no rocks.
 */
function droneGame(): { state: GameState; drone: Ship } {
  const state = newGame(1);
  state.run.pickups = [];
  state.run.rocks = [];
  const fs = flagship(state.run);
  fs.pos = { x: 0, z: 0 };
  fs.order = null;
  const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
  drone.aiMode = 'assist';
  state.run.ships.push(drone);
  return { state, drone };
}

describe('droneThink dense targets', () => {
  it('drops a reused aiTargetId it cannot cut and retargets a plain rock', () => {
    const { state, drone } = droneGame();
    const dense = makeRock(state.run, 'ore', 0, { x: 60, z: 0 }, 30, 0, 'dense');
    const plain = makeRock(state.run, 'ore', 0, { x: 200, z: 0 }, 30, 0);
    state.run.rocks.push(dense, plain);
    drone.aiTargetId = dense.id;
    const ctx = ctxFor(state);
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(drone.aiTargetId).toBe(plain.id);
    expect(drone.beamTargetId).not.toBe(dense.id);
  });

  it('does not adopt a flagship mine order on a dense rock it cannot cut', () => {
    const { state, drone } = droneGame();
    const dense = makeRock(state.run, 'ore', 0, { x: 60, z: 0 }, 30, 0, 'dense');
    const plain = makeRock(state.run, 'ore', 0, { x: 200, z: 0 }, 30, 0);
    state.run.rocks.push(dense, plain);
    flagship(state.run).order = { kind: 'mine', rockId: dense.id };
    const ctx = ctxFor(state);
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(drone.aiTargetId).toBe(plain.id);
  });
});
