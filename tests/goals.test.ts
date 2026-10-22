import { describe, expect, it } from 'vitest';
import { runBot } from '../scripts/harness';
import { TUNING } from '../src/data/tuning';
import { DEFAULT_FLEET_AUTO } from '../src/sim/assists';
import { makeOutpost } from '../src/sim/automation';
import { newGame } from '../src/sim/create';
import { warpCost } from '../src/sim/economy';
import { flagship, makeShip, shipStats } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import {
  GOALS,
  MINE_GOAL,
  currentGoal,
  goalDone,
  goalHint,
  goalProgress,
  goalsVisible,
  type GoalId,
} from '../src/ui/goals';
import { runTicks, send } from './helpers';

const done = (s: GameState): GoalId[] => GOALS.filter((g) => goalDone(s, g.id)).map((g) => g.id);

/** A fresh game: the flagship docked with an empty hold, so no blocker hint applies. */
const fresh = (): GameState => newGame(7);

/** A fresh game with every rock and pickup gone, so a drone near the flagship has nothing to do. */
const empty = (): GameState => {
  const s = fresh();
  s.run.rocks = [];
  s.run.pickups = [];
  return s;
};

const AUTODOCK_OFF = { assists: { autoDock: false }, auto: DEFAULT_FLEET_AUTO };

/** Adds a mining drone to the run and returns it. */
const addDrone = (s: GameState) => {
  const fs = flagship(s.run);
  const d = makeShip(s.run, s.profile, 'drone', 'Drone-1', { x: fs.pos.x + 40, z: fs.pos.z });
  s.run.ships.push(d);
  return d;
};

