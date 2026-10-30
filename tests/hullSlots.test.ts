import { describe, expect, it } from 'vitest';
import { HULL_IDS, HULLS } from '../src/data/hulls';
import { COMPONENT_IDS } from '../src/data/components';
import { credit, emptyWallet, RESOURCES } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { scrapValue, slotCost } from '../src/sim/economy';
import { droneCount, flagship, isBuilder, makeShip, shipStats } from '../src/sim/ships';
import type { Fitted } from '../src/sim/types';
import { bankDelta, send } from './helpers';

const rich = () => {
  const s = newGame(1);
  s.run.bank = { ore: 1e5, ice: 1e5, crystal: 0, alloy: 1e5, fuel: 0 };
  return s;
};

/** An Excavator flagship bought up to 8 slots, every slot holding armor except the given overrides. */
const fullExcavator = (overrides: Record<number, Fitted | null>) => {
  const s = rich();
  const fs = flagship(s.run);
  send(s, { t: 'buyHull', hullId: 'excavator' });
  send(s, { t: 'buySlot', shipId: fs.id });
  send(s, { t: 'buySlot', shipId: fs.id }); // Excavator at 8
  fs.slots = fs.slots.map((_, i) => (i in overrides ? overrides[i]! : { type: 'armor', variant: 'standard', tier: 1 }));
  return { s, fs };
};
const sensor: Fitted = { type: 'sensor', variant: 'standard', tier: 1 };
const cargo: Fitted = { type: 'cargo', variant: 'standard', tier: 1 };
const shield: Fitted = { type: 'shield', variant: 'standard', tier: 1 };

describe('slot expansion (#141)', () => {
  it('every hull can grow to fit each component type at least once', () => {
    for (const id of HULL_IDS) {
      expect(HULLS[id].maxSlots).toBeGreaterThanOrEqual(COMPONENT_IDS.length);
      expect(HULLS[id].maxSlots).toBeGreaterThanOrEqual(HULLS[id].slots);
    }
    expect(HULLS.excavator.maxSlots).toBe(8);
  });

  it('HULLS.constructionDrone has role builder and fits each module type at least once', () => {
    const h = HULLS.constructionDrone;
    expect(h.role).toBe('builder');
    expect(h.maxSlots).toBeGreaterThanOrEqual(COMPONENT_IDS.length);
    expect(h.loadout.some((f) => f?.type === 'laser')).toBe(false);
    expect(HULL_IDS.at(-1)).toBe('constructionDrone');
  });

  it('droneCount counts construction drones, and they start with autoBuild on', () => {
    const s = newGame(1);
    const before = droneCount(s.run);
    const b = makeShip(s.run, s.profile, 'constructionDrone', 'Builder-1', { x: 0, z: 0 });
    s.run.ships.push(b);
    expect(droneCount(s.run)).toBe(before + 1);
    expect([isBuilder(b), b.autoBuild]).toEqual([true, true]);
    expect(flagship(s.run).autoBuild).toBe(false);
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

  it('a flagship downgrade moves parts past the new cap into free slots below it', () => {
    const { s, fs } = fullExcavator({ 2: null, 4: null, 6: sensor, 7: cargo });
    const before = { ...s.run.bank };
    send(s, { t: 'buyHull', hullId: 'prospector' }); // Prospector caps at 6
    expect(fs.slots).toHaveLength(6);
    expect(fs.slots[2]).toBe(sensor);
    expect(fs.slots[4]).toBe(cargo);
    const price = emptyWallet();
    credit(price, HULLS.prospector.cost);
    expect(bankDelta(before, s.run.bank)).toEqual(bankDelta(price, emptyWallet()));
    expect(s.out.log.at(-1)!.text).not.toContain('scrapped');
  });

  it('a flagship downgrade refunds parts that find no free slot, and says so', () => {
    const { s, fs } = fullExcavator({ 3: null, 6: sensor, 7: cargo });
    const before = { ...s.run.bank };
    send(s, { t: 'buyHull', hullId: 'prospector' });
    expect(fs.slots[3]).toBe(sensor);
    const expected = emptyWallet();
    credit(expected, scrapValue(cargo));
    const price = emptyWallet();
    credit(price, HULLS.prospector.cost);
    for (const r of RESOURCES) expected[r] -= price[r];
    expect(bankDelta(before, s.run.bank)).toEqual(expected);
    expect(s.out.log.at(-1)!.text).toContain('scrapped for');
  });

  it('a flagship downgrade that scraps a shield clamps shield to the new maximum', () => {
    const { s, fs } = fullExcavator({ 6: shield, 7: shield });
    fs.shield = shipStats(fs, s.profile).maxShield;
    send(s, { t: 'buyHull', hullId: 'prospector' });
    expect(fs.shield).toBeLessThanOrEqual(shipStats(fs, s.profile).maxShield);
  });
});
