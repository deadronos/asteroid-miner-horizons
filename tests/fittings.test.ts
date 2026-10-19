import { describe, expect, it } from 'vitest';
import { HULLS } from '../src/data/hulls';
import { buildFittings, FLAME_LENGTH, fitLayout, sameFit, snapshotFit } from '../src/render/fittings';
import type { Fitted } from '../src/sim/types';

const laser = (tier: 1 | 2 | 3 = 1): Fitted => ({ type: 'laser', variant: 'focused', tier });
const cargo = (tier: 1 | 2 | 3 = 1): Fitted => ({ type: 'cargo', variant: 'standard', tier });
const engine = (tier: 1 | 2 | 3 = 1, variant: 'ion' | 'thruster' = 'ion'): Fitted => ({
  type: 'engine',
  variant,
  tier,
});
const shield: Fitted = { type: 'shield', variant: 'standard', tier: 2 };

const kinds = (slots: (Fitted | null)[]) => fitLayout(slots, 11).parts.map((p) => p.kind);

describe('fit layout', () => {
  it('adds a turret per laser, a pod per cargo module and one emitter dot for shields', () => {
    expect(kinds([laser(), laser(), cargo(), shield, shield, null])).toEqual(['turret', 'turret', 'pod', 'emitter']);
    expect(kinds([null, null])).toEqual([]);
    expect(kinds([{ type: 'armor', variant: 'standard', tier: 3 }])).toEqual([]);
  });

  it('centres a lone turret and mirrors pairs across the hull', () => {
    const one = fitLayout([laser()], 11).parts;
    expect(one[0]!.z).toBe(0);
    const three = fitLayout([laser(), laser(), laser()], 11).parts;
    expect(three[0]!.z).toBe(0);
    expect(three[1]!.z).toBeGreaterThan(0);
    expect(three[2]!.z).toBe(-three[1]!.z);
    const pods = fitLayout([cargo(), cargo()], 11).parts;
    expect(pods[0]!.z).toBe(-pods[1]!.z);
    expect(pods[0]!.z).not.toBe(0);
  });

  it('never stacks two attachments in the same spot, even on a full excavator', () => {
    const slots = [laser(), laser(), laser(), cargo(), cargo(), cargo()];
    const parts = fitLayout(slots, HULLS.excavator.size).parts;
    const spots = new Set(parts.map((p) => `${p.x},${p.z}`));
    expect(spots.size).toBe(parts.length);
  });

  it('lengthens the flame with engine tier and keeps a short idle flame with no engine', () => {
    expect(fitLayout([], 11).flameLength).toBe(FLAME_LENGTH[0]);
    const lens = ([1, 2, 3] as const).map((t) => fitLayout([engine(t)], 11).flameLength);
    expect(lens[0]).toBe(1);
    expect(lens[1]).toBeGreaterThan(lens[0]!);
    expect(lens[2]).toBeGreaterThan(lens[1]!);
    expect(fitLayout([engine(2), engine(1)], 11).flameLength).toBeGreaterThan(lens[1]!);
  });

  it('burns wider when the drive is a vector thruster', () => {
    expect(fitLayout([engine(1)], 11).flameWidth).toBe(1);
    expect(fitLayout([engine(1, 'thruster')], 11).flameWidth).toBeGreaterThan(1);
  });
});

describe('refit detection', () => {
  it('treats an identical fit as unchanged', () => {
    const slots = [laser(), null, cargo()];
    expect(sameFit(snapshotFit(slots), slots)).toBe(true);
  });

  it('notices an install, a removal, a variant swap and an in-place tier upgrade', () => {
    const slots: (Fitted | null)[] = [laser(), null];
    const snap = snapshotFit(slots);
    slots[0]!.tier = 2; // the upgrade handler bumps tier in place
    expect(sameFit(snap, slots)).toBe(false);
    expect(sameFit(snap, [laser(), cargo()])).toBe(false);
    expect(sameFit(snap, [null, null])).toBe(false);
    expect(sameFit(snap, [{ type: 'laser', variant: 'wide', tier: 1 }, null])).toBe(false);
    expect(sameFit(snap, [laser(), null, null])).toBe(false);
  });

  it('builds one object per attachment', () => {
    const g = buildFittings(fitLayout([laser(), laser(), cargo(), shield], 11));
    expect(g.children).toHaveLength(4);
  });
});
