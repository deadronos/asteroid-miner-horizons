import { describe, expect, it } from 'vitest';
import { HULL_IDS, HULLS } from '../src/data/hulls';
import { COMPONENT_IDS } from '../src/data/components';
import { RESOURCES, type Cost } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { scrapValue, slotCost } from '../src/sim/economy';
import { flagship, makeShip } from '../src/sim/ships';
import type { Fitted } from '../src/sim/types';
import { send } from './helpers';

const rich = () => {
  const s = newGame(1);
  s.run.bank = { ore: 1e5, ice: 1e5, crystal: 0, alloy: 1e5, fuel: 0 };
  return s;
};

describe('slot expansion (#141)', () => {
  it('every hull can grow to fit each component type at least once', () => {
    for (const id of HULL_IDS) {
      expect(HULLS[id].maxSlots).toBeGreaterThanOrEqual(COMPONENT_IDS.length);
      expect(HULLS[id].maxSlots).toBeGreaterThanOrEqual(HULLS[id].slots);
    }
    expect(HULLS.excavator.maxSlots).toBe(8);
  });

  it('prices a slot by its number, so the 3rd costs the base and each later one grows', () => {
    const s = newGame(1);
    const d = makeShip(s.run, s.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
    expect(slotCost(d)).toEqual(TUNING.slotBaseCost);
    d.slots.push(null);
    expect(slotCost(d)).toEqual({
      ore: Math.round(TUNING.slotBaseCost.ore * TUNING.slotCostGrowth),
      ice: Math.round(TUNING.slotBaseCost.ice * TUNING.slotCostGrowth),
    });
    while (d.slots.length < HULLS.drone.maxSlots) d.slots.push(null);
    expect(slotCost(d)).toBeNull();
  });

  it('buySlot adds an empty slot and debits exactly its cost', () => {
    const s = rich();
    const fs = flagship(s.run);
    const cost = slotCost(fs)!;
    const before = { ...s.run.bank };
    send(s, { t: 'buySlot', shipId: fs.id });
    expect(fs.slots).toHaveLength(HULLS.prospector.slots + 1);
    expect(fs.slots.at(-1)).toBeNull();
    expect(s.run.bank.ore).toBe(before.ore - cost.ore!);
    expect(s.run.bank.ice).toBe(before.ice - cost.ice!);
  });

  it('buySlot stops at the hull cap with a warning', () => {
    const s = rich();
    const fs = flagship(s.run);
    for (let i = 0; i < 10; i++) send(s, { t: 'buySlot', shipId: fs.id });
    expect(fs.slots).toHaveLength(HULLS.prospector.maxSlots);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });

  it('buySlot is rejected unless docked, and when under-funded', () => {
    const s = rich();
    const fs = flagship(s.run);
    const n = fs.slots.length;
    fs.pos = { x: 0, z: 5000 };
    send(s, { t: 'buySlot', shipId: fs.id });
    expect(fs.slots).toHaveLength(n);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });

    fs.pos = { ...s.run.system.station.pos };
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'buySlot', shipId: fs.id });
    expect(fs.slots).toHaveLength(n);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });

  it('a flagship refit keeps bought slots up to the new hull cap', () => {
    const s = rich();
    const fs = flagship(s.run);
    send(s, { t: 'buySlot', shipId: fs.id });
    send(s, { t: 'buySlot', shipId: fs.id }); // Prospector at 6
    send(s, { t: 'buyHull', hullId: 'excavator' });
    expect(fs.slots).toHaveLength(6);
    send(s, { t: 'buySlot', shipId: fs.id });
    send(s, { t: 'buySlot', shipId: fs.id }); // Excavator at 8
    expect(fs.slots).toHaveLength(8);
    send(s, { t: 'buyHull', hullId: 'prospector' });
    expect(fs.slots).toHaveLength(6);
  });

  it('a flagship refit keeps fitted parts at their slot indices', () => {
    const s = rich();
    const fs = flagship(s.run);
    fs.slots = [
      null,
      { type: 'shield', variant: 'standard', tier: 1 },
      { type: 'cargo', variant: 'standard', tier: 1 },
      null,
    ];
    send(s, { t: 'buyHull', hullId: 'excavator' });
    expect(fs.slots).toEqual([
      null,
      { type: 'shield', variant: 'standard', tier: 1 },
      { type: 'cargo', variant: 'standard', tier: 1 },
      null,
      null,
      null,
    ]);
    expect(fs.slots.filter((f) => f)).toHaveLength(2);
  });

  it('a flagship refit refunds fitted parts beyond the new hull cap', () => {
    const s = rich();
    const fs = flagship(s.run);
    send(s, { t: 'buyHull', hullId: 'excavator' });
    send(s, { t: 'buySlot', shipId: fs.id });
    send(s, { t: 'buySlot', shipId: fs.id }); // Excavator at 8
    const sensor: Fitted = { type: 'sensor', variant: 'standard', tier: 1 };
    const cargo: Fitted = { type: 'cargo', variant: 'standard', tier: 1 };
    fs.slots[6] = sensor;
    fs.slots[7] = cargo;
    const before = { ...s.run.bank };
    send(s, { t: 'buyHull', hullId: 'prospector' }); // Prospector caps at 6
    expect(fs.slots).toHaveLength(6);
    const refund = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    for (const f of [sensor, cargo]) {
      const value = scrapValue(f);
      for (const r of RESOURCES) refund[r] += value[r] ?? 0;
    }
    const delta = Object.fromEntries(RESOURCES.map((r) => [r, s.run.bank[r] - before[r]])) as Cost;
    expect(delta).toEqual(refund);
  });
});
