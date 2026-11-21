import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO } from '../src/sim/assists';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { makeShip, shipStats } from '../src/sim/ships';
import { tick } from '../src/sim/update';

describe('SimIndex', () => {
  it('rebuild reuses the same Map and hash instances', () => {
    const index = new SimIndex();
    const hash = index.rockHash;
    const byId = index.rockById;
    const stats = index.stats;
    index.rebuild(newGame(1));
    expect(index.rockHash).toBe(hash);
    expect(index.rockById).toBe(byId);
    expect(index.stats).toBe(stats);
    expect(index.rockById.size).toBeGreaterThan(0);
  });

  it('clear empties all three structures', () => {
    const index = new SimIndex();
    index.rebuild(newGame(1));
    expect(index.rockById.size).toBeGreaterThan(0);
    expect(index.stats.size).toBeGreaterThan(0);
    // Covers every rock in a system (belts live within ~2200 of the star).
    // (The plan's 1e9 makes query() walk a ~2.4e14-cell bounding box and hang;
    // even 1e5 costs ~2.4M cells, so keep this close to the system radius.)
    const ALL = 4000;
    let hits = 0;
    index.rockHash.query({ x: 0, z: 0 }, ALL, () => {
      hits++;
    });
    expect(hits).toBeGreaterThan(0);
    index.clear();
    expect(index.rockById.size).toBe(0);
    expect(index.stats.size).toBe(0);
    hits = 0;
    index.rockHash.query({ x: 0, z: 0 }, ALL, () => {
      hits++;
    });
    expect(hits).toBe(0);
  });

  it('rebuild recomputes stats after a perked change (no stale cache)', () => {
    // Spec 232-238: stats are rebuilt every tick, not invalidated lazily.
    const state = newGame(13);
    const index = new SimIndex();
    index.rebuild(state);
    const ship = state.run.ships[0]!;
    const before = index.stats.get(ship.id)!.speed;
    const t0 = state.profile.perks.thrust; // ships.ts: speed *= 1 + 0.08 * thrust
    state.profile.perks.thrust = t0 + 1;
    index.rebuild(state);
    const base = before / (1 + 0.08 * t0);
    expect(index.stats.get(ship.id)!.speed).toBeCloseTo(base * (1 + 0.08 * (t0 + 1)));
  });

  it('rebuild reuses each ship stats object across ticks', () => {
    const state = newGame(13);
    const index = new SimIndex();
    index.rebuild(state);
    const id = state.run.ships[0]!.id;
    const first = index.stats.get(id);
    index.rebuild(state);
    expect(index.stats.get(id)).toBe(first);
  });

  it('rebuild drops stats for ships that are gone', () => {
    const state = newGame(13);
    const index = new SimIndex();
    state.run.ships.push(makeShip(state.run, state.profile, 'drone', 'Drone-9', { x: 0, z: 0 }));
    index.rebuild(state);
    const gone = state.run.ships[state.run.ships.length - 1]!;
    expect(index.stats.has(gone.id)).toBe(true);
    state.run.ships.pop();
    index.rebuild(state);
    expect(index.stats.has(gone.id)).toBe(false);
  });

  it('does not compound the system magnet effect across rebuilds', () => {
    const state = newGame(1);
    state.run.system.modifiers = ['nebula' as const];
    const index = new SimIndex();
    index.rebuild(state);
    const ship = state.run.ships[0]!;
    const once = index.stats.get(ship.id)!.magnet;
    index.rebuild(state);
    index.rebuild(state);
    expect(index.stats.get(ship.id)!.magnet).toBeCloseTo(once);
    expect(once).toBeCloseTo(shipStats(ship, state.profile).magnet * 0.85);
  });

  it('reuses its tick context and drops the GameState reference after tick()', () => {
    const state = newGame(7);
    const index = new SimIndex();
    const ctx1 = index.beginTick(state, 1 / 60, DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO, 'off');
    expect(ctx1.state).toBe(state);
    expect(ctx1.index).toBe(index);
    index.endTick();
    expect((ctx1 as { state: unknown }).state).toBeUndefined();

    const ctx2 = index.beginTick(state, 1 / 60, DEFAULT_ASSISTS, DEFAULT_FLEET_AUTO, 'off');
    expect(ctx2).toBe(ctx1);
    index.endTick();

    tick(state, 1 / 60, { thrust: { x: 0, z: 0 }, commands: [] }, index);
    expect((ctx1 as { state: unknown }).state).toBeUndefined();
  });

  it('rebuilds and clears shipHash, pickupHash and maxMagnet', () => {
    const state = newGame(11);
    const ship = state.run.ships[0]!;
    state.run.pickups.push({
      id: 9001,
      kind: 'ore',
      amount: 1,
      pos: { x: ship.pos.x + 20, z: ship.pos.z },
      vel: { x: 0, z: 0 },
      age: 0,
    });
    const index = new SimIndex();
    index.rebuild(state);
    expect(index.maxMagnet).toBeGreaterThan(0);
    expect(index.pickupHashCount).toBe(1);
    let ships = 0;
    index.shipHash.query(ship.pos, 100, () => {
      ships++;
    });
    let pickups = 0;
    index.pickupHash.query(ship.pos, 100, () => {
      pickups++;
    });
    expect(ships).toBeGreaterThan(0);
    expect(pickups).toBe(1);

    index.clear();
    expect(index.maxMagnet).toBe(0);
    expect(index.pickupHashCount).toBe(0);
    ships = 0;
    index.shipHash.query(ship.pos, 100, () => {
      ships++;
    });
    pickups = 0;
    index.pickupHash.query(ship.pos, 100, () => {
      pickups++;
    });
    expect(ships).toBe(0);
    expect(pickups).toBe(0);
  });
});
