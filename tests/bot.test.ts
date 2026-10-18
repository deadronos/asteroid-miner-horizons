import { describe, expect, it } from 'vitest';
import { botCommands } from '../scripts/bot';
import { runBot } from '../scripts/harness';
import { contractReward } from '../src/sim/contracts';
import { newGame } from '../src/sim/create';
import { droneCount, flagship } from '../src/sim/ships';
import type { Contract, Rock } from '../src/sim/types';

/** A deliverCrystal offer with a fixed id, for the bot's serviceability check. */
const crystalOffer = (id: number): Contract => {
  const { reward, data } = contractReward('deliverCrystal', 6);
  return { id, kind: 'deliverCrystal', target: 6, progress: 0, timeLimit: 360, timeLeft: 100, reward, data };
};

/** A bare rock at `(x, z)`, for controlling which target the bot picks. */
const rock = (id: number, kind: Rock['kind'], x: number, z: number): Rock => ({
  id,
  kind,
  size: 1,
  pos: { x, z },
  vel: { x: 0, z: 0 },
  radius: 20,
  hp: 10,
  maxHp: 10,
  units: 10,
  belt: 0,
});

describe('balance bot', () => {
  it('mines, unloads and buys a drone in the first system', () => {
    const s = newGame(1000);
    runBot(s, { seconds: 600, after: (st) => droneCount(st.run) > 0 });
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(droneCount(s.run)).toBeGreaterThan(0);
  });

  it('completes a contract in the first system', () => {
    const s = newGame(1000);
    runBot(s, { seconds: 600, warp: false });
    expect(s.run.contracts.completed).toBeGreaterThanOrEqual(1);
  });

  it('does not accept a deliverCrystal offer when the system has no crystal', () => {
    const s = newGame(1000);
    s.run.rocks = s.run.rocks.filter((r) => r.kind !== 'crystal');
    s.run.contracts.active = null;
    s.run.contracts.offers = [crystalOffer(1), crystalOffer(2)];

    const cmds = botCommands(s, { warp: false });
    expect(cmds.some((c) => c.t === 'acceptContract')).toBe(false);
  });

  it('accepts the first serviceable offer when no contract is active', () => {
    const s = newGame(1000);
    expect(s.run.contracts.active).toBeNull();
    const first = s.run.contracts.offers[0]!;

    expect(botCommands(s, { warp: false })).toEqual([{ t: 'acceptContract', contractId: first.id }]);
  });

  it('mines the contract resource for an active deliverIce contract', () => {
    const s = newGame(1000);
    const fs = flagship(s.run);
    fs.pos = { x: 0, z: 0 };
    fs.order = null;
    fs.cargo = { ore: 0, ice: 0, crystal: 0 };
    s.run.pickups = [];
    // Ore is nearest; the ice rock is farther but scores as half distance for the contract.
    s.run.rocks = [rock(1, 'ore', 100, 0), rock(2, 'ice', 0, 150)];
    s.run.contracts.active = {
      id: 9,
      kind: 'deliverIce',
      target: 90,
      progress: 0,
      timeLimit: 300,
      timeLeft: 300,
      reward: {},
      data: 0,
    };

    expect(botCommands(s, { warp: false })).toEqual([{ t: 'mine', shipId: fs.id, rockId: 2 }]);
  });
});
