import { describe, expect, it } from 'vitest';
import {
  PLANET_TEX_H,
  PLANET_TEX_W,
  PlanetSurface,
  atmosphereOf,
  planetKind,
  planetPixels,
  planetSeed,
} from '../src/render/planetLook';
import { generateSystem } from '../src/sim/generate';
import type { Planet } from '../src/sim/types';

const planet = (over: Partial<Planet>): Planet => ({
  name: 'Test I',
  orbitR: 470,
  radius: 20,
  angle: 0,
  speed: 0.01,
  color: 0x4d7dd1,
  ringed: false,
  moons: [],
  ...over,
});

/** Mean luminance and the average brightness spread along rows vs down columns. */
function stats(px: Uint8Array, w = PLANET_TEX_W, h = PLANET_TEX_H) {
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
  };
  let sum = 0;
  let rowStep = 0;
  let colStep = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      sum += lum(x, y);
      rowStep += Math.abs(lum(x + 1, y) - lum(x, y));
      colStep += Math.abs(lum(x, y + 1) - lum(x, y));
    }
  }
  const n = (w - 1) * (h - 1);
  return { mean: sum / n, rowStep: rowStep / n, colStep: colStep / n };
}

describe('planet kind', () => {
  it('makes big or big-and-ringed planets gas giants', () => {
    expect(planetKind(planet({ radius: 34 }))).toBe('gas');
    expect(planetKind(planet({ radius: 25, ringed: true }))).toBe('gas');
    expect(planetKind(planet({ radius: 25 }))).toBe('rocky');
  });

  it('freezes small planets beyond the frost line', () => {
    expect(planetKind(planet({ orbitR: 300 }))).toBe('rocky');
    expect(planetKind(planet({ orbitR: 2300 }))).toBe('ice');
  });

  it('shows up as every kind across ordinary generated systems', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 6; n++) for (const p of generateSystem(42, n).planets) seen.add(planetKind(p));
    expect(seen).toEqual(new Set(['rocky', 'gas', 'ice']));
  });
});

describe('planet look seed', () => {
  it('replays from the run seed and differs between planets', () => {
    const a = generateSystem(1234, 3);
    const b = generateSystem(1234, 3);
    const seeds = a.planets.map((_, i) => planetSeed(a, i));
    expect(b.planets.map((_, i) => planetSeed(b, i))).toEqual(seeds);
    expect(new Set(seeds).size).toBe(seeds.length);
    const other = generateSystem(99, 3);
    expect(planetSeed(other, 0)).not.toBe(seeds[0]);
  });
});

describe('planet surface pixels', () => {
  it('is deterministic for a seed and changes with it', () => {
    const a = planetPixels('rocky', 0xc96b3a, 7);
    expect(planetPixels('rocky', 0xc96b3a, 7)).toEqual(a);
    expect(planetPixels('rocky', 0xc96b3a, 8)).not.toEqual(a);
    expect(a.length).toBe(PLANET_TEX_W * PLANET_TEX_H * 4);
  });

  it('wraps around the seam without a visible step', () => {
    for (const kind of ['rocky', 'gas', 'ice'] as const) {
      const px = planetPixels(kind, 0x7fc46b, 3);
      const s = stats(px);
      let seam = 0;
      for (let y = 0; y < PLANET_TEX_H; y++) {
        for (let c = 0; c < 3; c++) {
          const first = px[y * PLANET_TEX_W * 4 + c]!;
          const last = px[(y * PLANET_TEX_W + PLANET_TEX_W - 1) * 4 + c]!;
          seam += Math.abs(first - last) / 3;
        }
      }
      // No worse across the seam than between any two neighbouring columns.
      expect(seam / PLANET_TEX_H).toBeLessThanOrEqual(s.rowStep * 2 + 1);
    }
  });

  it('gives each kind its own pattern from the same colour', () => {
    const color = 0x5fb3a8;
    const rocky = stats(planetPixels('rocky', color, 11));
    const gas = stats(planetPixels('gas', color, 11));
    const ice = stats(planetPixels('ice', color, 11));
    // Gas giants are banded: brightness changes far more pole-to-pole than along a
    // band, well beyond what the equirectangular stretch gives rocky terrain.
    expect(gas.colStep / gas.rowStep).toBeGreaterThan((rocky.colStep / rocky.rowStep) * 2);
    // Ice is the palest; rocky terrain the darkest.
    expect(ice.mean).toBeGreaterThan(gas.mean);
    expect(ice.mean).toBeGreaterThan(rocky.mean + 30);
  });
});

describe('atmosphere rim', () => {
  it('tints gas giants with their own colour and keeps fixed tints for the rest', () => {
    expect(atmosphereOf('gas', 0xff0000).color.getHex()).not.toBe(atmosphereOf('gas', 0x0000ff).color.getHex());
    expect(atmosphereOf('ice', 0xff0000).color.getHex()).toBe(atmosphereOf('ice', 0x0000ff).color.getHex());
  });
});

describe('planet surface painting', () => {
  it('paints in slices to the same pixels as painting in one go', () => {
    const s = new PlanetSurface('gas', 0xd9c27a, 21);
    let total = 0;
    while (!s.done) total += s.paint(7);
    expect(total).toBe(PLANET_TEX_H);
    expect(s.paint(7)).toBe(0);
    expect(s.pixels).toEqual(planetPixels('gas', 0xd9c27a, 21));
  });

  it('shows the flat planet colour before painting starts', () => {
    const s = new PlanetSurface('rocky', 0x4d7dd1, 5);
    expect([...s.pixels.subarray(0, 4)]).toEqual([0x4d, 0x7d, 0xd1, 255]);
    expect(s.done).toBe(false);
  });
});
