import { describe, expect, it } from 'vitest';
import { MODIFIER_IDS, MODIFIERS, type ModifierId } from '../src/data/modifiers';
import { newGame } from '../src/sim/create';
import { generateSystem } from '../src/sim/generate';
import {
  applyBeltModifiers,
  applySystemStats,
  describeDef,
  describeModifier,
  describeModifiers,
  rollModifiers,
  systemEffects,
} from '../src/sim/modifiers';
import { flagship, shipStats } from '../src/sim/ships';
import type { Belt } from '../src/sim/types';

// [seed, n, name, class, richness, station angle, planets, belt counts] captured at efc16f2.
const SNAPSHOT: [number, number, string, string, number, number, number, number[]][] = [
  [1, 1, 'Qutha', 'G', 1, 2.13369893865669, 3, [160, 140]],
  [1, 2, 'Mitha', 'G', 1.2452006654581056, 1.2588449731803038, 3, [199, 174]],
  [1, 3, 'Synul', 'G', 1.1177642497001217, 0.8583932946348027, 3, [179, 156, 90]],
  [1, 4, 'Dralor', 'G', 1.218241674033925, 0.6214427227038132, 4, [195, 171, 90]],
  [1, 5, 'Katar', 'G', 1.1509522020583973, 4.432055281692334, 3, [184, 161, 90]],
  [42, 1, 'Thave', 'G', 1, 3.201979038730834, 3, [160, 140]],
  [42, 2, 'Synpha', 'G', 1.0651993627194316, 2.650210482784303, 3, [170, 149]],
  [42, 3, 'Drasyn', 'G', 1.0941019642865286, 3.7484416405430774, 4, [175, 153, 90]],
  [42, 4, 'Lorqu', 'G', 1.127992323273793, 2.2504534065203465, 4, [180, 158, 90]],
  [42, 5, 'Osno', 'M', 1.0662008121376858, 0.6287513443943855, 3, [171, 149, 90]],
  [1000, 1, 'Ixos', 'G', 1, 1.9512963131066174, 5, [160, 140]],
  [1000, 2, 'Lorzen', 'G', 0.8520086991135031, 5.015751531715479, 3, [136, 119]],
  [1000, 3, 'Draix', 'G', 1.0733190007973463, 4.910850486325875, 5, [172, 150, 90]],
  [1000, 4, 'Lorno', 'G', 1.1511435370426626, 6.196593146759961, 3, [184, 161, 90]],
  [1000, 5, 'Thatar', 'M', 1.2135819202754647, 0.8059552389278726, 5, [194, 170, 90]],
];

describe('modifier data', () => {
  it('has four well-formed entries', () => {
    expect(MODIFIER_IDS).toHaveLength(4);
    for (const id of MODIFIER_IDS) {
      const m = MODIFIERS[id];
      expect(m.name.length).toBeGreaterThan(0);
      const xs = [m.beltCount, m.magnet, m.regrowInterval, ...Object.values(m.mix ?? {})].filter(
        (x) => x !== undefined,
      );
      for (const x of xs) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThan(0);
      }
    }
  });
});

describe('rollModifiers', () => {
  it('rolls none in systems 1-2', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(rollModifiers(seed, 1)).toEqual([]);
      expect(rollModifiers(seed, 2)).toEqual([]);
    }
  });

  it('rolls one or two distinct known ids from system 3', () => {
    const lengths = new Set<number>();
    const seen = new Set<ModifierId>();
    for (let seed = 0; seed < 200; seed++) {
      for (let n = 3; n <= 12; n++) {
        const mods = rollModifiers(seed, n);
        expect([1, 2]).toContain(mods.length);
        expect(new Set(mods).size).toBe(mods.length);
        for (const id of mods) {
          expect(MODIFIER_IDS).toContain(id);
          seen.add(id);
        }
        lengths.add(mods.length);
        expect(rollModifiers(seed, n)).toEqual(mods);
      }
    }
    expect(lengths).toEqual(new Set([1, 2]));
    expect(seen.size).toBe(4);
  });
});

