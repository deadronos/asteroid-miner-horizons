import { describe, expect, it } from 'vitest';
import { FLARES, HAZARD_LEVELS, type HazardLevel } from '../src/data/hazards';
import { TUNING } from '../src/data/tuning';
import { newProfile, newRun, SAVE_VERSION } from '../src/sim/create';
import { cometPathEscape, flareShelter, inFlareZone, newHazards, updateHazards } from '../src/sim/hazards';
import { SimIndex } from '../src/sim/index';
import { destroyRock } from '../src/sim/mining';
import { serialize } from '../src/sim/save';
import { flagship, shipStats } from '../src/sim/ships';
import type { GameState, Rock, StarClass } from '../src/sim/types';
import { tick } from '../src/sim/update';

const DT = 1 / 60;

/** A fresh game in system `number` (default 2, the first that schedules hazards). */
function game(seed: number, number = 2, starClass?: StarClass): GameState {
  const profile = { ...newProfile(seed), warps: number - 1 };
  const state: GameState = { version: SAVE_VERSION, profile, run: newRun(profile), out: { fx: [], log: [] } };
  if (starClass) state.run.system.starClass = starClass;
  return state;
}

function ticks(state: GameState, n: number, level?: HazardLevel, index = new SimIndex()): void {
  const input = { thrust: { x: 0, z: 0 }, commands: [], hazards: level };
  for (let i = 0; i < n; i++) tick(state, DT, input, index);
}

/** Calls `updateHazards` for `n` ticks, draining the outbox like the renderer would. */
function hazardTicks(state: GameState, n: number, level: HazardLevel = 'normal'): void {
  for (let i = 0; i < n; i++) {
    updateHazards(state, DT, level);
    state.out.fx.length = 0;
  }
}

const cometOf = (state: GameState): Rock | undefined => state.run.rocks.find((r) => r.comet);

/** Replaces the ship's last slot with a tier-2 shield so it has shields to soak damage. */
function fitShield(ship: ReturnType<typeof flagship>): void {
  ship.slots[ship.slots.length - 1] = { type: 'shield', tier: 2 };
}

/** A game whose first comet and flare are due within a second. */
function soonGame(seed: number): GameState {
  const s = game(seed);
  s.run.hazards.cometTimer = 1;
  s.run.hazards.flareTimer = 1;
  return s;
}

/** Clears rocks and parks every ship far from everything but the given point. */
function isolate(state: GameState): void {
  state.run.rocks = [];
  for (const s of state.run.ships) s.pos = { x: 1e5, z: 1e5 };
}

/** `run.rng.s`, id counter and first rocks of `newRun`, captured before hazards existed. */
const BASELINE = [
  {
    seed: 1,
    number: 1,
    s: -1430342020,
    nextId: 302,
    rocks: [
      [1, 300.3182736030201, -592.4334807647203],
      [2, 862.6636818666265, 28.6644938353327],
      [3, 355.7537296903146, -735.137726716316],
    ],
  },
  {
    seed: 1,
    number: 3,
    s: 837006207,
    nextId: 427,
    rocks: [
      [1, -381.3124428225711, -709.106902759745],
      [2, -600.5831166587377, -124.57197404109378],
      [3, -618.7240503690979, 48.25589772071216],
    ],
  },
  {
    seed: 42,
    number: 1,
    s: -1430341979,
    nextId: 302,
    rocks: [
      [1, 676.1289816097446, -213.18982575686252],
      [2, -318.96963341743293, 657.8481863046285],
      [3, 370.07052717773104, -614.6820938734148],
    ],
  },
  {
    seed: 42,
    number: 3,
    s: 1156712233,
    nextId: 420,
    rocks: [
      [1, -44.828257931023586, -640.3998916048129],
      [2, 649.4659707670269, -493.15771355271784],
      [3, 201.98508259112836, -576.1855043203815],
    ],
  },
];

describe('newHazards', () => {
  it('is deterministic per (seed, system)', () => {
    expect(newHazards(7, 3)).toEqual(newHazards(7, 3));
  });

  it('differs across systems and seeds', () => {
    expect(newHazards(7, 3).rng.s).not.toBe(newHazards(7, 4).rng.s);
    expect(newHazards(7, 3).rng.s).not.toBe(newHazards(8, 3).rng.s);
  });

  it('starts with timers past the grace period and nothing pending', () => {
    const h = newHazards(1, 2);
    expect(h.cometTimer).toBeGreaterThanOrEqual(TUNING.hazardFirstDelay);
    expect(h.flareTimer).toBeGreaterThanOrEqual(TUNING.hazardFirstDelay);
    expect(h.comet).toBeNull();
    expect(h.flare).toBeNull();
    expect([h.comets, h.flares]).toEqual([0, 0]);
  });
});

