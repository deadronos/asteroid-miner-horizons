// Hazards: the per-system schedule of comets and solar flares. Rolls come from a
// dedicated stream so they never shift run.rng or the rock layout.

import { makeRng, range } from '../core/rng';
import { TUNING } from '../data/tuning';
import type { Hazards } from './types';

/** A fresh hazard board for system `number`: timers set past the grace period, nothing pending. */
export function newHazards(seed: number, number: number): Hazards {
  const rng = makeRng(((seed ^ 0x51ed270b) + number * 2654435761) >>> 0);
  return {
    rng,
    cometTimer: TUNING.hazardFirstDelay + range(rng, 0, 30),
    comet: null,
    flareTimer: TUNING.hazardFirstDelay + range(rng, 20, 60),
    flare: null,
    comets: 0,
    flares: 0,
  };
}