describe('generateSystem', () => {
  it.each(SNAPSHOT)(
    'seed %i system %i matches the pre-modifier snapshot',
    (seed, n, name, cls, rich, angle, planets, belts) => {
      const s = generateSystem(seed, n);
      expect(s.name).toBe(name);
      expect(s.starClass).toBe(cls);
      expect(s.planets).toHaveLength(planets);
      expect(s.richness).toBe(rich);
      expect(s.station.angle).toBe(angle);
      const f = systemEffects(s.modifiers).beltCount;
      expect(n <= 2 ? s.modifiers : []).toEqual([]);
      expect(s.belts.map((b) => b.initialCount)).toEqual(belts.map((c) => Math.round(c * f)));
    },
  );

  it('the snapshot exercises belt-scaling modifiers from system 3', () => {
    const later = SNAPSHOT.filter(([, n]) => n >= 3).map(([seed, n]) => generateSystem(seed, n));
    expect(later.some((s) => s.modifiers.length > 0)).toBe(true);
    expect(later.some((s) => systemEffects(s.modifiers).beltCount !== 1)).toBe(true);
  });

  it('newGame starts in system 1 without modifiers', () => {
    expect(newGame(1).run.system.modifiers).toEqual([]);
  });
});

describe('systemEffects', () => {
  it('is all ones for no modifiers', () => {
    expect(systemEffects([])).toEqual({
      beltCount: 1,
      mix: { ore: 1, ice: 1, crystal: 1 },
      magnet: 1,
      regrowInterval: 1,
    });
  });

  it('multiplies across modifiers', () => {
    expect(systemEffects(['dense', 'nebula'])).toMatchObject({ beltCount: 1.4, magnet: 0.7, regrowInterval: 0.5 });
    expect(systemEffects(['metalRich', 'icePoor']).mix).toEqual({ ore: 1.6, ice: 0.55, crystal: 1 });
  });
});

const belts = (): Belt[] => [
  { inner: 1, outer: 2, mix: { ore: 0.5, ice: 0.5, crystal: 0 }, initialCount: 101 },
  { inner: 3, outer: 4, mix: { ore: 0.2, ice: 0.6, crystal: 0.2 }, initialCount: 50 },
];

describe('applyBeltModifiers', () => {
  it('scales counts and mix weights', () => {
    const b = belts();
    applyBeltModifiers(b, ['dense', 'metalRich']);
    expect(b.map((x) => x.initialCount)).toEqual([141, 70]);
    expect(b[0]!.mix.ore).toBeCloseTo(0.8);
    expect(b[0]!.mix.ice).toBeCloseTo(0.5);
    expect(b[1]!.mix.ore).toBeCloseTo(0.32);
  });

  it('leaves belts alone for no modifiers', () => {
    const b = belts();
    applyBeltModifiers(b, []);
    expect(b).toEqual(belts());
  });
});

describe('descriptions', () => {
  it('builds effect text from the numbers', () => {
    expect(describeModifier('dense')).toBe('+40% asteroids');
    expect(describeModifier('metalRich')).toBe('+60% ore rocks');
    expect(describeModifier('icePoor')).toBe('−45% ice rocks');
    expect(describeModifier('nebula')).toBe('−30% pickup radius, belts regrow 2× faster');
    expect(describeModifiers(['dense', 'nebula'])).toBe(
      'Dense belt (+40% asteroids) · Nebula (−30% pickup radius, belts regrow 2× faster)',
    );
    expect(describeModifiers([])).toBe('');
  });

  it('renders a multiplier of exactly 1 as +0%', () => {
    expect(describeDef({ id: 'dense', name: 'x', beltCount: 1 })).toBe('+0% asteroids');
  });

  it('follows a changed number', () => {
    expect(describeDef({ ...MODIFIERS.nebula, regrowInterval: 0.4 })).toBe(
      '−30% pickup radius, belts regrow 2.5× faster',
    );
  });
});

describe('applySystemStats', () => {
  it('shrinks only the pickup radius in a nebula', () => {
    const g = newGame(1);
    const base = shipStats(flagship(g.run)!, g.profile);
    const nebula = { ...g.run.system, modifiers: ['nebula' as const] };
    expect(applySystemStats({ ...base }, nebula)).toEqual({ ...base, magnet: base.magnet * 0.7 });
    expect(applySystemStats({ ...base }, g.run.system)).toEqual(base);
  });
});
