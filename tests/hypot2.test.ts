import { describe, expect, it } from 'vitest';
import { hypot2 } from '../src/core/vec';

describe('hypot2', () => {
  it('matches Math.hypot bit for bit', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
    for (let i = 0; i < 400000; i++) {
      const scale = 10 ** Math.floor(rnd() * 6);
      const x = rnd() * scale;
      const z = rnd() * scale;
      expect(hypot2(x, z)).toBe(Math.hypot(x, z));
    }
    for (const [x, z] of [
      [0, 0],
      [3, 4],
      [-3, 0],
      [0, -2],
      [Infinity, NaN],
      [NaN, 1],
      [1e-300, 1e-300],
      [1e300, 1e300],
    ] as const)
      expect(hypot2(x, z)).toBe(Math.hypot(x, z));
  });
});
