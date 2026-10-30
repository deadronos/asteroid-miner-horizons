import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { makeOutpost, outpostAt } from '../src/sim/automation';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { flagship, isBuilder, makeShip } from '../src/sim/ships';
import type { GameState, Rock, Ship } from '../src/sim/types';
import { DT, runFor, runTicks, send } from './helpers';

const HEAVY = { timeout: 30_000 };

interface World {
  s: GameState;
  /** Large rocks placed at the given distances east of the station. */
  rocks: Rock[];
  builder: Ship;
}

/** A game with only large still rocks `dists` east of the station, the flagship docked and one builder beside it. */
function world(dists: number[], seed = 1): World {
  const s = newGame(seed);
  const pool = s.run.rocks.filter((r) => r.size === 0 && !r.trait && !r.comet);
  const st = s.run.system.station.pos;
  const rocks = dists.map((d, i) => {
    const r = pool[i]!;
    r.pos = { x: st.x + d, z: st.z };
    r.vel = { x: 0, z: 0 };
    return r;
  });
  s.run.rocks = [...rocks];
  s.run.regrowTimer = -1e9; // no belt regrowth to muddy the rock list
  s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 1000, fuel: 0 };
  flagship(s.run).pos = { ...st };
  const builder = addBuilder(s, 20);
  return { s, rocks, builder };
}

function addBuilder(s: GameState, dz: number): Ship {
  const st = s.run.system.station.pos;
  const b = makeShip(s.run, s.profile, 'constructionDrone', `Builder-${s.run.ships.length}`, { x: st.x, z: st.z + dz });
  s.run.ships.push(b);
  return b;
}

/** A 60 s run with two builders, summarised as a string. */
function replay(): string {
  const { s } = world([300, 450, 600], 7);
  addBuilder(s, -30);
  runFor(s, 60);
  return JSON.stringify([s.run.automation.outposts, s.run.ships.map((x) => [x.pos, x.vel]), s.run.bank]);
}

/** Rock ids as a set, so outposts compare regardless of build order. */
const ids = (...rs: Rock[]): Set<number> => new Set(rs.map((r) => r.id));

const rockIds = (s: GameState): Set<number> => new Set(s.run.automation.outposts.map((o) => o.rockId));

