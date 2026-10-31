import { describe, expect, it } from 'vitest';
import { PING_LIFE, pingPulse, pingSegments } from '../src/render/pingView';

describe('ping pulse', () => {
  it('starts small, expands toward the range and fades over a second', () => {
    const early = pingPulse(0.1, 650, false);
    const late = pingPulse(0.8, 650, false);
    expect(early.visible).toBe(true);
    expect(late.visible).toBe(true);
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(pingPulse(PING_LIFE, 650, false).visible).toBe(false);
  });

  it('holds a fixed ring and fades it under reduced motion', () => {
    const a = pingPulse(0.1, 650, true);
    const b = pingPulse(0.7, 650, true);
    expect(a.radius).toBeCloseTo(650 * 0.85);
    expect(b.radius).toBe(a.radius);
    expect(b.opacity).toBeLessThan(a.opacity);
  });

  it('reuses the shape object it is given', () => {
    const out = { radius: 0, opacity: 0, visible: false };
    expect(pingPulse(0.3, 650, false, out)).toBe(out);
  });

  it('uses fewer ring segments on Low quality', () => {
    expect(pingSegments(true)).toBeLessThan(pingSegments(false));
  });
});
