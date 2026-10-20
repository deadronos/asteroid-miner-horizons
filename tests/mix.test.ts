import { describe, expect, it } from 'vitest';
import { LIMITER, REVERB_DECAY, REVERB_SECONDS, REVERB_SEND, reverbImpulse } from '../src/audio/mix';

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
