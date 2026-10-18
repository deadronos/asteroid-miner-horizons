import { describe, expect, it } from 'vitest';
import {
  alarmLevel,
  beamHums,
  EDGE_GAIN,
  MAX_HUMS,
  MAX_VOICES,
  PAN_WIDTH,
  PRESETS,
  RateLimiter,
  type SoundId,
  Streak,
  spatial,
  voiceFor,
} from '../src/audio/sfx';
import { ZZFX_RATE, zzfxSamples } from '../src/audio/zzfx';
import { newGame } from '../src/sim/create';
import { makeShip } from '../src/sim/ships';

const view = { center: { x: 0, z: 0 }, halfW: 800, halfH: 400 };

describe('zzfx presets', () => {
  for (const id of Object.keys(PRESETS) as SoundId[]) {
    it(`${id} renders a short, finite, audible, unclipped sound`, () => {
      const s = zzfxSamples(PRESETS[id], () => 0.5);
      expect(s.length).toBeGreaterThan(ZZFX_RATE * 0.01);
      expect(s.length).toBeLessThan(ZZFX_RATE * 2);
      let peak = 0;
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThanOrEqual(1.6);
    });
  }
});

describe('rate limiter', () => {
  it('spaces out repeats of the same sound', () => {
    const l = new RateLimiter();
    expect(l.allow('collect', 0)).toBe(true);
    expect(l.allow('collect', 0.01)).toBe(false);
    expect(l.allow('crack', 0.01)).toBe(true);
    expect(l.allow('collect', 0.2)).toBe(true);
  });

  it('caps simultaneous voices and frees them on release', () => {
    const l = new RateLimiter();
    const ids: SoundId[] = ['crack', 'collect', 'dock', 'impact', 'explode', 'warp', 'uiClick', 'uiDeny'];
    let started = 0;
    for (let i = 0; i < 40; i++) if (l.allow(ids[i % ids.length]!, i)) started++;
    expect(started).toBe(MAX_VOICES);
    l.release();
    expect(l.allow('crack', 100)).toBe(true);
  });
});

describe('spatial mixing', () => {
  it('is full volume at the centre, quieter toward the edge and silent well off screen', () => {
    expect(spatial({ x: 0, z: 0 }, view)[0]).toBe(1);
    expect(spatial({ x: 400, z: 0 }, view)[0]).toBeCloseTo(0.8);
    expect(spatial({ x: 800, z: 0 }, view)[0]).toBeCloseTo(EDGE_GAIN);
    expect(spatial({ x: 800 * 1.25, z: 0 }, view)[0]).toBeCloseTo(EDGE_GAIN / 2);
    expect(spatial({ x: 5000, z: 0 }, view)[0]).toBe(0);
  });

  it('pans by horizontal screen position, widest at the edge', () => {
    expect(spatial({ x: -800, z: 0 }, view)[1]).toBeCloseTo(-PAN_WIDTH);
    expect(spatial({ x: 800, z: 0 }, view)[1]).toBeCloseTo(PAN_WIDTH);
    expect(spatial({ x: 0, z: 300 }, view)[1]).toBe(0);
  });

  it('hears a drone mining off to the side on that side and quieter', () => {
    const state = beamState(7);
    const centre = addBeam(state, 'drone', { x: 0, z: 0 });
    const side = addBeam(state, 'drone', { x: -700, z: 0 });
    const hums = beamHums(state.run, state.profile, view);
    const c = hums.find((h) => h.shipId === centre.id)!;
    const s = hums.find((h) => h.shipId === side.id)!;
    expect(s.pan).toBeLessThan(-0.5);
    expect(s.gain).toBeLessThan(c.gain);
  });

  it('attenuates everything when zoomed out, but never below a floor', () => {
    const near = spatial({ x: 0, z: 0 }, view)[0];
    const out = spatial({ x: 0, z: 0 }, { ...view, halfW: 3200, halfH: 1600 })[0];
    const overview = spatial({ x: 0, z: 0 }, { ...view, halfW: 80000, halfH: 40000 })[0];
    expect(out).toBeLessThan(near);
    expect(out).toBeCloseTo(Math.sqrt(420 / 1600));
    expect(overview).toBeCloseTo(0.4);
  });

  it('drops off-screen fx entirely but always plays warp', () => {
    const streak = new Streak();
    expect(voiceFor({ t: 'impact', pos: { x: 9000, z: 0 } }, view, streak, 0)).toBeNull();
    expect(voiceFor({ t: 'warp' }, view, streak, 0)?.id).toBe('warp');
  });

  it('makes bigger cracks louder and lower', () => {
    const s = new Streak();
    const small = voiceFor({ t: 'crack', pos: { x: 0, z: 0 }, kind: 'ore', radius: 6 }, view, s, 0)!;
    const big = voiceFor({ t: 'crack', pos: { x: 0, z: 0 }, kind: 'ore', radius: 40 }, view, s, 0)!;
    expect(big.gain).toBeGreaterThan(small.gain);
    expect(big.rate).toBeLessThan(small.rate);
  });
});

