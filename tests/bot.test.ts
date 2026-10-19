import { describe, expect, it } from 'vitest';
import { botCommands } from '../scripts/bot';
import { runBot } from '../scripts/harness';
import { contractReward } from '../src/sim/contracts';
import { isVariant } from '../src/data/components';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { makeOutpost } from '../src/sim/automation';
import { cometPathEscape, inFlareZone } from '../src/sim/hazards';
import { droneCount, flagship, makeShip, shipStats } from '../src/sim/ships';
import type { Command } from '../src/sim/commands';
import type { Contract, GameState, Rock } from '../src/sim/types';

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

  it('installs the default variant into the one empty slot', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    fs.order = null;
    fs.hullId = 'excavator'; // six slots, so every install but the laser is filled
    fs.slots = [
      { type: 'cargo', variant: 'standard', tier: 1 },
      { type: 'sensor', variant: 'standard', tier: 1 },
      { type: 'engine', variant: 'ion', tier: 1 },
      { type: 'armor', variant: 'standard', tier: 1 },
      { type: 'shield', variant: 'standard', tier: 1 },
      null,
    ];
    fs.hull = shipStats(fs, s.profile).maxHull;
    s.run.contracts.active = null;
    s.run.contracts.offers = [];
    s.run.pickups = [];
    // Funded for the install (31 ore) but not for the 80-ore drone it would buy first.
    s.run.bank = { ore: 40, ice: 0, crystal: 0, alloy: 0, fuel: 0 };

    const cmd = only(botCommands(s, { warp: false }));
    expect(cmd).toEqual({ t: 'install', shipId: fs.id, slot: 5, comp: 'laser', variant: 'focused' });
    if (cmd.t !== 'install') throw new Error(`expected an install, got ${cmd.t}`);
    expect(isVariant(cmd.comp, cmd.variant)).toBe(true);
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
      { type: 'laser', variant: 'focused', tier: 3 },
      { type: 'cargo', variant: 'standard', tier: 2 },
      { type: 'sensor', variant: 'standard', tier: 3 },
      { type: 'armor', variant: 'standard', tier: 3 },
    ];
    fs.hull = shipStats(fs, s.profile).maxHull;
    // Fill the fleet so the drone isn't the next purchase, and fill drone slots.
    for (let i = 0; i < 2; i++) {
      const d = makeShip(s.run, s.profile, 'drone', `Drone-${i}`, { ...s.run.system.station.pos });
      d.slots = [
        { type: 'cargo', variant: 'standard', tier: 2 },
        { type: 'cargo', variant: 'standard', tier: 2 },
      ];
      s.run.ships.push(d);
    }
    s.run.contracts.active = null;
    s.run.contracts.offers = [];
    s.run.bank = { ore: 10000, ice: 10000, crystal: 100, alloy: 0, fuel: 1000 };

    // Tier-3 cargo costs 80 ore, 64 alloy, 128 ice, 14 crystal; the ore covers the shortfall.
    expect(botCommands(s, { warp: false })).toEqual([{ t: 'refine', recipe: 'alloy', count: 64 }]);
  });

  it('a refine cycle while docked also buys an affordable item', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    s.run.contracts.active = null;
    s.run.contracts.offers = [];
    // 200 ice cracks down to the 25-fuel reserve (125 ice) and still leaves 75
    // ice, so the drone is affordable in the same cycle the refine fires.
    s.run.bank = { ore: 200, ice: 200, crystal: 0, alloy: 0, fuel: 0 };

    expect(botCommands(s, { warp: false })).toEqual([
      { t: 'refine', recipe: 'fuel', count: 25 },
      { t: 'buyHull', hullId: 'drone' },
    ]);
  });
});

/** A game where the bot's only decision is the flagship's order: no offers, perks, fuel or affordable purchases. */
function orderOnly(): GameState {
  const s = newGame(1000);
  s.run.contracts.offers = [];
  s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
  s.run.pickups = [];
  s.run.rocks = [];
  flagship(s.run).order = null;
  return s;
}

/** Puts a flare warning on an M star. */
function flareWarning(s: GameState): void {
  s.run.system.starClass = 'M';
  s.run.hazards.flare = { phase: 'warning', timeLeft: TUNING.flareWarning };
}

const only = (cmds: Command[]): Command => {
  expect(cmds).toHaveLength(1);
  return cmds[0]!;
};

/** The target of a move command; throws on anything else. */
const moveTo = (cmd: Command): { x: number; z: number } => {
  if (cmd.t !== 'move') throw new Error(`expected a move, got ${cmd.t}`);
  return cmd.to;
};