describe('builder brain', () => {
  it('builds on the nearest eligible large rock within builderLeash of the station', () => {
    const { s, rocks } = world([600, 300, TUNING.builderLeash + 400]);
    runFor(s, 30);
    expect(rockIds(s)).toEqual(ids(rocks[0]!, rocks[1]!));
    expect(outpostAt(s, rocks[2]!.id)).toBeUndefined();
  });

  it('builds the nearer rock first', () => {
    const { s, rocks } = world([700, 250]);
    const index = new SimIndex();
    for (let t = 0; s.run.automation.outposts.length === 0 && t < 3000; t++) runTicks(s, 1, { index });
    expect(s.run.automation.outposts[0]!.rockId).toBe(rocks[1]!.id);
  });

  it('does not build when the bank would drop below builderReserve', () => {
    const { s, builder } = world([300]);
    const { outpostCost: c } = TUNING;
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: c.alloy + 25 - 1, fuel: 0 };
    runFor(s, 10);
    expect(s.run.automation.outposts).toHaveLength(0);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'idle', reason: 'belowReserve' });
    s.run.bank.alloy = c.alloy + 25;
    runFor(s, 20);
    expect(s.run.automation.outposts).toHaveLength(1);
  });

  it('hauls with the blocker as its reason while it cannot build', () => {
    const { s, rocks, builder } = world([300]);
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    const o = makeOutpost(rocks[0]!);
    o.stored.ore = 40;
    s.run.automation.outposts.push(o);
    s.run.bank = { ore: 10, ice: 10, crystal: 0, alloy: 10, fuel: 0 };
    runTicks(s, 5);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'haulOutpost', reason: 'belowReserve' });
  });

  it('stops at outpostMax and hauls', () => {
    const { s, rocks, builder } = world([300, 400, 500, 600]);
    for (const r of rocks.slice(0, 3)) s.run.automation.outposts.push(makeOutpost(r));
    runTicks(s, 5);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'idle', reason: 'outpostLimit' });
    s.run.automation.outposts[0]!.stored.ore = 40;
    runTicks(s, 5);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'haulOutpost', reason: 'outpostLimit' });
    expect(s.run.automation.outposts).toHaveLength(3);
  });

  it('hauls a full miner while at the limit', () => {
    const { s, rocks, builder } = world([300, 400, 500]);
    for (const r of rocks) s.run.automation.outposts.push(makeOutpost(r));
    const st = s.run.system.station.pos;
    const drone = makeShip(s.run, s.profile, 'drone', 'D', { x: st.x + 200, z: st.z + 200 });
    drone.cargo.ore = 30;
    s.run.ships.push(drone);
    runTicks(s, 5);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'haulMiner', reason: 'outpostLimit' });
  });

  it('builds without any hauler in the fleet, then empties its outposts', HEAVY, () => {
    const { s, rocks } = world([300]);
    runFor(s, 20);
    expect(outpostAt(s, rocks[0]!.id)).toBeDefined();
    const bank = s.run.bank.ore;
    runFor(s, 120);
    expect(s.run.bank.ore).toBeGreaterThan(bank);
    expect(s.run.ships.some((x) => x.hullId === 'hauler')).toBe(false);
  });

  it('two builders never claim the same rock', () => {
    const { s, rocks, builder } = world([300, 450]);
    const other = addBuilder(s, -20);
    const index = new SimIndex();
    let clashes = 0;
    for (let t = 0; t < 60 * 30; t++) {
      runTicks(s, 1, { index });
      if (builder.aiTargetId != null && builder.aiTargetId === other.aiTargetId) clashes++;
    }
    expect(clashes).toBe(0);
    expect(rockIds(s)).toEqual(ids(...rocks));
  });

  it('a builder and a hauler never claim the same outpost', () => {
    const { s, rocks, builder } = world([300, 400, 500]);
    for (const r of rocks) {
      const o = makeOutpost(r);
      o.stored.ore = 60;
      s.run.automation.outposts.push(o);
    }
    const st = s.run.system.station.pos;
    const hauler = makeShip(s.run, s.profile, 'hauler', 'H', { x: st.x + 30, z: st.z });
    s.run.ships.push(hauler);
    const index = new SimIndex();
    let claimed = 0;
    let clashes = 0;
    for (let t = 0; t < 60 * 20; t++) {
      runTicks(s, 1, { index });
      if (builder.aiTargetId != null && hauler.aiTargetId != null) claimed++;
      if (builder.aiTargetId != null && builder.aiTargetId === hauler.aiTargetId) clashes++;
    }
    expect(clashes).toBe(0);
    expect(claimed).toBeGreaterThan(0);
  });

  it('never builds on a comet, an outpost rock or an unsafe rock', () => {
    const { s, rocks } = world([300, 450, 600]);
    rocks[0]!.comet = true;
    s.run.automation.outposts.push(makeOutpost(rocks[1]!));
    // A comet far to the west flying east along the line through the last rock: its path covers the rock.
    const st = s.run.system.station.pos;
    const comet = { ...rocks[0]!, id: 9999, size: 2 as const, radius: 20, comet: true as const };
    comet.pos = { x: st.x - 3000, z: st.z };
    comet.vel = { x: 60, z: 0 };
    s.run.rocks.push(comet);
    // Long enough for the builder to reach the third rock if it were willing to.
    const index = new SimIndex();
    let targeted = 0;
    for (let t = 0; t < 60 * 10; t++) {
      runTicks(s, 1, { index });
      if (s.run.ships[1]!.aiTargetId === rocks[2]!.id) targeted++;
    }
    expect(targeted).toBe(0);
    expect(rockIds(s)).toEqual(ids(rocks[1]!));
  });

  it('ignores a decoy rock just outside the leash even when it is nearest to a far-off builder', () => {
    const { s, rocks, builder } = world([300, 100]);
    const st = s.run.system.station.pos;
    rocks[1]!.pos = { x: st.x + 1000, z: st.z + 900 }; // 1345 from the station: outside the leash
    builder.pos = { x: st.x + 1000, z: st.z + 1000 };
    runTicks(s, 30);
    expect(builder.aiTargetId).toBe(rocks[0]!.id);
    expect(s.out.status.get(builder.id)?.kind).toBe('buildHeading');
  });

  it('refills a slot after an outpost is dismantled', () => {
    const { s, rocks } = world([300, 400, 500, 600]);
    for (const r of rocks.slice(0, 3)) s.run.automation.outposts.push(makeOutpost(r));
    runFor(s, 3);
    expect(rocks.map((r) => outpostAt(s, r.id) !== undefined)).toEqual([true, true, true, false]);
    s.run.automation.outposts[0]!.reserve = 0;
    s.run.automation.outposts[0]!.stored.ore = 0;
    runTicks(s, 2);
    expect(s.run.automation.outposts).toHaveLength(2);
    runFor(s, 30);
    expect(s.run.automation.outposts).toHaveLength(3);
  });

  it('autoBuild off never picks a rock', () => {
    const { s, builder } = world([300]);
    builder.autoBuild = false;
    runFor(s, 20);
    expect(s.run.automation.outposts).toHaveLength(0);
    expect(s.out.status.get(builder.id)).toMatchObject({ kind: 'idle', reason: 'nothingToHaul' });
  });

  it('carries out a build order with autoBuild off, and rejects a bad one', () => {
    const { s, rocks, builder } = world([300, 450]);
    builder.autoBuild = false;
    builder.order = { kind: 'build', rockId: rocks[1]!.id };
    runFor(s, 30);
    expect(rockIds(s)).toEqual(ids(rocks[1]!));
    expect(builder.order).toBeNull();
    const bank = { ...s.run.bank };
    builder.order = { kind: 'build', rockId: rocks[1]!.id };
    s.out.log.length = 0;
    runTicks(s, 2);
    expect(builder.order).toBeNull();
    expect(s.out.log.some((l) => l.level === 'warn')).toBe(true);
    expect(s.run.bank).toEqual(bank);
  });

  it('a build order on a rock that breaks or gains an outpost is dropped with no payment', () => {
    const { s, rocks, builder } = world([300, 450]);
    builder.autoBuild = false;
    send(s, { t: 'mine', shipId: builder.id, rockId: rocks[0]!.id });
    expect(builder.order).toEqual({ kind: 'build', rockId: rocks[0]!.id });
    const bank = { ...s.run.bank };
    s.run.rocks = s.run.rocks.filter((r) => r !== rocks[0]);
    s.out.log.length = 0;
    runTicks(s, 2);
    expect(builder.order).toBeNull();
    expect(s.out.log.some((l) => l.level === 'warn')).toBe(true);
    expect(s.run.bank).toEqual(bank);

    send(s, { t: 'mine', shipId: builder.id, rockId: rocks[1]!.id });
    s.run.automation.outposts.push(makeOutpost(rocks[1]!));
    s.out.log.length = 0;
    runTicks(s, 2);
    expect(builder.order).toBeNull();
    expect(s.out.log.some((l) => l.level === 'warn')).toBe(true);
    expect(s.run.bank).toEqual(bank);
  });

  it('keeps a build order on a rock that turns unsafe, holds clear, then builds once it is safe', HEAVY, () => {
    const { s, rocks, builder } = world([300]);
    builder.autoBuild = false;
    const st = s.run.system.station.pos;
    // A comet flying east along the line through the rock: its path covers the rock for as long as it is there.
    const comet = { ...rocks[0]!, id: 9999, size: 2 as const, radius: 20, comet: true as const };
    comet.pos = { x: st.x - 3000, z: st.z };
    comet.vel = { x: 60, z: 0 };
    s.run.rocks.push(comet);
    send(s, { t: 'mine', shipId: builder.id, rockId: rocks[0]!.id });
    const bank = { ...s.run.bank };
    s.out.log.length = 0;
    runFor(s, 20);
    expect(builder.order).toEqual({ kind: 'build', rockId: rocks[0]!.id });
    expect(outpostAt(s, rocks[0]!.id)).toBeUndefined();
    expect(s.run.bank).toEqual(bank);
    expect(s.out.log.some((l) => l.level === 'warn')).toBe(false);
    // The comet leaves; the order is still there and gets carried out.
    s.run.rocks = s.run.rocks.filter((r) => r !== comet);
    runFor(s, 40);
    expect(outpostAt(s, rocks[0]!.id)).toBeDefined();
    expect(builder.order).toBeNull();
  });

  it('a build order with autoBuild on overrides the builder own pick once', () => {
    const { s, rocks, builder } = world([300, 450]);
    send(s, { t: 'mine', shipId: builder.id, rockId: rocks[1]!.id });
    runFor(s, 1);
    expect(builder.aiTargetId).toBe(rocks[1]!.id);
    runFor(s, 30);
    expect(builder.order).toBeNull();
    expect(outpostAt(s, rocks[1]!.id)).toBeDefined();
    expect(outpostAt(s, rocks[0]!.id)).toBeDefined(); // autoBuild resumed with its own pick
  });

  it('deploys at most once per buildInterval', () => {
    const { s, builder } = world([200, 220, 240]);
    const index = new SimIndex();
    const times: number[] = [];
    let n = 0;
    for (let t = 0; t < 60 * 20; t++) {
      runTicks(s, 1, { index });
      if (s.run.automation.outposts.length > n) {
        n = s.run.automation.outposts.length;
        times.push(s.run.time);
      }
    }
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]! + DT).toBeGreaterThanOrEqual(TUNING.buildInterval);
    expect(isBuilder(builder)).toBe(true);
  });

  it('is deterministic across two seeded runs', HEAVY, () => {
    expect(replay()).toBe(replay());
  });
});

