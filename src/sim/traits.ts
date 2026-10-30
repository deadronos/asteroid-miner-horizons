// Rock trait rolling, trait-derived numbers and the magnetic pull. Pure:
// `rollTrait` is a stateless hash, so it draws nothing from an Rng and cannot
// shift run.rng.

import { hash01 } from '../core/rng';
import { len, hypot2 } from '../core/vec';
import { TRAIT_IDS, type RockTrait } from '../data/traits';
import { TUNING } from '../data/tuning';
import { isAlive, type ShipStats } from './ships';
import type { Rock, Run } from './types';

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

/** False only for a dense rock the ship's best laser tier cannot cut. */
export function canMine(stats: ShipStats, rock: Rock): boolean {
  return !(rock.trait === 'dense' && stats.laserTier < TUNING.denseMinLaserTier);
}

/** Radius of a volatile rock's break blast: its own radius plus the pad. */
export function volatileBlastRadius(rock: Rock): number {
  return rock.radius + TUNING.volatileBlastPad;
}

/** Distance a ship must keep from a volatile rock to be clear of its blast. */
export function volatileSafeDistance(rock: Rock): number {
  return volatileBlastRadius(rock) + 16;
}

/**
 * Magnetic trait: accelerates `rock` toward the nearest live ship within
 * `magnetTraitRange`, capped at `magnetTraitMaxSpeed`. Allocation-free.
 */
export function magnetPull(run: Run, rock: Rock, dt: number): void {
  let bestD = -1; // -1 marks "no ship in range"
  let bestDx = 0;
  let bestDz = 0;
  for (let i = 0; i < run.ships.length; i++) {
    const s = run.ships[i]!;
    if (!isAlive(s)) continue;
    const dx = s.pos.x - rock.pos.x;
    const dz = s.pos.z - rock.pos.z;
    const sd = hypot2(dx, dz);
    if (sd < TUNING.magnetTraitRange && (bestD < 0 || sd < bestD)) {
      bestD = sd;
      bestDx = dx;
      bestDz = dz;
    }
  }
  // Guard the divide: a rock sitting exactly on its ship must stay finite.
  if (bestD <= 1e-6) return;
  rock.vel.x += (bestDx / bestD) * TUNING.magnetTraitAccel * dt;
  rock.vel.z += (bestDz / bestD) * TUNING.magnetTraitAccel * dt;
  const speed = len(rock.vel);
  if (speed > TUNING.magnetTraitMaxSpeed) {
    const k = TUNING.magnetTraitMaxSpeed / speed;
    rock.vel.x *= k;
    rock.vel.z *= k;
  }
}