describe('pickup streak', () => {
  it('climbs in pitch during a run and resets after a pause', () => {
    const s = new Streak();
    const a = s.next(0);
    const b = s.next(0.2);
    const c = s.next(0.4);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(s.next(2)).toBe(1);
    for (let t = 0; t < 40; t++) s.next(3 + t * 0.1);
    expect(s.next(7.05)).toBeCloseTo(2);
  });
});

/** A game whose fleet is exactly the ships the test adds (the flagship is dropped). */
function beamState(seed: number) {
  const state = newGame(seed);
  state.run.ships.length = 0;
  return state;
}

/** The ship the HUD has selected (what the alarm keys off). */
function selected(state: ReturnType<typeof newGame>) {
  return state.run.ships.find((s) => s.id === state.run.selectedId)!;
}

/** Adds a ship with its beam aimed at a (fictional) rock id 1. */
function addBeam(
  state: ReturnType<typeof newGame>,
  hullId: 'prospector' | 'excavator' | 'drone' | 'harvester',
  pos: { x: number; z: number },
) {
  const ship = makeShip(state.run, state.profile, hullId, 'Beamer', pos);
  ship.beamOn = true;
  ship.beamTargetId = 1;
  state.run.ships.push(ship);
  return ship;
}

describe('beam hums', () => {
  for (const x of [-400, 400]) {
    it(`hums once for an on-screen beam at x=${x} and pans with its offset`, () => {
      const state = beamState(1);
      const ship = addBeam(state, 'prospector', { x, z: 0 });
      const hums = beamHums(state.run, state.profile, view);
      expect(hums).toHaveLength(1);
      expect(hums[0]!.shipId).toBe(ship.id);
      expect(hums[0]!.gain).toBeCloseTo(0.8);
      expect(Math.sign(hums[0]!.pan)).toBe(Math.sign(x));
    });
  }

  it('ignores a beam that is off screen', () => {
    const state = beamState(1);
    addBeam(state, 'prospector', { x: 5000, z: 0 });
    expect(beamHums(state.run, state.profile, view)).toHaveLength(0);
  });

  it('ignores ships that are not firing, have no target, or are dead', () => {
    const state = beamState(1);
    const idle = addBeam(state, 'drone', { x: 0, z: 0 });
    idle.beamOn = false;
    const noTarget = addBeam(state, 'drone', { x: 0, z: 0 });
    noTarget.beamTargetId = null;
    const dead = addBeam(state, 'drone', { x: 0, z: 0 });
    dead.respawn = 3;
    expect(beamHums(state.run, state.profile, view)).toHaveLength(0);
  });

  it('never returns more than MAX_HUMS hums', () => {
    const state = beamState(2);
    for (let i = 0; i < 6; i++) addBeam(state, 'drone', { x: i * 40, z: 0 });
    const hums = beamHums(state.run, state.profile, view);
    expect(hums).toHaveLength(MAX_HUMS);
    expect(new Set(hums.map((h) => h.shipId)).size).toBe(MAX_HUMS);
  });

  it('orders hums loudest first, breaking ties by id', () => {
    const state = beamState(3);
    const quiet = addBeam(state, 'drone', { x: 1100, z: 0 });
    const mid = addBeam(state, 'drone', { x: 1000, z: 0 });
    const loudB = addBeam(state, 'drone', { x: 0, z: 0 });
    const loudA = addBeam(state, 'drone', { x: 0, z: 0 });

    const hums = beamHums(state.run, state.profile, view);
    expect(hums.map((h) => h.shipId)).toEqual([loudB.id, loudA.id, mid.id, quiet.id]);
    const gains = hums.map((h) => h.gain);
    expect(gains[0]).toBe(1);
    expect(gains[1]).toBe(1);
    expect(gains[2]).toBeCloseTo(0.3);
    expect(gains[3]).toBeCloseTo(0.15);
  });

  it('raises pitch with dps, kept inside the [60, 320] band', () => {
    const state = beamState(4);
    const weak = addBeam(state, 'drone', { x: 0, z: 0 });
    weak.slots[0] = { type: 'laser', tier: 1 };
    const strong = addBeam(state, 'drone', { x: 100, z: 0 });
    strong.slots[0] = { type: 'laser', tier: 3 };

    const hums = beamHums(state.run, state.profile, view);
    for (const h of hums) {
      expect(h.freq).toBeGreaterThanOrEqual(60);
      expect(h.freq).toBeLessThanOrEqual(320);
    }
    const weakFreq = hums.find((h) => h.shipId === weak.id)!.freq;
    const strongFreq = hums.find((h) => h.shipId === strong.id)!.freq;
    expect(strongFreq).toBeGreaterThan(weakFreq);
  });
});

