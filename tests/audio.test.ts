import { describe, expect, it } from 'vitest';
import { MAX_VOICES, PRESETS, RateLimiter, type SoundId, Streak, spatial, voiceFor } from '../src/audio/sfx';
import { ZZFX_RATE, zzfxSamples } from '../src/audio/zzfx';

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
  it('is full volume on screen and silent well off screen', () => {
    expect(spatial({ x: 100, z: 50 }, view)[0]).toBe(1);
    expect(spatial({ x: 800 * 1.25, z: 0 }, view)[0]).toBeCloseTo(0.5);
    expect(spatial({ x: 5000, z: 0 }, view)[0]).toBe(0);
  });

  it('pans by horizontal screen position', () => {
    expect(spatial({ x: -800, z: 0 }, view)[1]).toBeLessThan(0);
    expect(spatial({ x: 800, z: 0 }, view)[1]).toBeGreaterThan(0);
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