describe('first-steps goals', () => {
  it('a fresh game shows the checklist with nothing done and mining next', () => {
    const s = fresh();
    expect(goalsVisible(s)).toBe(true);
    expect(done(s)).toEqual([]);
    expect(currentGoal(s)?.id).toBe('mine');
    expect(goalProgress(s, 'mine')).toBe(`0/${MINE_GOAL}`);
    expect(goalHint(s)).toBeNull();
  });

  it('derives each goal from a lifetime stat', () => {
    const s = fresh();
    s.profile.stats.unitsMined = MINE_GOAL - 0.5;
    expect(goalDone(s, 'mine')).toBe(false);
    s.profile.stats.unitsMined = MINE_GOAL;
    s.profile.stats.unloads = 1;
    s.profile.stats.installs = 1;
    s.profile.stats.miningDrones = 1;
    s.profile.stats.contracts = 1;
    expect(done(s)).toEqual(['mine', 'unload', 'install', 'drone', 'contract']);
    expect(currentGoal(s)?.id).toBe('warp');
    s.profile.stats.warps = 1;
    expect(currentGoal(s)).toBeNull();
  });

  it('the current goal is the first one not met, whatever order the others were met in', () => {
    const s = fresh();
    s.profile.stats.miningDrones = 1;
    s.profile.stats.unitsMined = 100;
    expect(currentGoal(s)?.id).toBe('unload');
  });

  it('only the flagship unloading ticks "Dock and unload"', () => {
    const s = fresh();
    const d = addDrone(s);
    d.pos = { ...s.run.system.station.pos };
    d.cargo.ore = 10;
    runTicks(s, 1);
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(goalDone(s, 'unload')).toBe(false);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    fs.cargo.ore = 10;
    runTicks(s, 1);
    expect(s.profile.stats.unloads).toBe(1);
    expect(goalDone(s, 'unload')).toBe(true);
  });

  it('a hauler does not tick "Buy a drone"; a mining drone does', () => {
    const s = fresh();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 1e4, alloy: 1e4, fuel: 0 };
    send(s, { t: 'buyHull', hullId: 'hauler' });
    expect(goalDone(s, 'drone')).toBe(false);
    send(s, { t: 'buyHull', hullId: 'drone' });
    expect(goalDone(s, 'drone')).toBe(true);
  });

  it('shows the active contract’s progress until the first one completes', () => {
    const s = fresh();
    expect(goalProgress(s, 'contract')).toBeNull();
    send(s, { t: 'acceptContract', contractId: s.run.contracts.offers[0]!.id });
    const c = s.run.contracts.active!;
    c.progress = 3;
    expect(goalProgress(s, 'contract')).toBe(`3/${c.target}`);
  });

  it('hides once dismissed, and for good after the first warp', () => {
    const s = fresh();
    send(s, { t: 'dismissGoals' });
    expect(goalsVisible(s)).toBe(false);
    const t = fresh();
    t.run.bank.fuel = warpCost(t);
    send(t, { t: 'warp', route: 0 });
    expect(goalsVisible(t)).toBe(false);
  });

  describe('blocker hints', () => {
    it('flags a flagship with no mining laser', () => {
      const s = fresh();
      const fs = flagship(s.run);
      fs.slots = fs.slots.map((f) => (f?.type === 'laser' ? null : f));
      expect(goalHint(s)).toMatch(/No mining laser/);
    });

    it('flags a full hold until the flagship is ordered home', () => {
      const s = fresh();
      const fs = flagship(s.run);
      fs.cargo.ore = shipStats(fs, s.profile).cargoCap;
      expect(goalHint(s)).toMatch(/Hold full: click the station/);
      send(s, { t: 'dock', shipId: fs.id });
      expect(goalHint(s)).toBeNull();
    });

    it('flags a flagship being rebuilt before anything else', () => {
      const s = fresh();
      const fs = flagship(s.run);
      fs.respawn = TUNING.flagshipRespawn;
      fs.cargo.ore = 1000;
      expect(goalHint(s)).toMatch(/being rebuilt/);
    });

    it('flags a drone with nothing to mine near its anchor, and names the mode to switch to', () => {
      const s = empty();
      const d = addDrone(s);
      expect(goalHint(s)).toMatch(/Drone-1 is idle: .*AUTO/);
      d.aiMode = 'auto';
      expect(goalHint(s)).toMatch(/Drone-1 is idle: .*ASSIST/);
    });

    it('does not call a drone idle between targets while rocks are in reach', () => {
      // The drone brain clears aiTargetId when a rock breaks, collects debris or dodges; none of that is idle.
      const s = fresh();
      const d = addDrone(s);
      d.aiTargetId = null;
      d.beamOn = false;
      expect(s.run.rocks.some((r) => Math.hypot(r.pos.x - d.pos.x, r.pos.z - d.pos.z) < TUNING.droneLeash)).toBe(true);
      expect(goalHint(s)).toBeNull();
    });

    it('does not call a drone idle while debris near its anchor is waiting', () => {
      const s = empty();
      const d = addDrone(s);
      s.run.pickups.push({
        id: 1,
        kind: 'ore',
        amount: 3,
        pos: { x: d.pos.x + 100, z: d.pos.z },
        vel: { x: 0, z: 0 },
        age: 0,
      });
      expect(goalHint(s)).toBeNull();
    });

    it('ignores rocks the drone cannot mine: outpost hosts and dense rock under a tier-2 laser', () => {
      const s = empty();
      const d = addDrone(s);
      const near = { x: d.pos.x + 100, z: d.pos.z };
      const host = {
        id: 901,
        kind: 'ore' as const,
        size: 0 as const,
        pos: near,
        vel: { x: 0, z: 0 },
        radius: 30,
        hp: 9,
        maxHp: 9,
        units: 9,
        belt: 0,
      };
      s.run.rocks.push(host);
      s.run.automation.outposts.push(makeOutpost(host));
      s.run.rocks.push({ ...host, id: 902, size: 1, trait: 'dense' });
      expect(goalHint(s)).toMatch(/Drone-1 is idle/);
      s.run.rocks.push({ ...host, id: 903, size: 1 });
      expect(goalHint(s)).toBeNull();
    });

    it('stays quiet while a hazard may have the drone dodging, or it is flying home for repairs', () => {
      const s = empty();
      const d = addDrone(s);
      s.run.hazards.flare = { phase: 'warning', timeLeft: 5 };
      expect(goalHint(s)).toBeNull();
      s.run.hazards.flare = null;
      d.autoRepair = true;
      d.hull = 1;
      expect(goalHint(s)).toBeNull();
    });

    it('does not call a drone with a manual order idle', () => {
      const s = empty();
      const d = addDrone(s);
      d.order = { kind: 'dock' };
      expect(goalHint(s)).toBeNull();
    });

    it('asks for a dock order when a full drone waits because auto-dock is off', () => {
      const s = empty();
      const d = addDrone(s);
      d.cargo.ore = shipStats(d, s.profile).cargoCap;
      expect(goalHint(s)).toBeNull(); // auto-dock on: it is already flying home
      expect(goalHint(s, AUTODOCK_OFF)).toBe(
        'Drone-1 hold full: order it to dock, or turn on auto-dock (⚙ → Gameplay).',
      );
      d.order = { kind: 'dock' };
      expect(goalHint(s, AUTODOCK_OFF)).toBeNull();
    });

    it('asks for fuel once the warp is the only goal left', () => {
      const s = fresh();
      Object.assign(s.profile.stats, { unitsMined: 50, unloads: 1, installs: 1, miningDrones: 1, contracts: 1 });
      s.run.bank.fuel = 4;
      expect(goalHint(s)).toBe(
        `Warp needs ${warpCost(s) - 4} more fuel: refine it from ice (5 each) in the refinery panel.`,
      );
      expect(goalProgress(s, 'warp')).toBe(`4/${warpCost(s)} fuel`);
      s.run.bank.fuel = warpCost(s);
      expect(goalHint(s)).toBeNull();
    });
  });

  it('reads state without touching it', () => {
    const s = fresh();
    addDrone(s);
    const before = JSON.stringify({ profile: s.profile, run: s.run });
    for (const g of GOALS) {
      goalDone(s, g.id);
      goalProgress(s, g.id);
    }
    goalHint(s);
    goalHint(s, AUTODOCK_OFF);
    currentGoal(s);
    expect(JSON.stringify({ profile: s.profile, run: s.run })).toBe(before);
  });

  it('a fresh save meets every goal on the way to its first warp, through HUD commands only', () => {
    // The bot plays through the same Commands as the HUD panels and never opens the menu.
    const s = newGame(1000);
    const seen = new Set<GoalId>();
    runBot(s, {
      seconds: 3600,
      before: (st) => {
        for (const g of GOALS) if (goalDone(st, g.id)) seen.add(g.id);
      },
      after: (st) => st.profile.stats.warps > 0,
    });
    expect(s.profile.stats.warps).toBe(1);
    expect(seen).toEqual(new Set(GOALS.filter((g) => g.id !== 'warp').map((g) => g.id)));
    expect(goalsVisible(s)).toBe(false);
  });
});