describe('hazard sounds', () => {
  const streak = new Streak();
  const hz = (kind: 'comet' | 'flare', phase: 'warn' | 'start') =>
    voiceFor({ t: 'hazard', kind, phase }, view, streak, 0);

  it('maps any warning to the alarm', () => {
    for (const kind of ['comet', 'flare'] as const)
      expect(hz(kind, 'warn')).toEqual({ id: 'alarm', gain: 1, pan: 0, rate: 1 });
  });

  it('thumps when a flare starts and is silent when a comet appears', () => {
    expect(hz('flare', 'start')).toEqual({ id: 'impact', gain: 0.9, pan: 0, rate: 1 });
    expect(hz('comet', 'start')).toBeNull();
  });

  it('raises the alarm for an undocked ship inside an active flare, but not docked or out of reach', () => {
    const state = newGame(9);
    state.run.system.starClass = 'M';
    state.run.hazards.flare = { phase: 'active', timeLeft: 5 };
    const ship = state.run.ships.find((s) => s.id === state.run.selectedId)!;
    ship.pos = { x: -800, z: 0 };
    expect(alarmLevel(state.run, state.profile)).toBeGreaterThanOrEqual(0.5);
    ship.pos = { x: -1500, z: 0 };
    expect(alarmLevel(state.run, state.profile)).toBe(0);
    ship.pos = { x: -800, z: 0 };
    state.run.hazards.flare = { phase: 'warning', timeLeft: 5 };
    expect(alarmLevel(state.run, state.profile)).toBe(0);
    state.run.hazards.flare = { phase: 'active', timeLeft: 5 };
    ship.pos = { ...state.run.system.station.pos };
    expect(alarmLevel(state.run, state.profile)).toBe(0);
  });
});

describe('alarm level', () => {
  it('is silent for a healthy selected ship away from the star', () => {
    const state = newGame(5);
    selected(state).pos = { x: 5000, z: 0 };
    expect(alarmLevel(state.run, state.profile)).toBe(0);
  });

  it('rises while the selected hull is below 25%', () => {
    const state = newGame(6);
    const ship = selected(state);
    ship.pos = { x: 5000, z: 0 };
    ship.hull = 1;
    expect(alarmLevel(state.run, state.profile)).toBeGreaterThan(0);
  });

  it('rises while the selected ship is inside the star heat radius', () => {
    const state = newGame(7);
    selected(state).pos = { x: 0, z: 0 };
    expect(alarmLevel(state.run, state.profile)).toBeGreaterThan(0);
  });

  it('starts at the minimum urgency just inside the heat edge', () => {
    const state = newGame(8);
    const { starRadius, heatRadius } = state.run.system;
    selected(state).pos = { x: 0, z: starRadius + (heatRadius - starRadius) * 0.999 };
    expect(alarmLevel(state.run, state.profile)).toBeCloseTo(0.2, 5);
  });
});
