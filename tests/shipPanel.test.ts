import { describe, expect, it } from 'vitest';
import { COMPONENTS, COMPONENT_IDS, variantDef, type ComponentId, type VariantId } from '../src/data/components';
import { formatCost } from '../src/data/resources';
import { newGame } from '../src/sim/create';
import { halve, investedCost } from '../src/sim/economy';
import { makeShip, flagship } from '../src/sim/ships';
import { autoToggleCommand, fleetControls } from '../src/ui/panels/FleetPanel';
import { installOptions, parseInstallValue, removeRefundTitle, shipPanelKey } from '../src/ui/panels/ShipPanel';

// The refit panel's empty slot offers every (component, variant) pair; these
// pure seams build and parse those options and the fitted row's refund title.

describe('installOptions', () => {
  it('offers one option per (component, variant)', () => {
    const opts = installOptions();
    const expected = COMPONENT_IDS.reduce((n, cid) => n + COMPONENTS[cid].variants.length, 0);
    expect(opts.length).toBe(expected);
    expect(opts.filter((o) => o.comp === 'laser').map((o) => o.variant)).toEqual(['focused', 'wide']);
    expect(opts.filter((o) => o.comp === 'engine').map((o) => o.variant)).toEqual(['ion', 'thruster']);
  });

  it('codes every value as `component:variant`', () => {
    for (const o of installOptions()) expect(o.value).toBe(`${o.comp}:${o.variant}`);
  });

  it('labels a multi-variant family with the variant and a solo one with the family name, plus the price', () => {
    const opts = installOptions();
    const label = (comp: ComponentId, variant: VariantId): string =>
      opts.find((o) => o.value === `${comp}:${variant}`)!.label;
    expect(label('laser', 'wide')).toBe(
      `Mining Laser — Wide Beam — ${formatCost(variantDef('laser', 'wide').cost(1))}`,
    );
    expect(label('laser', 'focused')).toBe(
      `Mining Laser — Focused Beam — ${formatCost(variantDef('laser', 'focused').cost(1))}`,
    );
    expect(label('engine', 'thruster')).toBe(
      `Ion Engine — Vector Thruster — ${formatCost(variantDef('engine', 'thruster').cost(1))}`,
    );
    expect(label('shield', 'standard')).toBe(
      `Deflector Shield — ${formatCost(variantDef('shield', 'standard').cost(1))}`,
    );
    // The two lasers show their different tier-1 prices.
    expect(label('laser', 'wide')).not.toBe(label('laser', 'focused'));
  });

  it('prices each option at that variant’s tier-1 cost', () => {
    const opts = installOptions();
    for (const o of opts) expect(o.cost).toEqual(variantDef(o.comp, o.variant).cost(1));
    // The two lasers are priced differently, so the choice is meaningful.
    expect(opts.find((o) => o.value === 'laser:wide')!.cost).not.toEqual(
      opts.find((o) => o.value === 'laser:focused')!.cost,
    );
  });
});

describe('parseInstallValue', () => {
  it('round-trips every option value', () => {
    for (const o of installOptions()) expect(parseInstallValue(o.value)).toEqual({ comp: o.comp, variant: o.variant });
  });

  it('rejects a missing, unknown or malformed value', () => {
    expect(parseInstallValue('')).toBeNull();
    expect(parseInstallValue('laser')).toBeNull();
    expect(parseInstallValue('nope:focused')).toBeNull();
    expect(parseInstallValue('laser:nonsense')).toBeNull();
  });
});

describe('shipPanelKey', () => {
  it('is stable for identical ships and changes with the selected fit', () => {
    const a = newGame(7).run.ships[0]!;
    const b = newGame(7).run.ships[0]!;
    a.slots = [{ type: 'laser', variant: 'focused', tier: 1 }, null];
    b.slots = [{ type: 'laser', variant: 'focused', tier: 1 }, null];
    expect(shipPanelKey(a)).toBe(shipPanelKey(b));
    // Swapping a fitted part's variant must rebuild the row.
    b.slots = [{ type: 'laser', variant: 'wide', tier: 1 }, null];
    expect(shipPanelKey(a)).not.toBe(shipPanelKey(b));
  });

  it('is "none" without a ship', () => {
    expect(shipPanelKey(undefined)).toBe('none');
  });
});

describe('removeRefundTitle', () => {
  it('quotes half the fitted variant’s invested cost', () => {
    const focused = { type: 'laser', variant: 'focused', tier: 2 } as const;
    const wide = { type: 'laser', variant: 'wide', tier: 2 } as const;
    expect(removeRefundTitle(focused)).toBe(
      `Remove (refund ${formatCost(halve(investedCost('laser', 'focused', 2)))})`,
    );
    // A different variant is a different refund, so switching rebuilds the row.
    expect(removeRefundTitle(wide)).not.toBe(removeRefundTitle(focused));
  });
});

describe('fleet row controls', () => {
  const s = newGame(1);
  const at = { x: 0, z: 0 };
  const ship = (hull: 'drone' | 'hauler' | 'constructionDrone') => makeShip(s.run, s.profile, hull, 'X', at);

  it('BUILD toggle shows only on construction drone rows and sends shipAuto build', () => {
    expect(fleetControls(flagship(s.run))).toEqual([]);
    expect(fleetControls(ship('drone'))).toEqual(['mode', 'repair', 'upgrade']);
    expect(fleetControls(ship('hauler'))).toEqual(['repair', 'upgrade']);
    const b = ship('constructionDrone');
    expect(fleetControls(b)).toEqual(['repair', 'upgrade', 'build']);
    expect(autoToggleCommand(b, 'build')).toEqual({ t: 'shipAuto', shipId: b.id, kind: 'build', on: !b.autoBuild });
    b.autoBuild = false;
    expect(autoToggleCommand(b, 'build')).toMatchObject({ kind: 'build', on: true });
    expect(autoToggleCommand(b, 'repair')).toMatchObject({ kind: 'repair', on: !b.autoRepair });
  });
});
