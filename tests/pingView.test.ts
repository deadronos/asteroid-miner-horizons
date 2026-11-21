import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PING_LIFE, PING_MIN_PX, PingRing, pingInnerRatio, pingPulse, pingSegments } from '../src/render/pingView';

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

  it('clamps ring stroke width to at least PING_MIN_PX CSS pixels at any zoom', () => {
    // At radius 100 and wpp 4, 1.5% is 1.5 world units (< 8), so stroke widens to PING_MIN_PX * 4 = 8.
    const ratio = pingInnerRatio(100, 4);
    expect((1 - ratio) * 100).toBeCloseTo(PING_MIN_PX * 4, 4);

    // PingRing updates its inner ring vertices in place to match wpp.
    const ring = new PingRing();
    ring.trigger({ x: 0, z: 0 }, 650);
    ring.update(0.1, false, 4);
    const pos = ring.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const innerR = Math.hypot(pos.getX(0), pos.getZ(0));
    const strokePx = ((1 - innerR) * ring.mesh.scale.x) / 4;
    expect(strokePx).toBeGreaterThanOrEqual(PING_MIN_PX - 1e-3);
  });
});
