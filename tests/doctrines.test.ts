import { describe, expect, it } from 'vitest';
import {
  DOCTRINE_PAIR_IDS,
  DOCTRINE_PAIRS,
  DOCTRINE_SIDE_IDS,
  DOCTRINE_SIDES,
  emptyDoctrines,
  sideCost,
  sideBonus,
} from '../src/data/doctrines';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { doctrineWindowOpen } from '../src/sim/economy';
import { deserialize, serialize } from '../src/sim/save';
import { fleetCap, flagship, makeShip, shipStats } from '../src/sim/ships';
import type { Command } from '../src/sim/commands';
import type { DoctrineChoice, DoctrineSideId } from '../src/data/doctrines';
import { doctrinePanel } from '../src/ui/doctrines';
import { send } from './helpers';

const ratio = (got: number, base: number): number => got / base;

function fitted(choice: Partial<DoctrineChoice>) {
  const state = newGame(3);
  state.profile.doctrines = { ...emptyDoctrines(), ...choice };
  const drone = makeShip(state.run, state.profile, 'drone', 'Drone-1', { x: 0, z: 0 });
  const hauler = makeShip(state.run, state.profile, 'hauler', 'Hauler-1', { x: 10, z: 0 });
  return { state, fs: flagship(state.run), drone, hauler };
}

describe('doctrine effects', () => {
  const base = fitted({});

  it('Swarm Doctrine adds a fleet slot and cuts drone damage by 10%', () => {
    const got = fitted({ fleet: 'swarm' });
    expect(fleetCap(got.state.profile)).toBe(fleetCap(base.state.profile) + 1);
    expect(
      ratio(shipStats(got.drone, got.state.profile).dps, shipStats(base.drone, base.state.profile).dps),
    ).toBeCloseTo(0.9);
    expect(shipStats(got.fs, got.state.profile).dps).toBeCloseTo(shipStats(base.fs, base.state.profile).dps);
    expect(shipStats(got.hauler, got.state.profile).dps).toBeCloseTo(shipStats(base.hauler, base.state.profile).dps);
  });

  it('Ace Pilot raises flagship damage by 25% and cuts flagship speed by 8%', () => {
    const got = fitted({ fleet: 'ace' });
    const fs = shipStats(got.fs, got.state.profile);
    const was = shipStats(base.fs, base.state.profile);
    expect(ratio(fs.dps, was.dps)).toBeCloseTo(1.25);
    expect(ratio(fs.speed, was.speed)).toBeCloseTo(0.92);
    expect(ratio(fs.accel, was.accel)).toBeCloseTo(0.92);
    expect(shipStats(got.drone, got.state.profile).dps).toBeCloseTo(shipStats(base.drone, base.state.profile).dps);
    expect(fleetCap(got.state.profile)).toBe(fleetCap(base.state.profile));
  });

  it('Ace Pilot stacks with the optics perk on the same stat path', () => {
    const plain = newGame(3);
    plain.profile.perks.optics = 1;
    const ace = newGame(3);
    ace.profile.perks.optics = 1;
    ace.profile.doctrines.fleet = 'ace';
    expect(shipStats(flagship(ace.run), ace.profile).dps).toBeCloseTo(
      shipStats(flagship(plain.run), plain.profile).dps * 1.25,
    );
  });

  it('Bulk Freighter adds 25% cargo and cuts speed by 10% on every ship', () => {
    const got = fitted({ haul: 'freighter' });
    for (const key of ['fs', 'drone', 'hauler'] as const) {
      const next = shipStats(got[key], got.state.profile);
      const was = shipStats(base[key], base.state.profile);
      expect(ratio(next.cargoCap, was.cargoCap)).toBeCloseTo(1.25);
      expect(ratio(next.speed, was.speed)).toBeCloseTo(0.9);
      expect(ratio(next.accel, was.accel)).toBeCloseTo(0.9);
    }
  });

  it('Courier adds 12% speed and cuts cargo by 15%', () => {
    const got = fitted({ haul: 'courier' });
    const next = shipStats(got.fs, got.state.profile);
    const was = shipStats(base.fs, base.state.profile);
    expect(ratio(next.speed, was.speed)).toBeCloseTo(1.12);
    expect(ratio(next.accel, was.accel)).toBeCloseTo(1.12);
    expect(ratio(next.cargoCap, was.cargoCap)).toBeCloseTo(0.85);
  });

  it('Survey Array adds 25% pickup radius and cuts laser damage by 10%', () => {
    const got = fitted({ focus: 'survey' });
    const next = shipStats(got.fs, got.state.profile);
    const was = shipStats(base.fs, base.state.profile);
    expect(ratio(next.magnet, was.magnet)).toBeCloseTo(1.25);
    expect(ratio(next.dps, was.dps)).toBeCloseTo(0.9);
    expect(fleetCap(got.state.profile)).toBe(fleetCap(base.state.profile));
  });

  it('Brawler adds 15% laser damage and cuts pickup radius by 20%', () => {
    const got = fitted({ focus: 'brawler' });
    const next = shipStats(got.drone, got.state.profile);
    const was = shipStats(base.drone, base.state.profile);
    expect(ratio(next.dps, was.dps)).toBeCloseTo(1.15);
    expect(ratio(next.magnet, was.magnet)).toBeCloseTo(0.8);
  });
});

