import { describe, expect, it } from 'vitest';
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
    s.run.bank = { ore: 1e4, ice: 1e4, crystal: 0 };
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
    s.run.bank = { ore: 1000, ice: 1000, crystal: 0 };
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

  it('handlers are exported and individually invokable', () => {
    const s = newGame(1),
      fs = flagship(s.run);
    s.run.selectedId = 0;
    handlers.select(s, { t: 'select', shipId: fs.id });
    expect(s.run.selectedId).toBe(fs.id);
    expect(Object.keys(handlers)).toHaveLength(14);
  });
});
