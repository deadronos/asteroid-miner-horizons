import { describe, expect, it } from 'vitest';
import { HAZARD_LEVELS } from '../src/data/hazards';
import { TUNING } from '../src/data/tuning';
import { newProfile, newRun } from '../src/sim/create';
import { newHazards } from '../src/sim/hazards';

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
