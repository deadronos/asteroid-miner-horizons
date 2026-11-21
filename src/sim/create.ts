// New game / new run construction. A Profile persists across warps; a Run
// is one star system's worth of progress and is rebuilt on every warp.

import { makeRng } from '../core/rng';
import { v } from '../core/vec';
import { emptyDoctrines } from '../data/doctrines';
import { NG_PLUS_HAZARD_STEP, NG_PLUS_RICHNESS_STEP, freshGate } from '../data/gate';
import { PERK_IDS, type PerkId } from '../data/perks';
import { TUNING } from '../data/tuning';
import { newStats } from './achievements';
import { newAutomation } from './automation';
import { describeContract, fillBoard, newBoard } from './contracts';
import { dataGain, doctrineRespecNotice, warpCost } from './economy';
import { newExploration } from './exploration';
import { newHazards } from './hazards';
import { generateSystem, populateBelts } from './generate';
import { describeModifiers } from './modifiers';
import { jobLabel, newRefinery } from './refining';
import { isRoute } from './routes';
import { makeShip } from './ships';
import type { GameState, Profile, Run } from './types';

export const SAVE_VERSION = 18;

export function newProfile(seed: number): Profile {
  return {
    seed: seed >>> 0,
    warps: 0,
    data: 0,
    dataEarned: 0,
    perks: Object.fromEntries(PERK_IDS.map((p) => [p, 0])) as Record<PerkId, number>,
    doctrines: emptyDoctrines(),
    stats: newStats(),
    achievements: [],
    goalsDismissed: false,
    gate: freshGate(),
    ngPlus: 0,
  };
}

/** A fresh run in system `profile.warps + 1`, reached by warp route `route` (0 for a new game). */
export function newRun(profile: Profile, route = 0): Run {
  const number = profile.warps + 1;
  const system = generateSystem(profile.seed, number, route);
  if (profile.ngPlus > 0) {
    system.richness *= 1 + NG_PLUS_RICHNESS_STEP * profile.ngPlus;
  }
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
      alloy: 0,
      fuel: 0,
    },
    runValue: 0,
    ships: [],
    rocks: [],
    pickups: [],
    selectedId: 0,
    regrowTimer: 0,
    contracts: newBoard(profile.seed, number),
    refinery: newRefinery(),
    hazards: newHazards(profile.seed, number),
    automation: newAutomation(),
    exploration: newExploration(profile.seed, number, route),
  };
  if (profile.ngPlus > 0) {
    const hazardScale = 1 / (1 + NG_PLUS_HAZARD_STEP * profile.ngPlus);
    run.hazards.cometTimer *= hazardScale;
    run.hazards.flareTimer *= hazardScale;
  }
  populateBelts(run, profile.seed);

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
  const state: GameState = {
    version: SAVE_VERSION,
    profile,
    run: newRun(profile),
    out: { fx: [], log: [], status: new Map() },
  };
  state.out.log.push({
    level: 'major',
    text: `Welcome to ${state.run.system.name}. Click a rock to mine it, fly over debris to collect it, then dock at the station (click it) to unload.`,
  });
  state.out.log.push({ level: 'info', text: doctrineRespecNotice() });
  return state;
}

/** Validates warp route and fuel, awards Horizon Data, and rebuilds `state.run` in the next star system. */
export function applyWarp(state: GameState, route: number): void {
  const { run, profile, out } = state;
  if (!isRoute(route)) {
    out.log.push({ level: 'warn', text: 'Unknown warp route.' });
    return;
  }
  const cost = warpCost(state);
  if (run.bank.fuel < cost) {
    out.log.push({ level: 'warn', text: `Warp needs ${cost} fuel in the station bank.` });
    return;
  }
  const gain = dataGain(state);
  profile.data += gain;
  profile.dataEarned += gain;
  profile.warps += 1;
  profile.stats.warps += 1;
  const dropped = run.contracts.active;
  const left = run.refinery.queue;
  const outposts = run.automation.outposts.length;
  state.run = newRun(profile, route);
  out.fx.push({ t: 'warp' });
  out.log.push({
    level: 'major',
    text: `Warp complete: welcome to ${state.run.system.name} (system ${state.run.system.number}). +${gain} Horizon Data.`,
  });
  out.log.push({ level: 'info', text: doctrineRespecNotice() });
  const mods = state.run.system.modifiers;
  if (mods.length > 0) out.log.push({ level: 'major', text: `System modifiers: ${describeModifiers(mods)}.` });
  if (dropped) out.log.push({ level: 'warn', text: `Contract left behind: ${describeContract(dropped)}.` });
  if (left.length > 0) {
    const jobs = left.map((j) => jobLabel(j.recipe, j.count)).join(', ');
    out.log.push({ level: 'warn', text: `Refinery queue left behind: ${jobs}.` });
  }
  if (outposts > 0)
    out.log.push({
      level: 'warn',
      text: `Outposts left behind: ${outposts}. Their reserves stay in the old system.`,
    });
}