describe('newRun', () => {
  it('carries the hazard board for its system', () => {
    const profile = { ...newProfile(5), warps: 2 };
    expect(newRun(profile).hazards).toEqual(newHazards(5, 3));
  });

  it.each(BASELINE)('leaves run.rng and the rock layout unchanged (seed $seed, system $number)', (b) => {
    const profile = { ...newProfile(b.seed), warps: b.number - 1 };
    const run = newRun(profile);

    expect(run.rng.s).toBe(b.s);
    expect(run.nextId).toBe(b.nextId);
    expect(run.rocks.slice(0, 3).map((r) => [r.id, r.pos.x, r.pos.z])).toEqual(b.rocks);
  });
});

describe('hazard levels', () => {
  it('makes harsh more frequent and more damaging than normal', () => {
    expect(HAZARD_LEVELS.harsh.interval).toBeLessThan(HAZARD_LEVELS.normal.interval);
    expect(HAZARD_LEVELS.harsh.damage).toBeGreaterThan(HAZARD_LEVELS.normal.damage);
  });
});

/** An M-class game with an active flare and a lone flagship `d` units from the star, opposite the station. */
function flareGame(d: number): { state: GameState; ship: ReturnType<typeof flagship> } {
  const state = game(9, 3, 'M');
  isolate(state);
  state.run.hazards.cometTimer = 1e9;
  state.run.hazards.flare = { phase: 'active', timeLeft: 100 };
  const ship = flagship(state.run);
  const a = state.run.system.station.angle + Math.PI;
  ship.pos = { x: Math.cos(a) * d, z: Math.sin(a) * d };
  ship.vel = { x: 0, z: 0 };
  fitShield(ship);
  return { state, ship };
}

function flareLoss(level: HazardLevel): number {
  const { state, ship } = flareGame(900);
  const st = shipStats(ship, state.profile);
  ship.shield = st.maxShield / 2;
  const s0 = ship.shield;
  ticks(state, 1, level);
  return s0 + st.shieldRegen * DT - ship.shield;
}

describe('hazards off', () => {
  it('matches a baseline captured from main (20000 ticks, system 2, fixed thrust)', () => {
    const state = game(11);
    const input = { thrust: { x: 0.6, z: -0.8 }, commands: [], hazards: 'off' as const };
    const index = new SimIndex();
    for (let i = 0; i < 20000; i++) {
      tick(state, DT, input, index);
      state.out.fx.length = 0;
      state.out.log.length = 0;
    }
    const r = state.run;
    const f = flagship(r);
    expect(r.rng.s).toBe(-1930956570);
    expect(r.nextId).toBe(407);
    expect(r.rocks.length).toBe(405);
    expect(r.rocks.slice(0, 3).map((k) => [k.id, k.pos.x, k.pos.z])).toEqual([
      [1, 180.86515164712395, -890.5697562289197],
      [2, -811.5486710370128, -402.5501882204829],
      [3, 114.99408001282642, -861.6577792254508],
    ]);
    expect(f.pos).toEqual({ x: 39737.77081867497, z: -54411.30083316223 });
    expect(f.hull).toBe(1.7524576248181472);
  });

  it('is identical to a tick without the feature over 20000 ticks', () => {
    const a = game(11);
    const b = game(11);
    const timers = [a.run.hazards.cometTimer, a.run.hazards.flareTimer];
    ticks(a, 20000); // hazards absent
    ticks(b, 20000, 'off');
    expect(serialize(b)).toBe(serialize(a));
    expect(b.run.hazards.comet).toBeNull();
    expect(b.run.hazards.flare).toBeNull();
    expect([b.run.hazards.cometTimer, b.run.hazards.flareTimer]).toEqual(timers);
    expect(b.run.hazards.rng.s).toBe(newHazards(11, 2).rng.s);
    expect(b.run.rocks.some((r) => r.comet)).toBe(false);
  });

  it('never schedules in system 1', () => {
    const state = game(11, 1);
    const before = { ...state.run.hazards, rng: { ...state.run.hazards.rng } };
    ticks(state, 20000, 'harsh');
    const hz = state.run.hazards;
    expect(hz.comet).toBeNull();
    expect(hz.flare).toBeNull();
    expect([hz.comets, hz.flares]).toEqual([0, 0]);
    expect([hz.cometTimer, hz.flareTimer]).toEqual([before.cometTimer, before.flareTimer]);
  });
});

