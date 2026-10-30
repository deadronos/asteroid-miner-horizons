import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO } from '../src/sim/assists';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { SimIndex } from '../src/sim/index';
import { haulerThink } from '../src/sim/automation';
import { droneThink, type TickCtx } from '../src/sim/pilot';
import { flagship, makeShip } from '../src/sim/ships';
import { setStatus } from '../src/sim/status';
import type { GameState, Ship } from '../src/sim/types';
import { formatStatus } from '../src/ui/panels/FleetPanel';
import { DT, runTicks } from './helpers';

/** A game with no rocks, the flagship far away and one auto drone at `pos`. */
function setup(pos = { x: 300, z: 0 }): { state: GameState; drone: Ship; ctx: TickCtx } {
  const state = newGame(1);
  state.run.rocks = [];
  flagship(state.run).pos = { x: 1e5, z: 1e5 };
  const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', pos);
  drone.aiMode = 'auto';
  state.run.ships.push(drone);
  const index = new SimIndex();
  index.rebuild(state);
  const ctx: TickCtx = { state, index, dt: DT, assists: DEFAULT_ASSISTS, auto: DEFAULT_FLEET_AUTO, hazards: 'off' };
  return { state, drone, ctx };
}

describe('ship status', () => {
  it('drone mining reports mining with the rock kind', () => {
    const { state, drone } = setup();
    const at = state.run.system.station.pos;
    drone.pos = { x: at.x + 100, z: at.z };
    state.run.rocks.push(makeRock(state.run, 'ice', 0, { x: at.x + 300, z: at.z }, 30, 0));
    const index = new SimIndex();
    for (let i = 0; i < 1200 && !drone.beamOn; i++) runTicks(state, 1, { index });
    expect(drone.beamOn).toBe(true);
    expect(state.out.status.get(drone.id)).toEqual({ kind: 'mining', reason: null, rockKind: 'ice', large: true });
  });

  it('full drone reports returning', () => {
    const { state, drone, ctx } = setup();
    drone.cargo.ore = 1e6;
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(state.out.status.get(drone.id)?.kind).toBe('returning');
  });

  it('hauler with nothing to collect reports idle/nothingToHaul', () => {
    const { state, ctx } = setup();
    const hauler = makeShip(state.run, state.profile, 'hauler', 'Hauler-1', { x: 200, z: 0 });
    state.run.ships.push(hauler);
    ctx.index.rebuild(state);
    haulerThink(ctx, hauler, ctx.index.stats.get(hauler.id)!);
    expect(state.out.status.get(hauler.id)).toMatchObject({ kind: 'idle', reason: 'nothingToHaul' });
  });

  it('hauler holding cargo with auto-dock off reports idle/holdLoaded', () => {
    const { state, ctx } = setup();
    const hauler = makeShip(state.run, state.profile, 'hauler', 'Hauler-1', { x: 200, z: 0 });
    hauler.cargo.ore = 5;
    state.run.ships.push(hauler);
    ctx.index.rebuild(state);
    ctx.assists = { ...DEFAULT_ASSISTS, autoDock: false };
    haulerThink(ctx, hauler, ctx.index.stats.get(hauler.id)!);
    expect(state.out.status.get(hauler.id)).toMatchObject({ kind: 'idle', reason: 'holdLoaded' });
    expect(formatStatus(state.out.status.get(hauler.id)!, 0.1)).toContain('hold loaded, waiting for a dock order');
  });

  it('docked drone that cannot afford repair above the reserve reports idle/repairMoney', () => {
    const { state, drone } = setup();
    const st = state.run.system.station.pos;
    drone.pos = { x: st.x, z: st.z };
    drone.autoRepair = true;
    drone.hull = 1;
    state.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    const index = new SimIndex();
    runTicks(state, 3, { index });
    expect(index.repairWait.has(drone.id)).toBe(true);
    expect(state.out.status.get(drone.id)).toMatchObject({ kind: 'idle', reason: 'repairMoney' });
    // With money, it repairs and flies on.
    state.run.bank.ore = 1e6;
    runTicks(state, 3, { index });
    expect(state.out.status.get(drone.id)?.reason).not.toBe('repairMoney');
  });

  it('drone in a comet path reports avoidComet', () => {
    const { state, drone, ctx } = setup({ x: 0, z: 610 });
    state.run.hazards.comet = { from: { x: -3200, z: 610 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 8 };
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(state.out.status.get(drone.id)?.kind).toBe('avoidComet');
  });

  it('drone with no minable rock in range reports idle/noRocks', () => {
    const { state, drone, ctx } = setup();
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(state.out.status.get(drone.id)).toMatchObject({ kind: 'idle', reason: 'noRocks' });
  });

  it('is stable across consecutive ticks and keeps one record per ship', () => {
    const state = newGame(1);
    const index = new SimIndex();
    runTicks(state, 5, { index });
    const id = state.run.ships[0]!.id;
    const a = state.out.status.get(id);
    const before = a && { kind: a.kind, reason: a.reason };
    runTicks(state, 1, { index });
    const b = state.out.status.get(id);
    expect(b && { kind: b.kind, reason: b.reason }).toEqual(before);
    expect(b).toBe(a);
  });

  it('setStatus reuses the ship record', () => {
    const { state } = setup();
    setStatus(state.out, 7, 'mining');
    const rec = state.out.status.get(7);
    setStatus(state.out, 7, 'idle', 'noRocks');
    expect(state.out.status.get(7)).toBe(rec);
    expect(rec).toMatchObject({ kind: 'idle', reason: 'noRocks', rockKind: null });
  });

  it('drops a departed ship from the map on the next rebuild', () => {
    const { state, drone, ctx } = setup();
    droneThink(ctx, drone, ctx.index.stats.get(drone.id)!);
    expect(state.out.status.has(drone.id)).toBe(true);
    state.run.ships = state.run.ships.filter((s) => s !== drone);
    ctx.index.rebuild(state);
    expect(state.out.status.has(drone.id)).toBe(false);
  });
});

describe('formatStatus', () => {
  const base = { reason: null, rockKind: null, large: false } as const;
  it('words each kind with its reason', () => {
    expect(formatStatus({ ...base, kind: 'mining', rockKind: 'ice' }, 0.62)).toBe('Mining ice rock · hold 62%');
    expect(formatStatus({ ...base, kind: 'idle', reason: 'noRocks' }, 0)).toBe('Idle · no safe rocks in range');
    expect(formatStatus({ ...base, kind: 'returning' }, 1)).toBe('Returning to dock · hold full');
    expect(formatStatus({ ...base, kind: 'haulOutpost', reason: 'outpostLimit' }, 0)).toBe(
      'Hauling · outpost limit reached',
    );
    expect(formatStatus({ ...base, kind: 'heading', rockKind: 'ore', large: true }, 0)).toBe(
      'Heading to large ore rock',
    );
  });
});
