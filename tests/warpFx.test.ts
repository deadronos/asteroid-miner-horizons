import { describe, expect, it } from 'vitest';
import { WARP_OUT, WARP_REST, WARP_TOTAL, WarpStreaks, warpFrame } from '../src/render/warpFx';

describe('warp transition timeline', () => {
  it('is at rest before it starts and once it ends', () => {
    for (const t of [-1, WARP_TOTAL, WARP_TOTAL + 5, Number.NaN]) expect(warpFrame(t)).toEqual(WARP_REST);
  });

  it('lasts between 1 and 1.5 seconds', () => {
    expect(WARP_TOTAL).toBeGreaterThanOrEqual(1);
    expect(WARP_TOTAL).toBeLessThanOrEqual(1.5);
  });

  it('dives in with growing streaks, hides the playfield, then flashes', () => {
    const early = warpFrame(0.1);
    const late = warpFrame(WARP_OUT - 0.01);
    expect(early.hidden && late.hidden).toBe(true);
    expect(late.stretch).toBeGreaterThan(early.stretch);
    expect(late.zoom).toBeLessThan(early.zoom);
    expect(early.flash).toBe(0);
    expect(late.flash).toBeGreaterThan(0.9);
  });

  it('reveals the new system as the flash fades and the camera settles back to 1', () => {
    const reveal = warpFrame(WARP_OUT);
    expect(reveal.hidden).toBe(false);
    expect(reveal.flash).toBe(1);
    expect(reveal.zoom).toBeGreaterThan(1);
    const end = warpFrame(WARP_TOTAL - 0.001);
    expect(end.flash).toBeLessThan(0.01);
    expect(end.stretch).toBeLessThan(0.01);
    expect(end.zoom).toBeCloseTo(1, 3);
  });

  it('only shudders while diving, so the shake setting has nothing to scale after the reveal', () => {
    expect(warpFrame(0.3).shudder).toBeGreaterThan(0);
    expect(warpFrame(WARP_OUT + 0.1).shudder).toBe(0);
  });

  it('reuses the frame object it is given', () => {
    const out = { ...WARP_REST };
    expect(warpFrame(0.3, out)).toBe(out);
    expect(warpFrame(WARP_TOTAL, out)).toEqual(WARP_REST);
  });
});

describe('warp streaks', () => {
  it('stay hidden at rest and lengthen with stretch', () => {
    const s = new WarpStreaks();
    s.update(0, 0, 0, 100, 100);
    expect(s.lines.visible).toBe(false);
    const span = (stretch: number) => {
      s.update(stretch, 0, 0, 100, 100);
      const a = s.lines.geometry.getAttribute('position').array;
      return Math.hypot(a[3]! - a[0]!, a[5]! - a[2]!);
    };
    const short = span(0.2);
    expect(s.lines.visible).toBe(true);
    expect(span(1)).toBeGreaterThan(short);
  });
});