describe('determinism', () => {
  it('replays a normal run byte-identically', () => {
    const a = soonGame(7);
    const b = soonGame(7);
    ticks(a, 12000, 'normal');
    ticks(b, 12000, 'normal');
    expect(a.run.hazards.comets).toBeGreaterThan(0);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('never draws run.rng across warnings, spawns and flare cycles', () => {
    const state = game(5, 2, 'M');
    state.run.hazards.cometTimer = 0.1;
    state.run.hazards.flareTimer = 0.1;
    const s0 = state.run.rng.s;
    const next0 = state.run.nextId;
    hazardTicks(state, 20000);
    const hz = state.run.hazards;
    expect(hz.comets).toBeGreaterThan(1);
    expect(hz.flares).toBeGreaterThan(1);
    expect(state.run.rng.s).toBe(s0);
    expect(state.run.nextId).toBe(next0 + hz.comets); // only comet ids are taken
  });
});

describe('comets', () => {
  it('warns cometWarning seconds before the comet appears, from the hazard stream only', () => {
    const state = game(3);
    const hz = state.run.hazards;
    hz.cometTimer = 0.5;
    const id = state.run.nextId;
    let warnedAt = -1;
    let spawnedAt = -1;
    let warning: { timeLeft: number } | undefined;
    let logText: string | undefined;
    let warnFx: unknown;
    for (let i = 0; i < 2000 && spawnedAt < 0; i++) {
      updateHazards(state, DT, 'normal');
      if (hz.comet && warnedAt < 0) {
        warnedAt = i;
        warning = { ...hz.comet };
        logText = state.out.log.at(-1)?.text;
        warnFx = state.out.fx.at(-1);
      }
      if (cometOf(state)) spawnedAt = i;
    }
    expect(warnedAt).toBeGreaterThanOrEqual(0);
    expect(warning?.timeLeft).toBeCloseTo(TUNING.cometWarning, 1);
    expect(logText).toMatch(/Comet inbound/);
    expect(warnFx).toEqual({ t: 'hazard', kind: 'comet', phase: 'warn' });
    expect((spawnedAt - warnedAt) * DT).toBeCloseTo(TUNING.cometWarning, 1);
    const c = cometOf(state)!;
    expect(c.id).toBe(id);
    expect(state.run.nextId).toBe(id + 1);
    expect(hz.comet).toBeNull();
    expect(hz.comets).toBe(1);
    expect(hz.cometTimer).toBeGreaterThan(0);
    expect(c.kind).toBe('ice');
    expect(Math.hypot(c.pos.x, c.pos.z)).toBeCloseTo(TUNING.cometEdge, 3);
    expect(Math.hypot(c.vel.x, c.vel.z)).toBeCloseTo(TUNING.cometSpeed, 3);
    expect(state.out.fx.at(-1)).toMatchObject({ t: 'hazard', kind: 'comet', phase: 'start' });
  });

  it('aims through a belt and scales speed with the level', () => {
    const state = game(3);
    state.run.hazards.cometTimer = 0;
    updateHazards(state, DT, 'harsh');
    const w = state.run.hazards.comet!;
    expect(Math.hypot(w.vel.x, w.vel.z)).toBeCloseTo(TUNING.cometSpeed * HAZARD_LEVELS.harsh.damage, 3);
    expect(w.belt).toBeLessThan(state.run.system.belts.length);
    expect(state.run.hazards.cometTimer).toBeLessThanOrEqual(TUNING.cometInterval[1] * HAZARD_LEVELS.harsh.interval);
  });

  it('keeps every path out of the star heat zone across many seeds', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = game(seed, 2 + (seed % 4));
      state.run.hazards.cometTimer = 0;
      updateHazards(state, DT, 'normal');
      const w = state.run.hazards.comet!;
      const speed = Math.hypot(w.vel.x, w.vel.z);
      let min = Infinity;
      for (let t = 0; t <= (2 * TUNING.cometEdge) / speed; t += 0.25) {
        min = Math.min(min, Math.hypot(w.from.x + w.vel.x * t, w.from.z + w.vel.z * t));
      }
      expect(min).toBeGreaterThan(state.run.system.heatRadius);
    }
  });

  it('flies straight at constant velocity and is removed past the edge', () => {
    const state = game(3);
    isolate(state);
    state.run.hazards.cometTimer = 0;
    state.run.hazards.flareTimer = 1e9;
    const index = new SimIndex();
    ticks(state, 1, 'normal', index);
    ticks(state, Math.round(TUNING.cometWarning * 60) + 2, 'normal', index);
    const c = cometOf(state)!;
    expect(c).toBeDefined();
    state.run.hazards.cometTimer = 1e9;
    const vel = { ...c.vel };
    const p0 = { ...c.pos };
    const n = 600;
    ticks(state, n, 'normal', index);
    expect(c.vel).toEqual(vel);
    expect(c.pos.x).toBeCloseTo(p0.x + vel.x * n * DT, 6);
    expect(c.pos.z).toBeCloseTo(p0.z + vel.z * n * DT, 6);
    ticks(state, 4000, 'normal', index);
    expect(state.run.rocks).not.toContain(c);
  });

  it('is not despawned while still inbound outside the edge', () => {
    const state = game(3);
    state.run.hazards.cometTimer = 0;
    hazardTicks(state, Math.round(TUNING.cometWarning * 60) + 2);
    const c = cometOf(state)!;
    c.pos = { x: TUNING.cometEdge + 500, z: 0 };
    c.vel = { x: -130, z: 0 };
    hazardTicks(state, 1);
    expect(state.run.rocks).toContain(c);
  });

  it('still leaves, and pending warnings clear, when hazards are switched off mid-flight', () => {
    const state = game(3);
    isolate(state);
    state.run.hazards.cometTimer = 0;
    updateHazards(state, DT, 'normal');
    expect(state.run.hazards.comet).not.toBeNull();
    const timer = state.run.hazards.cometTimer;
    hazardTicks(state, 10, 'off');
    expect(state.run.hazards.comet).toBeNull();
    expect(state.run.hazards.cometTimer).toBe(timer); // not advanced

    state.run.hazards.cometTimer = 0;
    hazardTicks(state, Math.round(TUNING.cometWarning * 60) + 2);
    const c = cometOf(state)!;
    state.run.hazards.cometTimer = 0;
    updateHazards(state, DT, 'normal');
    expect(state.run.hazards.comet).not.toBeNull(); // a second warning pending
    const index = new SimIndex();
    ticks(state, 4500, 'off', index);
    expect(state.run.rocks).not.toContain(c);
    expect(state.run.hazards.comet).toBeNull();
  });

  it('does not shove the comet and hurts a ship in its path', () => {
    const state = game(3);
    isolate(state);
    const ship = flagship(state.run);
    state.run.hazards.cometTimer = 0;
    hazardTicks(state, Math.round(TUNING.cometWarning * 60) + 2);
    const c = cometOf(state)!;
    c.pos = { x: 2500, z: 0 };
    c.vel = { x: -130, z: 0 };
    c.radius = 40;
    ship.pos = { x: 2500 - 30, z: 0 };
    ship.vel = { x: 0, z: 0 };
    ship.collisionCd = 0;
    fitShield(ship);
    const st = shipStats(ship, state.profile);
    ship.shield = st.maxShield;
    const before = ship.hull + ship.shield;
    state.run.hazards.cometTimer = 1e9;
    ticks(state, 1, 'normal');
    expect(ship.hull + ship.shield).toBeLessThan(before - 20);
    expect(c.vel).toEqual({ x: -130, z: 0 });
    expect(c.comet).toBe(true);
  });

  it('cracks into ordinary fragments and conserves units', () => {
    const state = game(3);
    isolate(state);
    state.run.hazards.cometTimer = 0;
    hazardTicks(state, Math.round(TUNING.cometWarning * 60) + 2);
    const c = cometOf(state)!;
    expect(c.units).toBeGreaterThan(Math.round(TUNING.rockYieldK * c.radius * c.radius * state.run.system.richness));
    const total = (): number =>
      state.run.rocks.reduce((n, r) => n + r.units, 0) + state.run.pickups.reduce((n, p) => n + p.amount, 0);
    const before = total();
    const frags = destroyRock(state, c);
    expect(frags.length).toBeGreaterThan(0);
    expect(frags.every((f) => f.comet === undefined)).toBe(true);
    expect(state.run.rocks.some((r) => r.comet)).toBe(false);
    expect(total()).toBeCloseTo(before, 6);
  });
});