describe('chooseDoctrine', () => {
  it('stores one side, costs no Horizon Data, and leaves the rng alone', () => {
    const s = newGame(1);
    s.profile.data = 4;
    const rng = s.run.rng.s;
    const perks = s.profile.stats.perks;
    send(s, { t: 'chooseDoctrine', pair: 'fleet', side: 'swarm' });
    expect(s.profile.doctrines).toEqual({ ...emptyDoctrines(), fleet: 'swarm' });
    expect(s.profile.data).toBe(4);
    expect(s.profile.stats.perks).toBe(perks);
    expect(s.run.rng.s).toBe(rng);
    expect(s.out.log.at(-1)).toMatchObject({
      level: 'major',
      event: 'research',
      text: 'Chose Swarm Doctrine: +1 fleet capacity, −10% drone damage.',
    });
  });

  it('swaps to the other side while the window is open and keeps only that side', () => {
    const s = newGame(1);
    send(s, { t: 'chooseDoctrine', pair: 'fleet', side: 'swarm' });
    send(s, { t: 'chooseDoctrine', pair: 'fleet', side: 'ace' });
    expect(s.profile.doctrines.fleet).toBe('ace');
    expect(s.out.log.at(-1)?.text).toContain('Swapped to Ace Pilot');
    expect(s.out.log.at(-1)?.text).toContain('+25% flagship damage');
    expect(s.out.log.at(-1)?.text).toContain('−8% flagship speed');
  });

  it('rejects the other side once the window has closed and changes nothing', () => {
    const s = newGame(1);
    send(s, { t: 'chooseDoctrine', pair: 'fleet', side: 'swarm' });
    s.run.time = TUNING.doctrineWindow;
    s.out.log.length = 0;
    const before = structuredClone(s.profile);
    send(s, { t: 'chooseDoctrine', pair: 'fleet', side: 'ace' });
    expect(s.out.log.at(-1)).toEqual({
      level: 'warn',
      text: 'Ace Pilot is locked: Swarm Doctrine is chosen. Respec at warp.',
    });
    expect(s.profile).toEqual(before);
  });

  it('rejects a first pick after the window closes', () => {
    const s = newGame(1);
    s.run.time = TUNING.doctrineWindow;
    send(s, { t: 'chooseDoctrine', pair: 'haul', side: 'freighter' });
    expect(s.profile.doctrines.haul).toBeNull();
    expect(s.out.log.at(-1)?.text).toBe('Doctrines are locked until you warp.');
  });

  it('rejects a side that belongs to another pair', () => {
    const s = newGame(1);
    send(s, { t: 'chooseDoctrine', pair: 'haul', side: 'swarm' });
    expect(s.profile.doctrines).toEqual(emptyDoctrines());
    expect(s.out.log.at(-1)?.text).toBe('That choice is not part of this doctrine.');
  });

  it('rejects an unknown pair', () => {
    const s = newGame(1);
    send(s, { t: 'chooseDoctrine', pair: 'nope', side: null } as unknown as Command);
    expect(s.profile.doctrines).toEqual(emptyDoctrines());
    expect(s.out.log.at(-1)?.text).toBe('Unknown doctrine.');
  });

  it('clears a pair inside the window and keeps the choice across a warp', () => {
    const s = newGame(1);
    s.run.bank.fuel = 1000;
    send(s, { t: 'chooseDoctrine', pair: 'focus', side: 'brawler' });
    send(s, { t: 'warp', route: 0 });
    expect(s.profile.warps).toBe(1);
    expect(s.profile.doctrines.focus).toBe('brawler');
    expect(doctrineWindowOpen(s.run.time)).toBe(true);
    send(s, { t: 'chooseDoctrine', pair: 'focus', side: null });
    expect(s.profile.doctrines.focus).toBeNull();
    expect(s.out.log.at(-1)?.text).toBe('Cleared Beam.');
  });

  it('round-trips a chosen doctrine through a save', () => {
    const s = newGame(9);
    send(s, { t: 'chooseDoctrine', pair: 'haul', side: 'courier' });
    const back = deserialize(serialize(s));
    expect(back?.profile.doctrines).toEqual(s.profile.doctrines);
    expect(serialize(back!)).toBe(serialize(s));
  });
});

