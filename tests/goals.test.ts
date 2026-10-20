import { describe, expect, it } from 'vitest';
import { runBot } from '../scripts/harness';
import { TUNING } from '../src/data/tuning';
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
import { send } from './helpers';

const done = (s: GameState): GoalId[] => GOALS.filter((g) => goalDone(s, g.id)).map((g) => g.id);

/** A fresh game whose flagship sits mid-belt with an order, so no blocker hint applies by default. */
const fresh = (): GameState => newGame(7);

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

  it('derives each goal from lifetime stats, and the unload from this run’s deposits', () => {
    const s = fresh();
    s.profile.stats.unitsMined = MINE_GOAL - 0.5;
    expect(goalDone(s, 'mine')).toBe(false);
    s.profile.stats.unitsMined = MINE_GOAL;
    s.run.runValue = 1;
    s.profile.stats.installs = 1;
    s.profile.stats.drones = 1;
    s.profile.stats.contracts = 1;
    expect(done(s)).toEqual(['mine', 'unload', 'install', 'drone', 'contract']);
    expect(currentGoal(s)?.id).toBe('warp');
    s.profile.stats.warps = 1;
    expect(currentGoal(s)).toBeNull();
  });

  it('the current goal is the first one not met, whatever order the others were met in', () => {
    const s = fresh();
    s.profile.stats.drones = 1;
    s.profile.stats.unitsMined = 100;
    expect(currentGoal(s)?.id).toBe('unload');
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
    send(t, { t: 'warp' });
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

    it('flags an idle drone, and names the mode to switch to', () => {
      const s = fresh();
      const d = addDrone(s);
      expect(goalHint(s)).toMatch(/Drone-1 is idle: .*AUTO/);
      d.aiMode = 'auto';
      expect(goalHint(s)).toMatch(/Drone-1 is idle: .*ASSIST/);
      d.aiTargetId = s.run.rocks[0]!.id;
      expect(goalHint(s)).toBeNull();
    });

    it('does not call a drone with a manual order idle', () => {
      const s = fresh();
      const d = addDrone(s);
      d.order = { kind: 'dock' };
      expect(goalHint(s)).toBeNull();
    });

    it('asks for fuel once the warp is the only goal left', () => {
      const s = fresh();
      Object.assign(s.profile.stats, { unitsMined: 50, installs: 1, drones: 1, contracts: 1 });
      s.run.runValue = 10;
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
