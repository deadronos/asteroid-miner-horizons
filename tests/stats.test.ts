import { describe, expect, it } from 'vitest';
import {
  ARMOR_DMG_MUL,
  COMPONENTS,
  COMPONENT_IDS,
  LASER_DPS,
  type ComponentId,
  type Tier,
  type VariantId,
} from '../src/data/components';
import { newGame } from '../src/sim/create';
import { emptyStats, shipStats, writeShipStats, type ShipStats } from '../src/sim/ships';

const TIERS: Tier[] = [1, 2, 3];

/** The flagship (4 slots) with exactly the given components fitted. */
function fit(...components: { type: ComponentId; variant: VariantId; tier: Tier }[]) {
  const state = newGame(7);
  const ship = state.run.ships[0]!;
  ship.slots = components;
  return { state, ship };
}

const dps = (f: ReturnType<typeof fit>): number => shipStats(f.ship, f.state.profile).dps;

describe('shipStats', () => {
  it('matches the committed snapshot for every component, variant and tier', () => {
    const table: Record<string, ShipStats> = {};
    for (const id of COMPONENT_IDS) {
      for (const variant of COMPONENTS[id].variants) {
        for (const tier of TIERS) {
          const { state, ship } = fit({ type: id, variant: variant.id, tier });
          table[`${id} ${variant.id} T${tier}`] = shipStats(ship, state.profile);
        }
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('stacks duplicate components additively', () => {
    const base = dps(fit());
    const one = dps(fit({ type: 'laser', variant: 'focused', tier: 1 }));
    const two = dps(
      fit({ type: 'laser', variant: 'focused', tier: 1 }, { type: 'laser', variant: 'focused', tier: 1 }),
    );
    expect(one - base).toBeCloseTo(LASER_DPS[0]);
    expect(two - base).toBeCloseTo(2 * LASER_DPS[0]);
  });

  it('multiplies armor damage reduction across slots', () => {
    const { state, ship } = fit(
      { type: 'armor', variant: 'standard', tier: 1 },
      { type: 'armor', variant: 'standard', tier: 1 },
    );
    expect(shipStats(ship, state.profile).dmgMul).toBeCloseTo(ARMOR_DMG_MUL[0] ** 2);
  });

  it('declares at least one effect for every component variant', () => {
    for (const id of COMPONENT_IDS) {
      for (const v of COMPONENTS[id].variants) expect(v.effects.length).toBeGreaterThan(0);
    }
  });

  it('writeShipStats fills a provided object identically to shipStats', () => {
    const state = newGame(7);
    const ship = state.run.ships[0]!;
    expect(writeShipStats(emptyStats(), ship, state.profile)).toEqual(shipStats(ship, state.profile));
  });
});
