import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { applyCommand, type Command } from '../src/sim/commands';
import { newGame } from '../src/sim/create';
import { handlers } from '../src/sim/handlers';
import { flagship, makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';

const send = (s: GameState, c: Command): void => applyCommand(s, c);
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
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' });
    expect(fs.slots[2]).toEqual({ type: 'shield', tier: 1 });
  });
  it('upgrade', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' });
    send(s, { t: 'upgrade', shipId: fs.id, slot: 2 });
    expect(fs.slots[2]!.tier).toBe(2);
  });
  it('remove', () => {
    const { s, fs } = fs1();
    s.run.bank.ore = 1000;
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' });
    send(s, { t: 'remove', shipId: fs.id, slot: 2 });
    expect(fs.slots[2]).toBeNull();
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
  });
  it('warp', () => {
    const s = newGame(1);
    s.run.bank.ice = 1000;
    send(s, { t: 'warp' });
    expect(s.profile.warps).toBe(1);
    expect(s.run.system.number).toBe(2);
  });

  it('warp logs an active contract it leaves behind', () => {
    const s = newGame(1);
    s.run.bank.ice = 1000;
    send(s, { t: 'acceptContract', contractId: s.run.contracts.offers[0]!.id });
    s.out.log.length = 0;
    send(s, { t: 'warp' });
    expect(s.run.contracts.active).toBeNull();
    expect(s.out.log.some((l) => l.level === 'warn' && l.text.startsWith('Contract left behind'))).toBe(true);
  });

  it('refine queues the clamped batch count and debits exactly its cost', () => {
    const s = newGame(1);
    s.run.bank = { ore: 5000, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 600 });

    expect(s.run.bank.ore).toBe(5000 - 4 * 500);
    expect(s.run.refinery.queue).toEqual([{ recipe: 'alloy', count: 500, total: 500, progress: 0 }]);
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

    send(s, { t: 'cancelRefine', index: 0 });

    expect(s.run.bank.ore).toBe(100);
    expect(s.run.refinery.queue).toHaveLength(0);
    expect(s.out.log.at(-1)).toMatchObject({
      level: 'info',
      text: 'Refinery: cancelled 5 × smelt alloy, refunded 20⬢.',
    });
  });

  it('cancelRefine is a silent no-op for an out-of-range index', () => {
    const s = newGame(1);
    s.run.bank = { ore: 100, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 5 });
    const bankBefore = JSON.stringify(s.run.bank);
    const queueBefore = JSON.stringify(s.run.refinery.queue);
    const n = s.out.log.length;

    send(s, { t: 'cancelRefine', index: -1 });
    send(s, { t: 'cancelRefine', index: 5 });

    expect(s.out.log.length).toBe(n);
    expect(JSON.stringify(s.run.bank)).toBe(bankBefore);
    expect(JSON.stringify(s.run.refinery.queue)).toBe(queueBefore);
  });

  it('warp leaves a queued refinery job behind', () => {
    const s = newGame(1);
    s.run.bank = { ore: 100, ice: 1000, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'refine', recipe: 'alloy', count: 5 });
    s.out.log.length = 0;

    send(s, { t: 'warp' });

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
    expect(Object.keys(handlers)).toHaveLength(18);
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
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' });
    expect(fs.slots[2]).toBeNull();
  });
  it('install is rejected when under-funded', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'shield' });
    expect(fs.slots[2]).toBeNull();
    expect(s.out.log.at(-1)).toMatchObject({ level: 'warn' });
  });
  it('remove re-clamps hull to the new max', () => {
    const { s, fs } = fs1();
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0, alloy: 0, fuel: 0 };
    send(s, { t: 'install', shipId: fs.id, slot: 2, comp: 'armor' });
    fs.hull = 1e9;
    send(s, { t: 'remove', shipId: fs.id, slot: 2 });
    expect(fs.hull).toBeLessThanOrEqual(100);
  });
});
