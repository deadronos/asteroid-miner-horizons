// New game / new run construction. A Profile persists across warps; a Run
// is one star system's worth of progress and is rebuilt on every warp.

import { makeRng } from '../core/rng';
import { v } from '../core/vec';
import { PERK_IDS, type PerkId } from '../data/perks';
import { TUNING } from '../data/tuning';
import { fillBoard, newBoard } from './contracts';
import { generateSystem, populateBelts } from './generate';
import { makeShip } from './ships';
import type { GameState, Profile, Run } from './types';

export const SAVE_VERSION = 2;

export function newProfile(seed: number): Profile {
  return {
    seed: seed >>> 0,
    warps: 0,
    data: 0,
    dataEarned: 0,
    perks: Object.fromEntries(PERK_IDS.map((p) => [p, 0])) as Record<PerkId, number>,
  };
}

export function newRun(profile: Profile): Run {
  const number = profile.warps + 1;
  const system = generateSystem(profile.seed, number);
  const kit = profile.perks.kit;
  const run: Run = {
    system,
    rng: makeRng(profile.seed + number * 7919),
    nextId: 1,
    time: 0,
    bank: {
      ore: TUNING.startWallet.ore + kit * 80,
      ice: TUNING.startWallet.ice + kit * 25,
      crystal: 0,
    },
    runValue: 0,
    ships: [],
    rocks: [],
    pickups: [],
    selectedId: 0,
    regrowTimer: 0,
    contracts: newBoard(profile.seed, number),
  };
  populateBelts(run);

  const st = system.station.pos;
  const out = v(st.x * 0.92, st.z * 0.92); // just inside the station, toward the star
  const ship = makeShip(run, profile, 'prospector', 'Horizon', out);
  run.ships.push(ship);
  run.selectedId = ship.id;
  if (kit >= 3) run.ships.push(makeShip(run, profile, 'drone', 'Drone-1', v(out.x + 40, out.z + 30)));
  fillBoard(run.contracts, number);
  return run;
}

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const profile = newProfile(seed);
  const state: GameState = { version: SAVE_VERSION, profile, run: newRun(profile), out: { fx: [], log: [] } };
  state.out.log.push({
    level: 'major',
    text: `Welcome to ${state.run.system.name}. Click a rock to mine it, fly over debris to collect it, then dock at the station (click it) to unload.`,
  });
  return state;
}
