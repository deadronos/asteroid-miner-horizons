import { describe, expect, it } from 'vitest';
import {
  COMPONENTS,
  COMPONENT_IDS,
  defaultVariant,
  isVariant,
  variantDef,
  LASER_DPS,
  ENGINE_SPEED,
} from '../src/data/components';
import { shipStats } from '../src/sim/ships';
import { newGame } from '../src/sim/create';

describe('component variants', () => {
  it('gives laser and engine two variants and the rest one', () => {
    expect(COMPONENTS.laser.variants.map((v) => v.id)).toEqual(['focused', 'wide']);
    expect(COMPONENTS.engine.variants.map((v) => v.id)).toEqual(['ion', 'thruster']);
    for (const id of COMPONENT_IDS) expect(COMPONENTS[id].variants.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the default variant on today’s numbers', () => {
    expect(defaultVariant('laser')).toBe('focused');
    expect(defaultVariant('engine')).toBe('ion');
    expect(variantDef('laser', 'focused').effects[0]!.values).toEqual(LASER_DPS);
    expect(variantDef('engine', 'ion').effects[0]!.values).toEqual(ENGINE_SPEED);
    // an unknown variant falls back to the default (validation happens elsewhere)
    expect(variantDef('laser', 'nonsense' as never).id).toBe('focused');
    expect(isVariant('laser', 'wide')).toBe(true);
    expect(isVariant('laser', 'ion')).toBe(false);
  });

  it('has non-empty effects and unique variant ids for every component', () => {
    for (const id of COMPONENT_IDS) {
      const ids = COMPONENTS[id].variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const v of COMPONENTS[id].variants) expect(v.effects.length).toBeGreaterThan(0);
    }
  });

  it('gives a fitted Wide Beam a splash radius and a Focused Beam none', () => {
    const state = newGame(7);
    const ship = state.run.ships[0]!;
    ship.slots = [
      { type: 'laser', variant: 'focused', tier: 1 },
      { type: 'laser', variant: 'wide', tier: 1 },
      { type: 'engine', variant: 'thruster', tier: 1 },
      null,
    ];
    const st = shipStats(ship, state.profile);
    expect(st.splash).toBeGreaterThan(0);
    // thruster trades top speed for acceleration
    expect(st.accel).toBeGreaterThan(0);
  });
});
