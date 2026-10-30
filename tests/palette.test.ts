import { describe, expect, it } from 'vitest';
import { COLOUR_VISION_IDS, PALETTES, cssColour, type ColourVision, type Palette } from '../src/data/palette';
import { RESOURCES } from '../src/data/resources';

type M3 = readonly [readonly number[], readonly number[], readonly number[]];
/** Machado et al. 2009 simulation matrices (severity 1) applied to linear RGB. */
const SIM: Record<string, M3> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
/** Which deficiencies each palette must survive. */
const VISION_OF: Record<ColourVision, string[]> = {
  default: ['normal'],
  deutan: ['deutan', 'protan'],
  tritan: ['tritan'],
};

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp = (v: number): number => Math.min(1, Math.max(0, v));
const linear = (n: number): number[] => [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));

const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
/** CIE L*a*b* (D65) of a colour as seen through simulation matrix `m`. */
function lab(n: number, m: M3): [number, number, number] {
  const rgb = linear(n);
  const [r, g, b] = m.map((row) => clamp(row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!)) as [
    number,
    number,
    number,
  ];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * labF(y) - 16, 500 * (labF(x) - labF(y)), 200 * (labF(y) - labF(z))];
}
const deltaE = (a: number, b: number, m: M3): number => {
  const p = lab(a, m);
  const q = lab(b, m);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const luminance = (c: number): number => {
  const [r, g, b] = linear(c) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio against the scene's clear colour. */
const contrast = (n: number): number => (luminance(n) + 0.05) / (luminance(0x03060d) + 0.05);

/** Colour sets that appear together on screen and must not merge. */
function groups(p: Palette): Record<string, number[]> {
  return {
    resources: RESOURCES.map((r) => p.resource[r]),
    rocks: [p.rock.ore, p.rock.ice, p.rock.crystal],
    hullState: [p.ok, p.warn, p.bad],
    fleetRoles: [p.flagship, p.fleet],
  };
}

const MIN_DELTA_E = 20;

describe('palette table', () => {
  it('has an entry for every mode with every resource', () => {
    for (const id of COLOUR_VISION_IDS) {
      expect(new Set(Object.keys(PALETTES[id].resource))).toEqual(new Set(RESOURCES));
    }
  });

  for (const id of COLOUR_VISION_IDS) {
    for (const vision of VISION_OF[id]) {
      it(`${id}: entries stay ${MIN_DELTA_E}+ ΔE apart as seen with ${vision} vision`, () => {
        const tooClose: string[] = [];
        for (const [name, colours] of Object.entries(groups(PALETTES[id]))) {
          for (let i = 0; i < colours.length; i++)
            for (let j = i + 1; j < colours.length; j++) {
              const d = deltaE(colours[i]!, colours[j]!, SIM[vision]!);
              if (d < MIN_DELTA_E)
                tooClose.push(`${name}: ${cssColour(colours[i]!)} vs ${cssColour(colours[j]!)} ΔE ${d.toFixed(1)}`);
            }
        }
        expect(tooClose).toEqual([]);
      });
    }

    it(`${id}: UI colours read against the dark scene (3:1)`, () => {
      const p = PALETTES[id];
      const ui = [...RESOURCES.map((r) => p.resource[r]), p.ok, p.warn, p.bad, p.flagship, p.fleet, p.hazard];
      expect(ui.filter((c) => contrast(c) < 3).map(cssColour)).toEqual([]);
    });
  }

  it('formats CSS colours', () => {
    expect(cssColour(0x00ff0a)).toBe('#00ff0a');
  });
});
