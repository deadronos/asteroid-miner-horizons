import { describe, expect, it } from 'vitest';
import {
  DUCK,
  Ducker,
  duckEnvelope,
  LIMITER,
  REVERB_DECAY,
  REVERB_SECONDS,
  REVERB_SEND,
  reverbImpulse,
} from '../src/audio/mix';

/** Deterministic LCG so impulse assertions replay exactly. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

describe('limiter settings', () => {
  it('is a hard-knee limiter below full scale', () => {
    expect(LIMITER).toEqual({ threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
  });
});

describe('reverb send table', () => {
  it('sends only the positional milestones and the event chimes', () => {
    expect(REVERB_SEND).toEqual({
      explode: 0.32,
      dock: 0.22,
      collect: 0.12,
      achievement: 0.22,
      contractDone: 0.22,
      loss: 0.32,
    });
    expect(REVERB_SEND.crack).toBeUndefined();
    expect(REVERB_SEND.research).toBeUndefined();
    expect(REVERB_SEND.outpost).toBeUndefined();
    expect(REVERB_SEND.contractFail).toBeUndefined();
    expect(REVERB_SEND.alarm).toBeUndefined();
    expect(REVERB_SEND.uiClick).toBeUndefined();
  });
});

describe('generated reverb impulse', () => {
  it('is stereo, finite, bounded and decays toward silence', () => {
    const [left, right] = reverbImpulse(8000, 1, REVERB_DECAY, seeded(7));
    expect(left).toHaveLength(8000);
    expect(right).toHaveLength(8000);
    let early = 0;
    let late = 0;
    for (let i = 0; i < left.length; i++) {
      expect(Number.isFinite(left[i]!)).toBe(true);
      expect(Number.isFinite(right[i]!)).toBe(true);
      expect(Math.abs(left[i]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(right[i]!)).toBeLessThanOrEqual(1);
      if (i < left.length / 4) early += Math.abs(left[i]!);
      else if (i > (left.length * 3) / 4) late += Math.abs(left[i]!);
    }
    expect(early).toBeGreaterThan(late * 10);
    expect(left[0]).not.toBe(right[0]);
  });

  it('replays identically for the same injected RNG', () => {
    const a = reverbImpulse(8000, 0.5, REVERB_DECAY, seeded(11));
    const b = reverbImpulse(8000, 0.5, REVERB_DECAY, seeded(11));
    expect(Array.from(a[0])).toEqual(Array.from(b[0]));
    expect(Array.from(a[1])).toEqual(Array.from(b[1]));
  });

  it('uses the 1.8 s default length', () => {
    expect(reverbImpulse(1000)[0]).toHaveLength(Math.floor(1000 * REVERB_SECONDS));
  });
});

describe('music duck', () => {
  const shape = { depth: 0.5, attack: 0.1, hold: 0.2, release: 0.4 };

  it('ramps down, holds, then ramps back to nothing', () => {
    expect(duckEnvelope(shape, -0.1)).toBe(0);
    expect(duckEnvelope(shape, 0)).toBe(0);
    expect(duckEnvelope(shape, 0.05)).toBeCloseTo(0.5);
    expect(duckEnvelope(shape, 0.1)).toBe(1);
    expect(duckEnvelope(shape, 0.25)).toBe(1);
    expect(duckEnvelope(shape, 0.5)).toBeCloseTo(0.5);
    expect(duckEnvelope(shape, 0.7)).toBeCloseTo(0);
    expect(duckEnvelope(shape, 5)).toBe(0);
  });

  it('ducks under the alarm and big impacts, never under pickups or cracks', () => {
    expect(new Set(Object.keys(DUCK))).toEqual(new Set(['alarm', 'explode', 'loss', 'warp']));
    for (const s of Object.values(DUCK)) {
      expect(s.depth).toBeGreaterThan(0);
      expect(s.depth).toBeLessThan(1);
    }
    const d = new Ducker();
    for (let i = 0; i < 20; i++) {
      d.trigger('collect', 1, i * 0.07);
      d.trigger('crack', 1, i * 0.07);
      expect(d.level(i * 0.07 + 0.01)).toBe(1);
    }
  });

  it('dips the music for an explosion, scaled by its gain, then fully recovers', () => {
    const near = new Ducker();
    const far = new Ducker();
    near.trigger('explode', 1, 10);
    far.trigger('explode', 0.3, 10);
    const s = DUCK.explode!;
    const held = 10 + s.attack + s.hold / 2;
    expect(near.level(held)).toBeCloseTo(1 - s.depth);
    expect(far.level(held)).toBeCloseTo(1 - 0.3 * s.depth);
    expect(near.level(10 + s.attack + s.hold + s.release)).toBe(1);
  });

  it('holds steady under a repeating alarm instead of pumping', () => {
    const d = new Ducker();
    const s = DUCK.alarm!;
    // The engine repeats the alarm every 1.1 s; sample every frame across several repeats.
    const levels: number[] = [];
    for (let t = 0; t < 5; t += 1 / 60) {
      if (Math.abs(t / 1.1 - Math.round(t / 1.1)) < 1 / 120) d.trigger('alarm', 0.85, t);
      if (t > 1.1) levels.push(d.level(t));
      else d.level(t);
    }
    const floor = 1 - 0.85 * s.depth;
    // Between repeats the music may recover a little, but never back to full.
    expect(Math.min(...levels)).toBeCloseTo(floor);
    expect(Math.max(...levels)).toBeLessThan(1);
  });

  it('takes the deepest overlapping dip rather than restarting or stacking', () => {
    const d = new Ducker();
    const s = DUCK.explode!;
    d.trigger('explode', 1, 0);
    expect(d.level(s.attack)).toBeCloseTo(1 - s.depth);
    // A second boom mid-hold starts its own attack from zero; the first keeps the music down.
    d.trigger('explode', 1, s.attack + 0.01);
    expect(d.level(s.attack + 0.02)).toBeCloseTo(1 - s.depth);
    expect(d.level(s.attack + 0.02)).toBeGreaterThanOrEqual(1 - s.depth);
  });
});
