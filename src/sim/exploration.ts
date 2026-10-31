// Exploration: deterministic per-system anomaly placement. The list itself is
// not saved; it is rolled from exploration.seed, which is mixed from the profile
// seed, system number and warp route without touching run.rng.

import { int, makeRng, next, range, type Rng } from '../core/rng';
import { dist, fromAngle, type Vec2 } from '../core/vec';
import { DERELICT_SALVAGE } from '../data/exploration';
import type { RawResource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Anomaly, Belt, Exploration, StarSystem } from './types';

/**
 * Seed for a system's anomaly stream. Route 0 keeps the raw seed, matching
 * `generateSystem`, so a save that never chose a route still replays its system.
 */
export function explorationSeed(seed: number, number: number, route = 0): number {
  const routed = route === 0 ? seed : (seed ^ Math.imul(route, 0x632be5ab)) >>> 0;
  return (routed ^ Math.imul(number, 0x27d4eb2d)) >>> 0;
}

/** A fresh exploration state for system `number`: nothing revealed or claimed yet. */
export function newExploration(seed: number, number: number, route = 0): Exploration {
  return { seed: explorationSeed(seed, number, route), pingCd: 0, revealed: [], claimed: [] };
}

/** Picks a raw resource by a belt's mix weights. */
function rollKind(rng: Rng, mix: Belt['mix']): RawResource {
  const total = mix.ore + mix.ice + mix.crystal;
  let x = next(rng) * total;
  if ((x -= mix.ore) < 0) return 'ore';
  if ((x -= mix.ice) < 0) return 'ice';
  return 'crystal';
}

/** A point inside one of the system's belts, clear of the station's dock lane. */
function placeInBelt(rng: Rng, system: StarSystem): { pos: Vec2; mix: Belt['mix'] } {
  const clearance = TUNING.dockRadius * 2;
  let belt = system.belts[0]!;
  let pos = fromAngle(0, belt.inner);
  for (let tries = 0; tries < 16; tries++) {
    belt = system.belts[int(rng, 0, system.belts.length - 1)]!;
    pos = fromAngle(range(rng, 0, Math.PI * 2), range(rng, belt.inner, belt.outer));
    if (dist(pos, system.station.pos) >= clearance) break;
  }
  return { pos, mix: belt.mix };
}

/**
 * Rolls a system's hidden anomalies from `seed`. Pure and deterministic: the
 * same seed and system always produce the same ids, kinds and positions.
 */
export function rollAnomalies(seed: number, system: StarSystem): Anomaly[] {
  const rng = makeRng(seed);
  const anomalies: Anomaly[] = [];
  const rich = int(rng, TUNING.richAnomalies[0], TUNING.richAnomalies[1]);
  const derelicts = int(rng, TUNING.derelictAnomalies[0], TUNING.derelictAnomalies[1]);
  for (let i = 0; i < rich; i++) {
    const { pos, mix } = placeInBelt(rng, system);
    anomalies.push({ id: anomalies.length, kind: 'rich', pos, resource: rollKind(rng, mix) });
  }
  for (let i = 0; i < derelicts; i++) {
    const { pos } = placeInBelt(rng, system);
    anomalies.push({ id: anomalies.length, kind: 'derelict', pos, salvage: int(rng, 0, DERELICT_SALVAGE.length - 1) });
  }
  return anomalies;
}
