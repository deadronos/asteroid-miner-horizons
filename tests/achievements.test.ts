import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, STAT_KEYS } from '../src/data/achievements';
import { achievementProgress, newStats, updateAchievements } from '../src/sim/achievements';
import { applyCommand } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { destroyRock } from '../src/sim/mining';
import { damageShip, flagship, makeShip } from '../src/sim/ships';
import { serialize } from '../src/sim/save';
import type { GameState } from '../src/sim/types';
import { achievementRows, groupDigits, statRows } from '../src/ui/menu/StatsTab';
import { runTicks } from './helpers';

const unlockLogs = (s: GameState) => s.out.log.filter((l) => l.achievement);

describe('lifetime stats', () => {
  it('start at zero with nothing unlocked', () => {
    const s = newGame(1);
    expect(s.profile.stats).toEqual(newStats());
    expect(Object.keys(s.profile.stats)).toEqual([...STAT_KEYS]);
    expect(s.profile.achievements).toEqual([]);
  });

  it('count play time in sim seconds', () => {
    const s = newGame(1);
    runTicks(s, 120);
    expect(s.profile.stats.time).toBeCloseTo(2, 9);
  });

  it('count broken rocks and lost ships', () => {
    const s = newGame(1);
    destroyRock(s, s.run.rocks[0]!);
    destroyRock(s, s.run.rocks[0]!);
    const drone = makeShip(s.run, s.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
    s.run.ships.push(drone);
    damageShip(s, drone, 1e6);
    expect(s.profile.stats.rocksBroken).toBe(2);
    expect(s.profile.stats.shipsLost).toBe(1);
  });

  it('count units collected from debris', () => {
    const s = newGame(1);
    const fs = flagship(s.run);
    s.run.pickups.push({ id: 9999, kind: 'ore', amount: 3, pos: { ...fs.pos }, vel: { x: 0, z: 0 }, age: 0 });
    runTicks(s, 1);
    expect(s.profile.stats.unitsMined).toBe(3);
  });

  it('count warps, research and launches, and survive the warp', () => {
    const s = newGame(1);
    s.profile.data = 5;
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 1000 };
    applyCommand(s, { t: 'buyPerk', perk: 'optics' });
    applyCommand(s, { t: 'buyHull', hullId: 'drone' });
    applyCommand(s, { t: 'warp' });
    expect(s.profile.stats).toMatchObject({ perks: 1, drones: 1, warps: 1 });
  });

  it('do not count rejected commands', () => {
    const s = newGame(1);
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    applyCommand(s, { t: 'buyPerk', perk: 'optics' });
    applyCommand(s, { t: 'buyHull', hullId: 'drone' });
    applyCommand(s, { t: 'warp' });
    expect(s.profile.stats).toEqual(newStats());
  });
});

describe('achievements', () => {
  it('unlock once, with a major log line naming the achievement', () => {
    const s = newGame(1);
    s.out.log.length = 0;
    destroyRock(s, s.run.rocks[0]!);
    runTicks(s, 2);
    expect(s.profile.achievements).toEqual(['firstCrack']);
    expect(unlockLogs(s)).toEqual([
      { level: 'major', text: 'Achievement unlocked: First Crack. Break an asteroid.', achievement: 'firstCrack' },
    ]);
  });

  it('unlock every threshold reached in one pass, in table order, without touching the run', () => {
    const s = newGame(1);
    for (const k of STAT_KEYS) s.profile.stats[k] = 1e9;
    const runBefore = JSON.stringify(s.run);
    updateAchievements(s);
    expect(s.profile.achievements).toEqual(ACHIEVEMENT_IDS);
    expect(unlockLogs(s)).toHaveLength(ACHIEVEMENT_IDS.length);
    expect(JSON.stringify(s.run)).toBe(runBefore);
  });

  it('leave one stat short of its threshold locked', () => {
    const s = newGame(1);
    s.profile.stats.warps = ACHIEVEMENTS.wanderer.at - 1;
    updateAchievements(s);
    expect(s.profile.achievements).toEqual(['firstJump']);
    expect(achievementProgress(s.profile, 'wanderer')).toEqual({ value: 4, target: 5 });
    expect(achievementProgress(s.profile, 'firstJump')).toEqual({ value: 1, target: 1 });
  });

  it('keep the run deterministic and survive a save round-trip', () => {
    const a = newGame(3);
    const b = newGame(3);
    runTicks(a, 600);
    runTicks(b, 600);
    expect(serialize(a)).toBe(serialize(b));
    a.profile.achievements.push('wingman');
    expect(JSON.parse(serialize(a)).profile.achievements).toEqual(['wingman']);
  });

  it('have a unique name and a positive threshold each', () => {
    const names = ACHIEVEMENT_IDS.map((id) => ACHIEVEMENTS[id].name);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ACHIEVEMENT_IDS) expect(ACHIEVEMENTS[id].at).toBeGreaterThan(0);
  });
});

describe('Stats tab text', () => {
  it('groups digits and formats play time', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(999.9)).toBe('999');
    expect(groupDigits(1234567)).toBe('1,234,567');
  });

  it('lists every stat with its value', () => {
    const s = newGame(1);
    s.profile.stats.unitsMined = 12345.6;
    s.profile.stats.time = 7200;
    const rows = statRows(s.profile);
    expect(rows).toHaveLength(STAT_KEYS.length);
    expect(rows).toContainEqual(['Units mined', '12,345']);
    expect(rows).toContainEqual(['Time played', '2h 00m']);
  });

  it('lists unlocked achievements first, in unlock order, then progress on the rest', () => {
    const s = newGame(1);
    s.profile.achievements = ['wingman', 'firstCrack'];
    s.profile.stats.rocksBroken = 37;
    s.profile.stats.time = 600;
    const rows = achievementRows(s.profile);
    expect(rows).toHaveLength(ACHIEVEMENT_IDS.length);
    expect(rows.slice(0, 2).map((r) => [r.name, r.status])).toEqual([
      ['Wingman', 'Unlocked'],
      ['First Crack', 'Unlocked'],
    ]);
    expect(rows.find((r) => r.name === 'Rockbreaker')).toMatchObject({ unlocked: false, status: '37 / 500' });
    expect(rows.find((r) => r.name === 'Settling In')?.status).toBe('10m / 30m');
  });
});
