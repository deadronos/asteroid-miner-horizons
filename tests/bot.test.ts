import { describe, expect, it } from 'vitest';
import { botCommands } from '../scripts/bot';
import { runBot } from '../scripts/harness';
import { contractReward } from '../src/sim/contracts';
import { newGame } from '../src/sim/create';
import { droneCount, flagship, makeShip, shipStats } from '../src/sim/ships';
import type { Contract, Rock } from '../src/sim/types';

/** A deliverCrystal offer with a fixed id, for the bot's serviceability check. */
const crystalOffer = (id: number): Contract => {
  const { reward, data } = contractReward('deliverCrystal', 6);
  return { id, kind: 'deliverCrystal', target: 6, progress: 0, timeLimit: 360, timeLeft: 100, reward, data };
};

/** A bare rock at `(x, z)`, for controlling which target the bot picks. */
const rock = (id: number, kind: Rock['kind'], x: number, z: number): Rock => ({
  id,
  kind,
  size: 1,
  pos: { x, z },
  vel: { x: 0, z: 0 },
  radius: 20,
  hp: 10,
  maxHp: 10,
  units: 10,
  belt: 0,
});

describe('balance bot', () => {
  it('mines, unloads and buys a drone in the first system', () => {
    const s = newGame(1000);
    runBot(s, { seconds: 600, after: (st) => droneCount(st.run) > 0 });
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(droneCount(s.run)).toBeGreaterThan(0);
  });

  it('makes its first purchase within seconds of the start', () => {
    const s = newGame(1000);
    // An install raises the flagship's slot tier sum; the drone counts too.
    const tiers = (): number => flagship(s.run).slots.reduce((n, f) => n + (f?.tier ?? 0), 0);
    const start = tiers();
    let at = -1;
    runBot(s, {
      seconds: 5,
      after: (st) => {
        if (tiers() > start || droneCount(st.run) > 0) at = st.run.time;
        return at >= 0;
      },
    });
    expect(tiers()).toBeGreaterThan(start);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(5);
  });

  it('refines fuel without skipping the flagship order', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 0 };
    fs.order = null;
    fs.cargo = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    s.run.contracts.active = null;
    s.run.contracts.offers = [];
    s.run.pickups = [];
    s.run.rocks = [rock(1, 'ore', 120, 0)];
    s.run.bank = { ore: 0, ice: 10, crystal: 0, alloy: 0, fuel: 0 };

    // 10 ice queues 2 fuel; the mine order still comes back in the same cycle.
    expect(botCommands(s, { warp: false })).toEqual([
      { t: 'refine', recipe: 'fuel', count: 2 },
      { t: 'mine', shipId: fs.id, rockId: 1 },
    ]);
  });

  it('completes a contract in the first system', () => {
    const s = newGame(1000);
    runBot(s, { seconds: 600, warp: false });
    expect(s.run.contracts.completed).toBeGreaterThanOrEqual(1);
  });

  it('does not accept a deliverCrystal offer when the system has no crystal', () => {
    const s = newGame(1000);
    s.run.rocks = s.run.rocks.filter((r) => r.kind !== 'crystal');
    s.run.contracts.active = null;
    s.run.contracts.offers = [crystalOffer(1), crystalOffer(2)];

    const cmds = botCommands(s, { warp: false });
    expect(cmds.some((c) => c.t === 'acceptContract')).toBe(false);
  });

  it('accepts the first serviceable offer when no contract is active', () => {
    const s = newGame(1000);
    s.run.bank.fuel = 1000; // covered for the next warp, so the bot doesn't refine first
    expect(s.run.contracts.active).toBeNull();
    const first = s.run.contracts.offers[0]!;

    expect(botCommands(s, { warp: false })).toEqual([{ t: 'acceptContract', contractId: first.id }]);
  });

  it('mines the contract resource for an active deliverIce contract', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 0 };
    fs.order = null;
    fs.cargo = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    s.run.bank.fuel = 1000; // covered for the next warp, so the bot doesn't refine first
    s.run.pickups = [];
    // Ore is nearest; the ice rock is farther but scores as half distance for the contract.
    s.run.rocks = [rock(1, 'ore', 100, 0), rock(2, 'ice', 0, 150)];
    s.run.contracts.active = {
      id: 9,
      kind: 'deliverIce',
      target: 90,
      progress: 0,
      timeLimit: 300,
      timeLeft: 300,
      reward: {},
      data: 0,
    };

    expect(botCommands(s, { warp: false })).toEqual([{ t: 'mine', shipId: fs.id, rockId: 2 }]);
  });

  it('refines fuel and reaches the first warp from seed 1000', () => {
    const s = newGame(1000);
    let fuelMade = 0;
    runBot(s, {
      seconds: 1800,
      before: (st) => {
        fuelMade = Math.max(fuelMade, st.run.refinery.produced.fuel);
      },
      after: (st) => st.profile.warps > 0,
    });
    expect(s.profile.warps).toBe(1);
    expect(fuelMade).toBeGreaterThan(0);
  });

  it('smelts alloy for a tier-3 upgrade when only alloy is short', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    fs.slots = [
      { type: 'laser', tier: 3 },
      { type: 'cargo', tier: 2 },
      { type: 'sensor', tier: 3 },
      { type: 'armor', tier: 3 },
    ];
    fs.hull = shipStats(fs, s.profile).maxHull;
    // Fill the fleet so the drone isn't the next purchase, and fill drone slots.
    for (let i = 0; i < 2; i++) {
      const d = makeShip(s.run, s.profile, 'drone', `Drone-${i}`, { ...s.run.system.station.pos });
      d.slots = [
        { type: 'cargo', tier: 2 },
        { type: 'cargo', tier: 2 },
      ];
      s.run.ships.push(d);
    }
    s.run.contracts.active = null;
    s.run.contracts.offers = [];
    s.run.bank = { ore: 10000, ice: 10000, crystal: 100, alloy: 0, fuel: 1000 };

    // Tier-3 cargo costs 80 ore, 64 alloy, 128 ice, 14 crystal; the ore covers the shortfall.
    expect(botCommands(s, { warp: false })).toEqual([{ t: 'refine', recipe: 'alloy', count: 64 }]);
  });
});