describe('builder bookkeeping', () => {
  it('prunes claims and ready times when a builder or its rock goes', () => {
    const { s, builder } = world([300, 450]);
    const index = new SimIndex();
    runTicks(s, 90, { index });
    expect(index.builderClaims.size + index.buildReadyAt.size).toBeGreaterThan(0);
    s.run.ships = s.run.ships.filter((x) => x !== builder);
    runTicks(s, 2, { index });
    expect(index.builderClaims.size).toBe(0);
    expect(index.buildReadyAt.size).toBe(0);
  });
});

describe('the player deploy', () => {
  it('still requires the flagship beside the rock and ignores the reserve', () => {
    const { s, rocks } = world([300]);
    const fs = flagship(s.run);
    s.run.ships = [fs];
    send(s, { t: 'deployOutpost', rockId: rocks[0]!.id });
    expect(s.run.automation.outposts).toHaveLength(0);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
    fs.pos = { x: rocks[0]!.pos.x - rocks[0]!.radius - 20, z: rocks[0]!.pos.z };
    const { outpostCost: c } = TUNING;
    s.run.bank = { ore: c.ore, ice: c.ice, crystal: 0, alloy: c.alloy, fuel: 0 };
    send(s, { t: 'deployOutpost', rockId: rocks[0]!.id });
    expect(s.run.automation.outposts).toHaveLength(1);
    expect(s.run.bank.ore).toBe(0);
  });
});
