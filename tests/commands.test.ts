import { describe, expect, it } from 'vitest';
import { variantDef, type ComponentId } from '../src/data/components';
import { RESOURCES, type Cost } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { makeOutpost } from '../src/sim/automation';
import { newGame } from '../src/sim/create';
import { halve, investedCost, scrapValue, warpCost } from '../src/sim/economy';
import { makeRock } from '../src/sim/generate';
import { describeModifiers, rollModifiers } from '../src/sim/modifiers';
import { handlers } from '../src/sim/handlers';
import { warpRoutes } from '../src/sim/routes';
import { flagship, makeShip } from '../src/sim/ships';
import { bankDelta, send } from './helpers';

const fs1 = () => {
  const s = newGame(1);
  return { s, fs: flagship(s.run) };
};

describe('command handlers', () => {
  it('select', () => {
    const { s, fs } = fs1();
    s.run.selectedId = 0;
    send(s, { t: 'select', shipId: fs.id });
    expect(s.run.selectedId).toBe(fs.id);
  });
  it('move', () => {
    const { s, fs } = fs1();
    send(s, { t: 'move', shipId: fs.id, to: { x: 5, z: 6 } });
    expect(fs.order).toEqual({ kind: 'move', to: { x: 5, z: 6 } });
  });
  it('mine', () => {
    const { s, fs } = fs1();
    send(s, { t: 'mine', shipId: fs.id, rockId: s.run.rocks[0]!.id });
    expect(fs.order).toEqual({ kind: 'mine', rockId: s.run.rocks[0]!.id });
  });
  it('mine rejects a dense rock below a tier-2 laser and keeps the order', () => {
    const { s, fs } = fs1();
    fs.pos = { ...s.run.system.station.pos };
    fs.order = { kind: 'dock' };
    const dense = makeRock(s.run, 'ore', 1, { x: fs.pos.x + 50, z: fs.pos.z }, 10, 0, 'dense');
    s.run.rocks.push(dense);
    send(s, { t: 'mine', shipId: fs.id, rockId: dense.id });
    expect(s.out.log.some((l) => l.level === 'warn' && l.text.includes('Dense'))).toBe(true);
    expect(fs.order).toEqual({ kind: 'dock' });
  });
  it('dock', () => {
    const { s, fs } = fs1();
    send(s, { t: 'dock', shipId: fs.id });
    expect(fs.order).toEqual({ kind: 'dock' });
  });
  it('stop clears order + ai target', () => {
    const { s, fs } = fs1();
    fs.order = { kind: 'dock' };
    fs.aiTargetId = 7;
    send(s, { t: 'stop', shipId: fs.id });
    expect(fs.order).toBeNull();
    expect(fs.aiTargetId).toBeNull();
  });
  it('aiMode sets mode, clears ai target, keeps order', () => {
    const { s, fs } = fs1();
    fs.order = { kind: 'dock' };
    fs.aiTargetId = 7;
    send(s, { t: 'aiMode', shipId: fs.id, mode: 'auto' });
    expect(fs.aiMode).toBe('auto');
    expect(fs.aiTargetId).toBeNull();
    expect(fs.order).toEqual({ kind: 'dock' });
  });
  it('install', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    expect(fs.slots[2]).toEqual({ type: 'shield', variant: 'standard', tier: 1 });
    expect(s.profile.stats.installs).toBe(1);
  });
  it('a rejected install does not count toward the installs stat', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
    expect(fs.slots[2]).toBeNull();
    expect(s.profile.stats.installs).toBe(0);
  });
  it('dismissGoals hides the first-steps checklist once, logging one line', () => {
    const { s } = fs1();
    expect(s.profile.goalsDismissed).toBe(false);
    const n = s.out.log.length;
    send(s, { t: 'dismissGoals' });
    expect(s.profile.goalsDismissed).toBe(true);
    expect(s.out.log.length).toBe(n + 1);
    send(s, { t: 'dismissGoals' });
    expect(s.profile.goalsDismissed).toBe(true);
    expect(s.out.log.length).toBe(n + 1);
  });
  it('install fits the chosen variant at tier 1', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    expect(fs.slots[2]).toEqual({ type: 'laser', variant: 'wide', tier: 1 });
  });
  it('rejects another variant of the component already fitted in the slot', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'focused' });
    const fitted = fs.slots[2];
    const bankBefore = { ...s.run.bank };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
    expect(s.out.log.at(-1)!.text).toContain('Focused Beam');
    expect(s.out.log.at(-1)!.text).toContain('Remove it before fitting Wide Beam');
    expect(fs.slots[2]).toBe(fitted);
    expect(s.run.bank).toEqual(bankBefore);
  });
  it('re-installing the variant already fitted only says the slot holds it', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    const bankBefore = { ...s.run.bank };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
    expect(s.out.log.at(-1)!.text).toContain('already holds a Wide Beam.');
    expect(s.out.log.at(-1)!.text).not.toContain('Remove');
    expect(s.run.bank).toEqual(bankBefore);
  });
  it('install replaces a different component type, refunding the old and charging the new', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    const old = fs.slots[2]!;
    const before = { ...s.run.bank };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    expect(fs.slots[2]).toEqual({ type: 'shield', variant: 'standard', tier: 1 });
    const expected: Cost = {};
    const refund = scrapValue(old);
    const price = variantDef('shield', 'standard').cost(1);
    for (const r of RESOURCES) expected[r] = (refund[r] ?? 0) - (price[r] ?? 0);
    expect(bankDelta(before, s.run.bank)).toEqual(expected);
  });
  it('rejects an unknown component variant', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    const bankBefore = JSON.stringify(s.run.bank);
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'ion' });
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn', text: 'Unknown component variant.' });
    expect(fs.slots[2]).toBeNull();
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
  });
  it('rejects an unknown component id rather than throwing', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    const bankBefore = JSON.stringify(s.run.bank);
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'warpdrive' as ComponentId, variant: 'standard' });
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn', text: 'Unknown component variant.' });
    expect(fs.slots[2]).toBeNull();
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
  });
  it('ignores a non-integer slot index', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0, alloy: 0, fuel: 0 };
    const bankBefore = JSON.stringify(s.run.bank);
    const slotsBefore = JSON.stringify(fs.slots);
    for (const slot of [1.5, NaN, Infinity]) {
      send(s, { t: 'install', shipId: fs.id, slot, comp: 'shield', variant: 'standard' });
      send(s, { t: 'upgrade', shipId: fs.id, slot });
      send(s, { t: 'remove', shipId: fs.id, slot });
    }
    expect(Object.keys(fs.slots)).toEqual(fs.slots.map((_, i) => String(i)));
    expect(JSON.stringify(fs.slots)).toBe(slotsBefore);
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
  });
  it('upgrade', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    send(s, { t: 'upgrade', shipId: fs.id, slot: 2 });
    expect(fs.slots[2]!.tier).toBe(2);
  });
  it('remove', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    send(s, { t: 'remove', shipId: fs.id, slot: 2 });
    expect(fs.slots[2]).toBeNull();
  });
  it('remove refunds half the invested cost of the installed non-default variant', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'laser', variant: 'wide' });
    const before = { ...s.run.bank };
    send(s, { t: 'remove', shipId: fs.id, slot: 2 });
    const delta = bankDelta(before, s.run.bank);
    expect(delta).toEqual(halve(investedCost('laser', 'wide', 1)));
    // A focused beam costs more, so this guards that the refund reads the variant.
    expect(delta).not.toEqual(halve(investedCost('laser', 'focused', 1)));
  });
  it('repair', () => {
    const { s, fs } = fs1();
    fs.hull = 50;
    s.run.bank.ore = 1000;
    send(s, { t: 'repair', shipId: fs.id });
    expect(fs.hull).toBeGreaterThan(50);
  });
  it('buyHull', () => {
    const s = newGame(1);
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    const n = s.run.ships.length;
    send(s, { t: 'buyHull', hullId: 'drone' });
    expect(s.run.ships.length).toBe(n + 1);
    expect([s.profile.stats.drones, s.profile.stats.miningDrones]).toEqual([1, 1]);
  });
  it('buying a hauler counts as a launch but not as a mining drone', () => {
    const s = newGame(1);
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 1e4, alloy: 1e4, fuel: 0 };
    send(s, { t: 'buyHull', hullId: 'hauler' });
    expect(s.run.ships.some((x) => x.hullId === 'hauler')).toBe(true);
    expect([s.profile.stats.drones, s.profile.stats.miningDrones]).toEqual([1, 0]);
  });
  it('scrap', () => {
    const s = newGame(1);
    const d = makeShip(s.run, s.profile, 'drone', 'Drone-9', { ...s.run.system.station.pos });
    s.run.ships.push(d);
    send(s, { t: 'scrap', shipId: d.id });
    expect(s.run.ships).not.toContain(d);
  });
  it('buyPerk', () => {
    const s = newGame(1);
    s.profile.data = 5;
    send(s, { t: 'buyPerk', perk: 'optics' });
    expect(s.profile.perks.optics).toBe(1);
    expect(s.profile.data).toBe(4);
    expect(s.out.log.at(-1)).toMatchObject({
      level: 'major',
      event: 'research',
    });
  });
  it('warp', () => {
    const s = newGame(1);
    s.run.bank.fuel = 1000;
    send(s, { t: 'warp', route: 0 });
    expect(s.profile.warps).toBe(1);
    expect(s.run.system.number).toBe(2);
  });
  it('warp lands in the system its route previewed', () => {
    for (let route = 0; route < TUNING.warpRoutes; route++) {
      const s = newGame(5);
      s.profile.warps = 2;
      s.run.bank.fuel = 1000;
      const preview = warpRoutes(s.profile)[route]!;
      send(s, { t: 'warp', route });
      expect(s.run.system).toEqual(preview);
    }
  });
  it('rejects a warp to an unknown route and changes nothing', () => {
    for (const route of [-1, TUNING.warpRoutes, 0.5, Number.NaN]) {
      const s = newGame(1);
      s.run.bank.fuel = 1000;
      const before = { profile: structuredClone(s.profile), run: structuredClone(s.run) };
      send(s, { t: 'warp', route });
      expect(s.out.log.at(-1)).toMatchObject({ level: 'warn', text: 'Unknown warp route.' });
      expect({ profile: s.profile, run: s.run }).toEqual(before);
    }
  });

  it('warp logs the new system modifiers right after Warp complete', () => {
    let seed = 1;
    while (rollModifiers(seed, 3).length === 0) seed++;
    const s = newGame(seed);
    s.profile.warps = 1;
    s.run.bank.fuel = 1000;
    s.out.log.length = 0;
    send(s, { t: 'warp', route: 0 });
    const i = s.out.log.findIndex((l) => l.text.startsWith('Warp complete'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(s.run.system.modifiers.length).toBeGreaterThan(0);
    expect(s.out.log[i + 1]!.text).toBe(`System modifiers: ${describeModifiers(s.run.system.modifiers)}.`);
  });
  it('warp into system 2 logs no modifier line', () => {
    const s = newGame(1);
    s.run.bank.fuel = 1000;
    send(s, { t: 'warp', route: 0 });
    expect(s.run.system.number).toBe(2);
    expect(s.out.log.some((l) => l.text.startsWith('System modifiers'))).toBe(false);
  });
  it('rejects a warp funded with ice only', () => {
    const s = newGame(1);
    s.run.bank.ice = 1000;
    send(s, { t: 'warp', route: 0 });
    expect(s.profile.warps).toBe(0);
    expect(s.out.log.at(-1)).toMatchObject({
      level: 'warn',
      text: `Warp needs ${warpCost(s)} fuel in the station bank.`,
    });
  });

  it('warp logs an active contract it leaves behind', () => {
    const s = newGame(1);
    s.run.bank.fuel = 1000;
    send(s, { t: 'acceptContract', contractId: s.run.contracts.offers[0]!.id });
    s.out.log.length = 0;
    send(s, { t: 'warp', route: 0 });
    expect(s.run.contracts.active).toBeNull();
    expect(s.out.log.some((l) => l.level === 'warn' && l.text.startsWith('Contract left behind'))).toBe(true);
  });

  it('refine queues the clamped batch count and debits exactly its cost', () => {
    const s = newGame(1);
    s.run.bank = { ore: 5000, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 600 });

    expect(s.run.bank.ore).toBe(5000 - 4 * 500);
    expect(s.run.refinery.queue).toEqual([{ id: 1, recipe: 'alloy', count: 500, total: 500, progress: 0 }]);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'info', text: 'Refinery: queued 500 × smelt alloy.' });
  });

  it('refine warns and leaves the bank and queue untouched when unaffordable', () => {
    const s = newGame(1);
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    const bankBefore = JSON.stringify(s.run.bank);
    const queueBefore = JSON.stringify(s.run.refinery.queue);

    send(s, { t: 'refine', recipe: 'alloy', count: 5 });

    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn', text: 'Not enough ore to refine 5 alloy.' });
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
    expect(JSON.stringify(s.run.refinery.queue)).toBe(queueBefore);
  });

  it('cancelRefine refunds the unfinished batches', () => {
    const s = newGame(1);
    s.run.bank = { ore: 100, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 5 });

    send(s, { t: 'cancelRefine', jobId: s.run.refinery.queue[0]!.id });

    expect(s.run.bank.ore).toBe(100);
    expect(s.run.refinery.queue).toHaveLength(0);
    expect(s.out.log.at(-1)).toMatchObject({
      level: 'info',
      text: 'Refinery: cancelled 5 × smelt alloy, refunded 20⬢.',
    });
  });

  it('cancelRefine is a silent no-op for an id that is not queued', () => {
    const s = newGame(1);
    s.run.bank = { ore: 100, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 5 });
    const bankBefore = JSON.stringify(s.run.bank);
    const queueBefore = JSON.stringify(s.run.refinery.queue);
    const n = s.out.log.length;

    send(s, { t: 'cancelRefine', jobId: -1 });
    send(s, { t: 'cancelRefine', jobId: 5 });

    expect(s.out.log.length).toBe(n);
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
    expect(JSON.stringify(s.run.refinery.queue)).toBe(queueBefore);
  });

  it('warp leaves a queued refinery job behind', () => {
    const s = newGame(1);
    s.run.bank = { ore: 100, ice: 0, crystal: 0, alloy: 0, fuel: 1000 };
    send(s, { t: 'refine', recipe: 'alloy', count: 5 });
    s.out.log.length = 0;

    send(s, { t: 'warp', route: 0 });

    expect(s.run.refinery.queue).toHaveLength(0);
    const complete = s.out.log.findIndex((l) => l.text.startsWith('Warp complete'));
    const left = s.out.log.findIndex((l) => l.text === 'Refinery queue left behind: 5 × smelt alloy.');
    expect(left).toBeGreaterThan(complete);
    expect(s.out.log[left]).toMatchObject({ level: 'warn' });
  });

  it('acceptContract moves an offer to active and refills the board', () => {
    const s = newGame(1);
    const board = s.run.contracts;
    const offer = board.offers[0]!;
    const idsBefore = new Set(board.offers.map((o) => o.id));
    const rngBefore = s.run.rng.s;
    const nextIdBefore = s.run.nextId;

    send(s, { t: 'acceptContract', contractId: offer.id });

    expect(board.active).toMatchObject({
      id: offer.id,
      kind: offer.kind,
      target: offer.target,
      reward: offer.reward,
      data: offer.data,
      progress: 0,
    });
    expect(board.active!.timeLeft).toBe(offer.timeLimit);
    expect(board.offers).toHaveLength(TUNING.contractOffers);
    expect(board.offers.map((o) => o.id)).not.toContain(offer.id);
    expect(board.offers.some((o) => !idsBefore.has(o.id))).toBe(true);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'info', text: expect.stringMatching(/^Contract accepted: /) });
    // Contracts run on the board's own RNG and id sequence, never the run's.
    expect(s.run.rng.s).toBe(rngBefore);
    expect(s.run.nextId).toBe(nextIdBefore);

    send(s, { t: 'abandonContract' });

    expect(s.out.log.at(-1)).toMatchObject({ level: 'info', text: expect.stringMatching(/^Contract abandoned: /) });
    expect(s.run.rng.s).toBe(rngBefore);
    expect(s.run.nextId).toBe(nextIdBefore);
  });

  it('acceptContract is rejected while a contract is already active', () => {
    const s = newGame(1);
    const board = s.run.contracts;
    send(s, { t: 'acceptContract', contractId: board.offers[0]!.id });
    const before = JSON.stringify(board);

    send(s, { t: 'acceptContract', contractId: board.offers[0]!.id });

    expect(s.out.log.at(-1)).toMatchObject({
      level: 'warn',
      text: 'Finish or abandon the current contract first.',
    });
    expect(JSON.stringify(board)).toBe(before);
  });

  it('acceptContract warns and changes nothing for an unknown id', () => {
    const s = newGame(1);
    const board = s.run.contracts;
    const before = JSON.stringify(board);

    send(s, { t: 'acceptContract', contractId: 9999 });

    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn', text: 'That contract is no longer offered.' });
    expect(JSON.stringify(board)).toBe(before);
  });

  it('abandonContract clears the active contract and counts a failure', () => {
    const s = newGame(1);
    const board = s.run.contracts;
    send(s, { t: 'acceptContract', contractId: board.offers[0]!.id });

    send(s, { t: 'abandonContract' });

    expect(board.active).toBeNull();
    expect(board.failed).toBe(1);
    expect(s.out.log.at(-1)).toMatchObject({ level: 'info', text: expect.stringMatching(/^Contract abandoned: /) });
  });

  it('abandonContract is a silent no-op without an active contract', () => {
    const s = newGame(1);
    const n = s.out.log.length;
    const before = JSON.stringify(s.run.contracts);

    send(s, { t: 'abandonContract' });

    expect(s.out.log.length).toBe(n);
    expect(JSON.stringify(s.run.contracts)).toBe(before);
  });

  it('handlers are exported and individually invokable', () => {
    const s = newGame(1),
      fs = flagship(s.run);
    s.run.selectedId = 0;
    handlers.select(s, { t: 'select', shipId: fs.id });
    expect(s.run.selectedId).toBe(fs.id);
    expect(Object.keys(handlers)).toHaveLength(22);
  });

  it('warp leaves outposts behind with a warning', () => {
    const s = newGame(1);
    s.run.bank.fuel = 1000;
    const rock = s.run.rocks.find((r) => r.size === 0)!;
    s.run.automation.outposts.push(makeOutpost(rock));
    send(s, { t: 'warp', route: 0 });
    expect(s.run.automation.outposts).toEqual([]);
    expect(s.out.log.some((l) => l.level === 'warn' && l.text.startsWith('Outposts left behind: 1'))).toBe(true);
  });

  it('a command for a missing ship is a silent no-op', () => {
    const s = newGame(1),
      n = s.out.log.length;
    send(s, { t: 'stop', shipId: 999 });
    expect(s.out.log.length).toBe(n);
  });
  it('mine without a laser warns and sets no order', () => {
    const s = newGame(1),
      h = makeShip(s.run, s.profile, 'excavator', 'Ex', { ...s.run.system.station.pos });
    s.run.ships.push(h);
    send(s, { t: 'mine', shipId: h.id, rockId: s.run.rocks[0]!.id });
    expect(h.order).toBeNull();
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });
  it('install is rejected unless docked', () => {
    const { s, fs } = fs1();
    fs.pos = { x: 0, z: 5000 };
    s.run.bank.ore = 1000;
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    expect(fs.slots[2]).toBeNull();
  });
  it('install is rejected when under-funded', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield', variant: 'standard' });
    expect(fs.slots[2]).toBeNull();
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });
  it('remove re-clamps hull to the new max', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'armor', variant: 'standard' });
    fs.hull = 1e9;
    send(s, { t: 'remove', shipId: fs.id, slot: 2 });
    expect(fs.hull).toBeLessThanOrEqual(100);
  });
});
