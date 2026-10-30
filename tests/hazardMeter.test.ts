import { describe, expect, it } from 'vitest';
import { runBot } from '../scripts/harness';
import { createHazardMeter, hullTotal, newTally, type HazardTally } from '../scripts/hazardMeter';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { SimIndex } from '../src/sim/index';
import { damageShip, flagship, shipStats } from '../src/sim/ships';
import type { Command } from '../src/sim/commands';
import type { GameState, Rock } from '../src/sim/types';
import { tick } from '../src/sim/update';
import { DT } from './helpers';

/** Runs `n` ticks with the meter around each one. */
function metered(state: GameState, n: number, commands: Command[] = []) {
  const meter = createHazardMeter(state, 'normal');
  const index = new SimIndex();
  const input = { thrust: { x: 0, z: 0 }, commands, hazards: 'off' as const };
  for (let i = 0; i < n; i++) {
    meter.before(state);
    tick(state, DT, input, index);
    meter.after(state);
  }
  return meter.tally;
}

const rockAt = (id: number, x: number, z: number, comet: boolean): Rock => ({
  id,
  kind: 'ice',
  size: 1,
  pos: { x, z },
  vel: { x: 0, z: 0 },
  radius: 20,
  hp: 1e6,
  maxHp: 1e6,
  units: 1,
  belt: 0,
  ...(comet ? { comet: true } : {}),
});

/** A game with the flagship bare (no shield) at `x` on the star axis. */
function bare(x: number): GameState {
  const s = newGame(7);
  const fs = flagship(s.run);
  fs.shield = 0;
  fs.pos = { x, z: 0 };
  fs.vel = { x: 0, z: 0 };
  return s;
}

describe('hazard meter', () => {
  it('starts empty', () => {
    expect(hullTotal(newTally())).toBe(0);
  });

  it('attributes star heat to heat', () => {
    const s = bare(0);
    s.run.ships[0]!.pos.x = (s.run.system.starRadius + s.run.system.heatRadius) / 2;
    const st = shipStats(flagship(s.run), s.profile);
    const hull0 = flagship(s.run).hull;
    const t = metered(s, 60);
    expect(t.hull.heat).toBeGreaterThan(0);
    expect(t.hull.heat).toBeCloseTo(hull0 - flagship(s.run).hull, 6);
    expect(hullTotal(t)).toBeCloseTo(t.hull.heat, 9);
    expect(t.shipsLost).toBe(0);
    expect(st.maxHull).toBeGreaterThan(0);
  });

  it.each([
    [false, 'collision'],
    [true, 'comet'],
  ] as const)('attributes a rock hit (comet=%s) to %s', (comet, source) => {
    const s = bare(s0X());
    const fs = flagship(s.run);
    s.run.rocks.push(rockAt(9000, fs.pos.x + 30, 0, comet));
    fs.vel = { x: 400, z: 0 };
    const t = metered(s, 2);
    expect(t.hull[source]).toBeGreaterThan(0);
    expect(hullTotal(t)).toBeCloseTo(t.hull[source], 9);
  });

  it('counts losses and attributes a kill to other', () => {
    const s = bare(s0X());
    const fs = flagship(s.run);
    const meter = createHazardMeter(s, 'normal');
    meter.before(s);
    damageShip(s, fs, 1e6);
    meter.after(s);
    expect(meter.tally.shipsLost).toBe(1);
    expect(meter.tally.hull.other).toBeGreaterThan(0);
  });

  it('records the ore spent on a repair', () => {
    const s = bare(0);
    const fs = flagship(s.run);
    fs.pos = { ...s.run.system.station.pos };
    const max = shipStats(fs, s.profile).maxHull;
    fs.hull = max / 2;
    s.run.bank.ore = 1e6;
    const before = s.run.bank.ore;
    const t = metered(s, 1, [{ t: 'repair', shipId: fs.id }]);
    expect(t.repairOre).toBe(Math.ceil((max / 2) * TUNING.repairOrePerHull));
    expect(t.repairOre).toBe(before - s.run.bank.ore);
  });

  it('splits armor, shields and hull so they add up to the raw damage', () => {
    const s = bare(s0X());
    const fs = flagship(s.run);
    fs.slots[fs.slots.length - 1] = { type: 'armor', variant: 'standard', tier: 1 };
    fs.slots[fs.slots.length - 2] = { type: 'shield', variant: 'standard', tier: 1 };
    fs.hull = shipStats(fs, s.profile).maxHull;
    fs.shield = 5;
    const meter = createHazardMeter(s, 'normal');
    meter.before(s);
    damageShip(s, fs, 20);
    meter.after(s);
    const t = meter.tally;
    expect(t.shield).toBeCloseTo(5, 0);
    expect(t.raw).toBeCloseTo(20, 0);
    expect(t.armor).toBeGreaterThan(0);
    expect(shipStats(fs, s.profile).maxShield).toBeGreaterThan(5);
    expect(t.armor + t.shield + hullTotal(t)).toBeCloseTo(t.raw, 6);
  });

  it('is deterministic for a seeded bot run', () => {
    const a = playBot();
    expect(a).toEqual(playBot());
    expect(a.raw).toBeGreaterThanOrEqual(hullTotal(a));
  });
});

const playBot = (): HazardTally => {
  const s = newGame(1000);
  const meter = createHazardMeter(s, 'normal');
  runBot(s, { seconds: 600, hazards: 'normal', before: meter.before, after: meter.after });
  return meter.tally;
};

/** A spot well clear of the star and of flares. */
function s0X(): number {
  return newGame(7).run.system.station.pos.x + 400;
}