describe('balance bot hazard reflexes', () => {
  it('docks during a flare warning when the station is close', () => {
    const s = orderOnly();
    flareWarning(s);
    const st = s.run.system.station.pos;
    const fs = flagship(s.run);
    fs.pos = { x: st.x * 1.14, z: st.z * 1.14 };
    s.run.rocks.push(rock(500, 'ore', fs.pos.x + 40, fs.pos.z));
    expect(only(botCommands(s))).toEqual({ t: 'dock', shipId: fs.id });
  });

  it('flees past the flare reach when the station is the long way round', () => {
    const s = orderOnly();
    flareWarning(s);
    const st = s.run.system.station.pos;
    const fs = flagship(s.run);
    fs.pos = { x: -st.x * 1.2, z: -st.z * 1.2 };
    expect(inFlareZone(s.run, moveTo(only(botCommands(s))))).toBe(false);
  });

  it('stays docked through a flare', () => {
    const s = orderOnly();
    flareWarning(s);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    s.run.rocks.push(rock(500, 'ore', fs.pos.x + 200, fs.pos.z));
    fs.order = { kind: 'mine', rockId: 500 };
    expect(only(botCommands(s))).toEqual({ t: 'stop', shipId: fs.id });
    fs.order = null;
    expect(botCommands(s)).toEqual([]);
  });

  it('moves out of a comet path', () => {
    const s = orderOnly();
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 610 };
    s.run.hazards.comet = { from: { x: -3200, z: 600 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 8 };
    const to = moveTo(only(botCommands(s)));
    expect(to.z).toBeGreaterThan(fs.pos.z);
    expect(cometPathEscape(s.run, [], to, TUNING.cometDodgePad, { x: 0, z: 0 })).toBe(false);
  });

  it('skips a dense rock its tier-1 laser cannot cut, and mines a plain one', () => {
    const s = orderOnly();
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 0 };
    s.run.rocks = [{ ...rock(500, 'ore', 100, 0), trait: 'dense' }, rock(501, 'ore', 0, 200)];
    expect(only(botCommands(s))).toEqual({ t: 'mine', shipId: fs.id, rockId: 501 });
  });

  it('skips a rock in a comet path, and drops a mine order on one', () => {
    const s = orderOnly();
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 300 };
    s.run.hazards.comet = { from: { x: -3200, z: 0 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 8 };
    s.run.rocks.push(rock(500, 'ore', 0, 60), rock(501, 'ore', 0, 600));
    expect(only(botCommands(s))).toEqual({ t: 'mine', shipId: fs.id, rockId: 501 });
    fs.order = { kind: 'mine', rockId: 500 };
    expect(only(botCommands(s))).toEqual({ t: 'mine', shipId: fs.id, rockId: 501 });
    s.run.rocks.pop();
    expect(only(botCommands(s))).toEqual({ t: 'stop', shipId: fs.id });
  });

  it('mines around an outpost rock rather than into it', () => {
    const s = orderOnly();
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 300 };
    s.run.rocks.push(rock(500, 'ore', 0, 320), rock(501, 'ore', 0, 600));
    s.run.automation.outposts.push(makeOutpost(s.run.rocks[0]!));
    expect(only(botCommands(s))).toEqual({ t: 'mine', shipId: fs.id, rockId: 501 });
  });
});

/** Docked at the station with a rich bank, nothing else to decide, and `drones` mining drones. */
function docked(drones: number): GameState {
  const s = newGame(1000);
  const st = s.run.system.station.pos;
  flagship(s.run).pos = { ...st };
  s.run.contracts.offers = [];
  s.profile.perks.bay = 1;
  for (let i = 0; i < drones; i++) s.run.ships.push(makeShip(s.run, s.profile, 'drone', `Drone-${i}`, st));
  s.run.bank = { ore: 5000, ice: 5000, crystal: 0, alloy: 500, fuel: 1000 };
  return s;
}

/** Undocked beside a large rock, with nothing to buy; `hauler` adds one to the fleet. */
function besideLarge(hauler: boolean): { s: GameState; large: Rock } {
  const s = orderOnly();
  const fs = flagship(s.run);
  const large: Rock = { ...rock(500, 'ore', 0, 600), size: 0, radius: 36 };
  s.run.rocks.push(large);
  fs.pos = { x: 0, z: 600 - large.radius - 40 };
  s.run.bank = { ...TUNING.outpostCost, crystal: 0, fuel: 1000, ore: TUNING.outpostCost.ore };
  if (hauler) s.run.ships.push(makeShip(s.run, s.profile, 'hauler', 'Hauler-1', s.run.system.station.pos));
  return { s, large };
}

describe('balance bot automation', () => {
  it('spends the fleet slot after two drones on a hauler', () => {
    expect(botCommands(docked(2), { warp: false })).toEqual([{ t: 'buyHull', hullId: 'hauler' }]);
  });

  it('still buys a second drone before any hauler', () => {
    expect(botCommands(docked(1), { warp: false })).toEqual([{ t: 'buyHull', hullId: 'drone' }]);
  });

  it('deploys an outpost on a large rock beside the flagship once it has a hauler', () => {
    const { s, large } = besideLarge(true);
    expect(botCommands(s, { warp: false })).toContainEqual({ t: 'deployOutpost', rockId: large.id });
  });

  it('deploys no outpost without a hauler to service it', () => {
    const { s } = besideLarge(false);
    expect(botCommands(s, { warp: false }).some((c) => c.t === 'deployOutpost')).toBe(false);
  });
});

/** Maxes the perks that would otherwise undercut the furnace's price. */
function maxCheapPerks(s: GameState): void {
  Object.assign(s.profile.perks, { yield: 10, optics: 10, thrust: 8, kit: 5 });
}

describe('balance bot refinery perks', () => {
  it('researches no refinery perk while the warp fuel refines quickly', () => {
    const s = newGame(1000);
    s.profile.data = 2; // affords only furnace 1 (cost 2) or a cheap perk at level 1
    maxCheapPerks(s);
    expect(botCommands(s, { warp: false })[0]).not.toEqual({ t: 'buyPerk', perk: 'furnace' });
  });

  it('researches the furnace once refining the warp fuel takes over a minute', () => {
    const s = newGame(1000);
    s.profile.warps = 5; // 50 × 1.3^5 ≈ 186 fuel ≈ 93 s of refining
    s.profile.data = 2;
    maxCheapPerks(s);
    expect(botCommands(s, { warp: false })[0]).toEqual({ t: 'buyPerk', perk: 'furnace' });
  });
});
