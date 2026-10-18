// Rock trait rolling and trait-derived numbers. Pure: `rollTrait` is a
// stateless hash, so it draws nothing from an Rng and cannot shift run.rng.

import { hash01 } from '../core/rng';
import { TRAIT_IDS, type RockTrait } from '../data/traits';
import { TUNING } from '../data/tuning';

/** Seeded trait for a belt rock, or null. Pure hash: never draws from an Rng. */
export function rollTrait(seed: number, number: number, id: number): RockTrait | null {
  const h = hash01((seed ^ (number * 0x9e3779b1) ^ (id * 0x85ebca6b)) | 0);
  if (h >= TUNING.traitChance) return null;
  return TRAIT_IDS[Math.floor((h / TUNING.traitChance) * TRAIT_IDS.length)]!;
}

/** The trait's yield multiplier (1 for a plain rock). */
export function traitYield(trait: RockTrait | undefined): number {
  switch (trait) {
    case 'volatile':
      return TUNING.volatileYieldMul;
    case 'dense':
      return TUNING.denseYieldMul;
    case 'magnetic':
      return TUNING.magnetTraitYieldMul;
    default:
      return 1;
  }
}