describe('solar flares', () => {
  it('never happen in G systems', () => {
    const state = game(9, 3, 'G');
    state.run.hazards.flareTimer = 0;
    const timer = state.run.hazards.flareTimer;
    hazardTicks(state, 20000);
    expect(state.run.hazards.flare).toBeNull();
    expect(state.run.hazards.flares).toBe(0);
    expect(state.run.hazards.flareTimer).toBe(timer);
  });

  it.each(['M', 'B'] as const)('cycle warning, active, subsided in %s systems', (cls) => {
    const state = game(9, 3, cls);
    const hz = state.run.hazards;
    hz.cometTimer = 1e9;
    hz.flareTimer = 0.05;
    const s0 = state.run.rng.s;
    let n = 0;
    while (!hz.flare && n++ < 100) hazardTicks(state, 1);
    expect(hz.flare).toEqual({ phase: 'warning', timeLeft: TUNING.flareWarning });
    expect(state.out.log.at(-1)?.text).toMatch(/Solar flare building/);

    let warn = 0;
    while (hz.flare?.phase === 'warning') {
      updateHazards(state, DT, 'normal');
      warn++;
    }
    expect(warn * DT).toBeCloseTo(TUNING.flareWarning, 1);
    expect(hz.flare?.phase).toBe('active');
    expect(state.out.log.at(-1)?.text).toMatch(/Solar flare!/);
    expect(state.out.fx.at(-1)).toEqual({ t: 'hazard', kind: 'flare', phase: 'start' });

    let active = 0;
    while (hz.flare) {
      updateHazards(state, DT, 'normal');
      active++;
    }
    expect(active * DT).toBeCloseTo(TUNING.flareDuration, 1);
    expect(hz.flares).toBe(1);
    expect(state.out.log.at(-1)?.text).toMatch(/subsided/);
    const [lo, hi] = FLARES[cls]!.interval;
    expect(hz.flareTimer).toBeGreaterThanOrEqual(lo);
    expect(hz.flareTimer).toBeLessThanOrEqual(hi);
    expect(state.run.rng.s).toBe(s0);
  });

  it('drain shields before hull', () => {
    const { state, ship } = flareGame(900);
    expect(state.run.system.heatRadius).toBeLessThan(900);
    const st = shipStats(ship, state.profile);
    ship.shield = st.maxShield / 2;
    const hull = ship.hull;
    ticks(state, 1, 'normal');
    expect(ship.shield).toBeLessThan(st.maxShield / 2 + st.shieldRegen * DT);
    expect(ship.hull).toBe(hull);
    ship.shield = 0;
    ticks(state, 1, 'normal');
    expect(ship.hull).toBeLessThan(hull);
  });

  it('leave a docked ship untouched', () => {
    const { state, ship } = flareGame(900);
    ship.pos = { ...state.run.system.station.pos };
    const st = shipStats(ship, state.profile);
    ship.shield = st.maxShield;
    ticks(state, 60, 'harsh');
    expect(ship.shield).toBe(st.maxShield);
    expect(ship.hull).toBe(st.maxHull);
  });

  it('deal nothing beyond reach', () => {
    const { state, ship } = flareGame(FLARES.M!.reach + 50);
    const st = shipStats(ship, state.profile);
    ship.shield = st.maxShield;
    ticks(state, 60, 'harsh');
    expect(ship.shield).toBe(st.maxShield);
    expect(ship.hull).toBe(st.maxHull);
  });

  it('scale with the level', () => {
    expect(flareLoss('harsh') / flareLoss('normal')).toBeCloseTo(HAZARD_LEVELS.harsh.damage, 5);
  });

  it('does not restart a flare when hazards are toggled off and on mid-flare', () => {
    const state = game(9, 3, 'M');
    const hz = state.run.hazards;
    hz.cometTimer = 1e9;
    hz.flareTimer = 0;
    hazardTicks(state, 1);
    expect(hz.flare?.phase).toBe('warning');
    expect(hz.flareTimer).toBeGreaterThanOrEqual(FLARES.M!.interval[0]);
    hazardTicks(state, 5, 'off');
    expect(hz.flare).toBeNull();
    hazardTicks(state, 5);
    expect(hz.flare).toBeNull();
  });

  it('logs one destruction when a comet kills a ship during an active flare', () => {
    const state = game(9, 3, 'M');
    isolate(state);
    const ship = flagship(state.run);
    state.run.hazards.cometTimer = 0;
    hazardTicks(state, Math.round(TUNING.cometWarning * 60) + 2);
    const c = cometOf(state)!;
    state.run.hazards.cometTimer = 1e9;
    state.run.hazards.flare = { phase: 'active', timeLeft: 100 };
    const a = state.run.system.station.angle + Math.PI;
    c.pos = { x: Math.cos(a) * 900, z: Math.sin(a) * 900 };
    c.vel = { x: -Math.cos(a) * 130, z: -Math.sin(a) * 130 };
    c.radius = 40;
    ship.pos = { x: c.pos.x - Math.cos(a) * 30, z: c.pos.z - Math.sin(a) * 30 };
    ship.vel = { x: 0, z: 0 };
    ship.collisionCd = 0;
    ship.hull = 0.5;
    state.out.fx.length = 0;
    state.out.log.length = 0;
    ticks(state, 1, 'normal');
    expect(state.out.fx.filter((f) => f.t === 'explode')).toHaveLength(1);
    expect(state.out.log.filter((l) => /destroyed/.test(l.text))).toHaveLength(1);
  });

  it('deal nothing when hazards are off', () => {
    const { state, ship } = flareGame(900);
    const st = shipStats(ship, state.profile);
    ship.shield = st.maxShield;
    ticks(state, 60, 'off');
    expect(state.run.hazards.flare).toBeNull();
    expect(ship.shield).toBe(st.maxShield);
  });
});