describe('doctrine saves', () => {
  it('rejects a side stored on the wrong pair', () => {
    const s = newGame(1);
    const data = JSON.parse(serialize(s)) as { profile: { doctrines: DoctrineChoice } };
    data.profile.doctrines.haul = 'swarm' as DoctrineSideId;
    expect(deserialize(JSON.stringify(data))).toBeNull();
  });

  it('rejects a missing pair and an extra key', () => {
    const s = newGame(1);
    const data = JSON.parse(serialize(s)) as { profile: { doctrines: Record<string, unknown> } };
    delete data.profile.doctrines.focus;
    expect(deserialize(JSON.stringify(data))).toBeNull();
    data.profile.doctrines.focus = null;
    data.profile.doctrines.extra = 'swarm';
    expect(deserialize(JSON.stringify(data))).toBeNull();
  });
});

describe('doctrine panel', () => {
  it('shows each pair as text, with a respec-at-warp hint once locked', () => {
    const s = newGame(1);
    s.profile.doctrines.fleet = 'swarm';
    const open = doctrinePanel(s.profile, 0);
    expect(open.hint).toContain('Respec window');
    expect(open.hint).toContain('Respec at warp');
    expect(open.pairs.map((p) => p.id)).toEqual([...DOCTRINE_PAIR_IDS]);
    const fleet = open.pairs[0]!;
    expect(fleet.locked).toBe(false);
    expect(fleet.sides[0]).toMatchObject({ action: 'Chosen', picked: true });
    expect(fleet.sides[1]).toMatchObject({ action: 'Swap', picked: false });
    expect(fleet.clear).toBe('Clear');
    for (const pair of open.pairs) {
      for (const side of pair.sides) {
        expect(side.trade.startsWith('Bonus: +')).toBe(true);
        expect(side.trade).toContain('Cost: −');
      }
    }

    const locked = doctrinePanel(s.profile, TUNING.doctrineWindow);
    expect(locked.hint).toContain('Respec at warp');
    expect(locked.pairs[0]!.locked).toBe(true);
    expect(locked.pairs[0]!.sides[0]!.action).toBe('Chosen');
    expect(locked.pairs[0]!.sides[1]!.action).toBe('Locked');
    expect(locked.pairs[0]!.clear).toBe('Locked');
  });

  it('every side is a bonus plus a cost, and ids stay stable', () => {
    expect([...DOCTRINE_PAIR_IDS]).toEqual(['fleet', 'haul', 'focus']);
    expect([...DOCTRINE_SIDE_IDS]).toEqual(['swarm', 'ace', 'freighter', 'courier', 'survey', 'brawler']);
    for (const id of DOCTRINE_SIDE_IDS) {
      expect(sideBonus(DOCTRINE_SIDES[id]).length).toBeGreaterThan(0);
      expect(sideCost(DOCTRINE_SIDES[id]).length).toBeGreaterThan(0);
      expect(DOCTRINE_PAIRS[DOCTRINE_SIDES[id].pair].sides.some((s) => s.id === id)).toBe(true);
    }
  });
});
