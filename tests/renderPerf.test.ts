import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { inView, type ViewRect } from '../src/render/cull';
import { Particles } from '../src/render/particles';

describe('view culling', () => {
  const view: ViewRect = { x: 100, z: -50, halfW: 200, halfH: 100 };

  it('keeps circles that overlap the view, including ones straddling an edge', () => {
    expect(inView(view, 100, -50, 1)).toBe(true);
    // Center just past the right edge, but the radius reaches back in.
    expect(inView(view, 305, -50, 10)).toBe(true);
    expect(inView(view, 100, 55, 10)).toBe(true);
  });

  it('drops circles entirely outside the view', () => {
    expect(inView(view, 320, -50, 10)).toBe(false);
    expect(inView(view, 100, -170, 10)).toBe(false);
    expect(inView(view, -120, -50, 10)).toBe(false);
  });
});

describe('particles', () => {
  const white = new THREE.Color(1, 1, 1);

  it('tracks live particles and draws only those', () => {
    const p = new Particles();
    p.emit(0, 0, white, 50, 100, 1);
    expect(p.count).toBe(50);
    p.update(1 / 60);
    expect(p.count).toBe(50);
    expect(p.points.geometry.drawRange.count).toBe(50);
  });

  it('drains to zero and stops uploading once every particle has died', () => {
    const p = new Particles();
    p.emit(0, 0, white, 20, 100, 0.2);
    p.update(0.5);
    expect(p.count).toBe(0);
    expect(p.points.geometry.drawRange.count).toBe(0);
    const pos = p.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = pos.version;
    p.update(1 / 60);
    expect(pos.version).toBe(version);
  });

  it('keeps survivors packed and moving after others expire', () => {
    const p = new Particles();
    p.emit(0, 0, white, 10, 0, 0.1); // short-lived, stationary
    p.emit(500, 0, white, 10, 0, 10); // long-lived, stationary
    p.update(0.2);
    expect(p.count).toBe(10);
    const pos = p.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 10; i++) expect(pos.getX(i)).toBe(500);
    const col = p.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < 10; i++) expect(col.getX(i)).toBeGreaterThan(0);
  });

  it('overwrites old slots instead of growing past capacity', () => {
    const p = new Particles();
    for (let k = 0; k < 7; k++) p.emit(0, 0, white, 1000, 10, 5);
    expect(p.count).toBe(6000);
    p.update(1 / 60);
    expect(p.count).toBe(6000);
  });
});