describe('hazard predicates for the AI', () => {
  it('inFlareZone holds only while a flare is pending or burning, within reach plus the pad', () => {
    const s = game(1, 2, 'M');
    const edge = FLARES.M!.reach + TUNING.flareShelterPad;
    const inside = { x: edge - 10, z: 0 };
    const outside = { x: edge + 10, z: 0 };
    expect(inFlareZone(s.run, inside)).toBe(false);
    s.run.hazards.flare = { phase: 'warning', timeLeft: 5 };
    expect(inFlareZone(s.run, inside)).toBe(true);
    expect(inFlareZone(s.run, outside)).toBe(false);
    s.run.hazards.flare.phase = 'active';
    expect(inFlareZone(s.run, inside)).toBe(true);
    s.run.system.starClass = 'G';
    expect(inFlareZone(s.run, inside)).toBe(false);
  });

  it('cometPathEscape flags points on the path ahead and points straight out of it', () => {
    const s = game(1);
    const out = { x: 0, z: 0 };
    expect(cometPathEscape(s.run, [], { x: 0, z: 10 }, 40, out)).toBe(false);
    s.run.hazards.comet = { from: { x: -3000, z: 0 }, vel: { x: 130, z: 0 }, belt: 0, timeLeft: 5 };
    expect(cometPathEscape(s.run, [], { x: 0, z: 10 }, 40, out)).toBe(true);
    expect(out.z).toBeCloseTo(1);
    expect(cometPathEscape(s.run, [], { x: 0, z: -10 }, 40, out)).toBe(true);
    expect(out.z).toBeCloseTo(-1);
    expect(cometPathEscape(s.run, [], { x: 0, z: 200 }, 40, out)).toBe(false); // beside
    expect(cometPathEscape(s.run, [], { x: -3300, z: 0 }, 40, out)).toBe(false); // behind

    s.run.hazards.comet = null;
    const comet: Rock = {
      id: 1,
      kind: 'ice',
      size: 0,
      pos: { x: 0, z: 0 },
      vel: { x: 0, z: 130 },
      radius: 40,
      hp: 1,
      maxHp: 1,
      units: 1,
      belt: 0,
      comet: true,
    };
    expect(cometPathEscape(s.run, [comet], { x: 5, z: 300 }, 40, out)).toBe(true);
    expect(out.x).toBeCloseTo(1);
    expect(cometPathEscape(s.run, [comet], { x: 0, z: 0 }, 40, out)).toBe(true); // its own body
    expect(cometPathEscape(s.run, [comet], { x: 0, z: -200 }, 40, out)).toBe(false);
  });

  it('flareShelter docks near the station and otherwise flees to just outside the zone', () => {
    const s = game(1, 2, 'M');
    s.run.hazards.flare = { phase: 'warning', timeLeft: 5 };
    const st = s.run.system.station.pos;
    const out = { x: 0, z: 0 };
    expect(flareShelter(s.run, { x: st.x * 1.05, z: st.z * 1.05 }, false, out)).toBe('dock');
    const far = { x: -st.x * 1.2, z: -st.z * 1.2 }; // opposite the station, inside the zone
    expect(inFlareZone(s.run, far)).toBe(true);
    expect(flareShelter(s.run, far, false, out)).toBe('flee');
    expect(inFlareZone(s.run, out)).toBe(false);
    expect(flareShelter(s.run, far, true, out)).toBe('dock');
  });
});
