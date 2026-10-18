import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ROCK_POOLS, rockShapeIndex, rockStyleOf } from '../src/render/rocks';
import { rockGeometry } from '../src/render/util';

// `util.ts` builds `glowTexture` at import time, which needs a canvas. Vitest
// runs in the node env, so stub just enough of `document` before the imports
// above are evaluated (same trick as `session.test.ts`, without a new dep).
vi.hoisted(() => {
  const ctx = { fillStyle: '', createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {} };
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    configurable: true,
  });
});

const attr = (g: THREE.BufferGeometry): THREE.BufferAttribute => g.getAttribute('position') as THREE.BufferAttribute;
const extents = (g: THREE.BufferGeometry): { max: number; min: number } => {
  const a = attr(g);
  let max = 0;
  let min = Infinity;
  for (let i = 0; i < a.count; i++) {
    const d = Math.hypot(a.getX(i), a.getY(i), a.getZ(i));
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  return { max, min };
};

describe('rock shapes are kind-correlated', () => {
  it('gives every kind its own two-pool block', () => {
    for (const id of [0, 1, 2, 7, 8, 13]) {
      expect([0, 1]).toContain(rockShapeIndex('ore', id));
      expect([2, 3]).toContain(rockShapeIndex('ice', id));
      expect([4, 5]).toContain(rockShapeIndex('crystal', id));
    }
    expect(rockShapeIndex('ore', 0)).not.toBe(rockShapeIndex('ore', 1));
    expect(ROCK_POOLS).toBe(6);
  });

  it('assigns a distinct style per kind', () => {
    expect(rockStyleOf('ore')).toBe('rock');
    expect(rockStyleOf('ice')).toBe('gem');
    expect(rockStyleOf('crystal')).toBe('shard');
  });
});

describe('rockGeometry styles', () => {
  it('gem is a coarser mesh than rock', () => {
    expect(attr(rockGeometry(1000, 'gem')).count).toBeLessThan(attr(rockGeometry(1000, 'rock')).count);
  });

  it('shard is pointier than gem (more low-biased vertices)', () => {
    expect(extents(rockGeometry(1000, 'shard')).min).toBeLessThan(extents(rockGeometry(1000, 'gem')).min);
  });

  it('keeps every style inside the cull bound (1.25)', () => {
    for (const style of ['rock', 'gem', 'shard'] as const)
      for (let i = 0; i < 6; i++) expect(extents(rockGeometry(1000 + i * 77, style)).max).toBeLessThanOrEqual(1.25);
  });

  it('defaults to the rock style (debris is unchanged)', () => {
    expect(attr(rockGeometry(4242)).count).toBe(attr(rockGeometry(4242, 'rock')).count);
  });
});
