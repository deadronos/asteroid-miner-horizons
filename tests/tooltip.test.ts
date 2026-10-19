import { describe, expect, it } from 'vitest';
import type { RawResource } from '../src/data/resources';
import type { RockTrait } from '../src/data/traits';
import { TUNING } from '../src/data/tuning';
import type { Rock } from '../src/sim/types';
import { rockTooltip } from '../src/ui/rockTooltip';

const rock = (kind: RawResource, units: number, trait?: RockTrait): Rock => ({
  id: 1,
  kind,
  size: 0,
  pos: { x: 0, z: 0 },
  vel: { x: 0, z: 0 },
  radius: 10,
  hp: 100,
  maxHp: 100,
  units,
  belt: 0,
  trait,
});

describe('rockTooltip', () => {
  it('reads size, kind, units and hp for a plain rock', () => {
    expect(rockTooltip(rock('ore', 12))).toBe('Large ore asteroid · 12 units · 100%');
  });

  it('inserts the trait between the kind and the units', () => {
    expect(rockTooltip(rock('ice', 120, 'volatile'))).toBe(
      'Large ice asteroid · Volatile (explodes when cut) · 120 units · 100%',
    );
  });

  it('names the other traits the same way', () => {
    expect(rockTooltip(rock('crystal', 5, 'magnetic'))).toContain('Magnetic (drifts toward ships)');
    expect(rockTooltip(rock('ore', 5, 'dense'))).toContain('Dense (needs a T2 laser)');
  });

  it('names the deploy key on a large rock, and shows an outpost in place of hp', () => {
    expect(rockTooltip(rock('ore', 12), undefined, 'O')).toBe(
      'Large ore asteroid · 12 units · 100% · O: deploy outpost',
    );
    expect(rockTooltip({ ...rock('ore', 12), size: 1 }, undefined, 'O')).not.toContain('outpost');
    const outpost = {
      rockId: 1,
      kind: 'ore' as const,
      pos: { x: 0, z: 0 },
      stored: { ore: 12.7, ice: 0, crystal: 0, alloy: 0, fuel: 0 },
      reserve: 300.4,
    };
    expect(rockTooltip(rock('ore', 12), outpost, 'O')).toBe(
      `Large ore asteroid · 12 units · Outpost: 12/${TUNING.outpostCapacity} stored, 300 in reserve`,
    );
  });
});
