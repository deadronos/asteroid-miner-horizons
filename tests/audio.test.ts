import { describe, expect, it } from 'vitest';
import {
  alarmLevel,
  beamHums,
  CENTER_CUTOFF,
  CUES,
  cueBatch,
  cueVoice,
  EDGE_CUTOFF,
  EDGE_GAIN,
  MAX_HUMS,
  MAX_VOICES,
  MIN_CUTOFF,
  PAN_WIDTH,
  PRESETS,
  RateLimiter,
  type CueKey,
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
    const ids: SoundId[] = [
      'crack',
      'collect',
      'dock',
      'impact',
      'explode',
      'warp',
      'uiClick',
      'uiDeny',
      'research',
      'achievement',
      'contractDone',
      'contractFail',
      'outpost',
      'loss',
    ];
    let started = 0;
    for (let i = 0; i < 40; i++) if (l.allow(ids[i % ids.length]!, i)) started++;
    expect(started).toBe(MAX_VOICES);
    l.release();
    expect(l.allow('crack', 100)).toBe(true);
  });
});

describe('event cues', () => {
  const keys = ['research', 'achievement', 'contractDone', 'contractFail', 'outpost', 'shipLoss'] as CueKey[];

  it('maps every cue key to its own preset at its pinned level', () => {
    // oxlint-disable-next-line unicorn/no-array-sort -- the sorted copies are test-local
    expect(Object.keys(CUES).sort()).toEqual([...keys].sort());
    expect(new Set(keys.map((k) => CUES[k])).size).toBe(keys.length);
    const levels = Object.fromEntries(keys.map((k) => [k, PRESETS[CUES[k]][0]]));
    expect(levels).toEqual({
      research: 0.5,
      achievement: 0.7,
      contractDone: 0.6,
      contractFail: 0.45,
      outpost: 0.55,
      shipLoss: 0.7,
    });
  });

  it('plays each cue dead centre at gain 1, so the preset level is applied once', () => {
    for (const k of keys) {
      expect(cueVoice(k)).toEqual({ id: CUES[k], gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
    }
  });

  it('plays a failed contract as its own cue without the deny buzz', () => {
    expect(cueBatch([{ level: 'warn', text: 'Contract failed: …', event: 'contractFail' }])).toEqual({
      deny: false,
      cues: ['contractFail'],
    });
    expect(
      cueBatch([
        { level: 'warn', text: 'Contract failed: …', event: 'contractFail' },
        { level: 'warn', text: 'Not enough resources in the station bank' },
      ]),
    ).toEqual({ deny: true, cues: ['contractFail'] });
  });

  it('lets an achievement unlocked with a contract payout replace the payout chime', () => {
    expect(
      cueBatch([
        { level: 'major', text: 'Contract complete: …', event: 'contractDone' },
        { level: 'major', text: 'Achievement unlocked: Contractor. …', achievement: 'contractor' },
      ]),
    ).toEqual({ deny: false, cues: ['achievement'] });
  });

  it('collapses a same-batch burst to one cue per identity', () => {
    expect(
      cueBatch([
        { level: 'major', text: 'A was destroyed.', event: 'shipLoss' },
        { level: 'major', text: 'B was destroyed.', event: 'shipLoss' },
        { level: 'major', text: 'C was destroyed.', event: 'shipLoss' },
      ]),
    ).toEqual({ deny: false, cues: ['shipLoss'] });
  });

  it('keeps the deny flag for warn lines and gathers achievement plus event identities in order', () => {
    expect(
      cueBatch([
        { level: 'info', text: 'Researched Optics 1.', event: 'research' },
        { level: 'warn', text: 'Not enough resources in the station bank' },
        {
          level: 'info',
          text: 'Outpost deployed on a large …',
          event: 'outpost',
        },
        {
          level: 'major',
          text: 'Achievement unlocked: …',
          achievement: 'firstCrack',
        },
      ]),
    ).toEqual({
      deny: true,
      cues: ['research', 'outpost', 'achievement'],
    });
  });

  it('paces research through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('research', 0)).toBe(true);
    expect(l.allow('research', 0.14)).toBe(false);
    expect(l.allow('research', 0.15)).toBe(true);
  });

  it('paces achievement through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('achievement', 0)).toBe(true);
    expect(l.allow('achievement', 0.49)).toBe(false);
    expect(l.allow('achievement', 0.5)).toBe(true);
  });

  it('paces contractDone through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('contractDone', 0)).toBe(true);
    expect(l.allow('contractDone', 0.29)).toBe(false);
    expect(l.allow('contractDone', 0.3)).toBe(true);
  });

  it('paces contractFail through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('contractFail', 0)).toBe(true);
    expect(l.allow('contractFail', 0.29)).toBe(false);
    expect(l.allow('contractFail', 0.3)).toBe(true);
  });

  it('paces outpost through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('outpost', 0)).toBe(true);
    expect(l.allow('outpost', 0.29)).toBe(false);
    expect(l.allow('outpost', 0.3)).toBe(true);
  });

  it('paces loss through MIN_GAP', () => {
    const l = new RateLimiter();
    expect(l.allow('loss', 0)).toBe(true);
    expect(l.allow('loss', 0.39)).toBe(false);
    expect(l.allow('loss', 0.4)).toBe(true);
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

  it('dulls sources toward the edge and when zoomed out', () => {
    expect(spatial({ x: 0, z: 0 }, view)[2]).toBe(CENTER_CUTOFF);
    expect(spatial({ x: 800, z: 0 }, view)[2]).toBeCloseTo(EDGE_CUTOFF);
    const mid = spatial({ x: 400, z: 0 }, view)[2];
    expect(mid).toBeLessThan(CENTER_CUTOFF);
    expect(mid).toBeGreaterThan(EDGE_CUTOFF);
    const zoomed = spatial({ x: 0, z: 0 }, { ...view, halfW: 3200, halfH: 1600 })[2];
    expect(zoomed).toBeCloseTo(CENTER_CUTOFF * Math.sqrt(420 / 1600) ** 1.5, 0);
    expect(spatial({ x: 1e9, z: 0 }, { ...view, halfW: 160000, halfH: 80000 })[2]).toBe(MIN_CUTOFF);
  });

  it('carries the cutoff onto positional voices but keeps stings open', () => {
    const streak = new Streak();
    const near = voiceFor({ t: 'crack', pos: { x: 0, z: 0 }, kind: 'ore', radius: 10 }, view, streak, 0)!;
    const far = voiceFor({ t: 'crack', pos: { x: 760, z: 0 }, kind: 'ore', radius: 10 }, view, streak, 0)!;
    expect(near.cutoff).toBe(CENTER_CUTOFF);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(voiceFor({ t: 'warp' }, view, streak, 0)!.cutoff).toBe(CENTER_CUTOFF);
    expect(voiceFor({ t: 'hazard', kind: 'flare', phase: 'warn' }, view, streak, 0)!.cutoff).toBe(CENTER_CUTOFF);
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

  it('dulls a beam hum toward the edge too', () => {
    const state = beamState(8);
    const centre = addBeam(state, 'drone', { x: 0, z: 0 });
    const side = addBeam(state, 'drone', { x: -700, z: 0 });
    const hums = beamHums(state.run, state.profile, view);
    expect(hums.find((h) => h.shipId === centre.id)!.cutoff).toBe(CENTER_CUTOFF);
    expect(hums.find((h) => h.shipId === side.id)!.cutoff).toBeLessThan(CENTER_CUTOFF);
  });

  it('raises pitch with dps, kept inside the [60, 320] band', () => {
    const state = beamState(4);
    const weak = addBeam(state, 'drone', { x: 0, z: 0 });
    weak.slots[0] = { type: 'laser', variant: 'focused', tier: 1 };
    const strong = addBeam(state, 'drone', { x: 100, z: 0 });
    strong.slots[0] = { type: 'laser', variant: 'focused', tier: 3 };

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
      expect(hz(kind, 'warn')).toEqual({ id: 'alarm', gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
  });

  it('thumps when a flare starts and is silent when a comet appears', () => {
    expect(hz('flare', 'start')).toEqual({ id: 'impact', gain: 0.9, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
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
