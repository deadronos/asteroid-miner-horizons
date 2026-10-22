// Warp routes (#172): the candidate systems a warp can reach and the numbers
// the route picker and the bot compare them by. Pure; each candidate is a
// function of (seed, next system number, route), so nothing here is persisted.

import { FLARES } from '../data/hazards';
import { TUNING } from '../data/tuning';
import { generateSystem } from './generate';
import type { Profile, StarClass, StarSystem } from './types';

export type HazardRating = 'low' | 'moderate' | 'high';

/** Flare damage per second above which a star counts as high hazard. */
const HIGH_FLARE_DPS = 15;

/** The candidate systems for the next warp; the index is the route. */
export function warpRoutes(profile: Profile): StarSystem[] {
  const number = profile.warps + 2;
  return Array.from({ length: TUNING.warpRoutes }, (_, route) => generateSystem(profile.seed, number, route));
}

/** True for a route the `warp` command accepts: an integer in [0, TUNING.warpRoutes). */
export const isRoute = (route: unknown): route is number =>
  Number.isInteger(route) && (route as number) >= 0 && (route as number) < TUNING.warpRoutes;

/** Hazard level of a star class and what it means, built from the flare table so it cannot go stale. */
export function hazardRating(starClass: StarClass): { level: HazardRating; text: string } {
  const flare = FLARES[starClass];
  if (!flare) return { level: 'low', text: 'Comets only' };
  if (flare.dps > HIGH_FLARE_DPS) return { level: 'high', text: `Comets and strong solar flares (${flare.dps} dps)` };
  return { level: 'moderate', text: `Comets and solar flares (${flare.dps} dps)` };
}

const HAZARD_ORDER: Record<HazardRating, number> = { low: 0, moderate: 1, high: 2 };

/** Orders a system's hazard level low → high. */
const hazardRank = (system: StarSystem): number => HAZARD_ORDER[hazardRating(system.starClass).level];

/** Rocks across every belt when the system opens (modifiers already applied). */
export const routeRocks = (system: StarSystem): number => system.belts.reduce((n, b) => n + b.initialCount, 0);

/** Rough yield of a route: opening rocks × richness. */
export const routeValue = (system: StarSystem): number => routeRocks(system) * system.richness;

/** The route with the highest `routeValue`, then the lower hazard, then the lower index. */
export function richestRoute(systems: readonly StarSystem[]): number {
  let best = 0;
  for (let i = 1; i < systems.length; i++) {
    const a = systems[i]!;
    const b = systems[best]!;
    const dv = routeValue(a) - routeValue(b);
    const dh = hazardRank(a) - hazardRank(b);
    if (dv > 0 || (dv === 0 && dh < 0)) best = i;
  }
  return best;
}
