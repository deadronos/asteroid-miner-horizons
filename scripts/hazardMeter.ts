// Hazard meter for the balance harness (#208). The sim records no damage sources, so the meter diffs each
// ship's hull and shield around every tick and attributes the loss: star heat and flare damage are recomputed
// from the same formulas the tick uses, and what is left is a collision (a comet if one overlaps the ship) or
// "other" (a volatile blast). Nothing here touches GameState, so the save shape is unchanged.

import { FLARES, HAZARD_LEVELS, type HazardLevel } from '../src/data/hazards';
import { TUNING } from '../src/data/tuning';
import { isDocked } from '../src/sim/economy';
import { flareExposure } from '../src/sim/hazards';
import { shipStats } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';

export const DAMAGE_SOURCES = ['collision', 'heat', 'flare', 'comet', 'other'] as const;
export type DamageSource = (typeof DAMAGE_SOURCES)[number];

/** What one warp's hazards cost. Damage is post-armor hull loss, summed over every ship. */
export interface HazardTally {
  /** Hull lost per source. */
  hull: Record<DamageSource, number>;
  /** Damage before armor, shields and hull took their share (the denominator for the three below). */
  raw: number;
  /** Raw damage armor turned away. */
  armor: number;
  /** Raw damage shields soaked up (post-armor, shield regeneration within the tick is netted off). */
  shield: number;
  /** Ships destroyed (flagship and drones alike). */
  shipsLost: number;
  /** Ore paid to repair hulls (repair costs ore, not credits). */
  repairOre: number;
}

export const newTally = (): HazardTally => ({
  hull: { collision: 0, heat: 0, flare: 0, comet: 0, other: 0 },
  raw: 0,
  armor: 0,
  shield: 0,
  shipsLost: 0,
  repairOre: 0,
});

/** Total hull damage across sources. */
export const hullTotal = (t: HazardTally): number => DAMAGE_SOURCES.reduce((n, s) => n + t.hull[s], 0);

interface Snap {
  hull: number;
  shield: number;
  maxHull: number;
  dmgMul: number;
  collisionCd: number;
}

export interface HazardMeter {
  tally: HazardTally;
  /** Call right before each tick. */
  before(state: GameState): void;
  /** Call right after each tick; a tick that warped (a fresh run) is skipped. */
  after(state: GameState): void;
}

/** A meter for one warp of `state`, played at hazard `level`. */
export function createHazardMeter(state: GameState, level: HazardLevel): HazardMeter {
  const tally = newTally();
  const snaps = new Map<number, Snap>();
  const dt = 1 / TUNING.simHz;
  const lostBase = state.profile.stats.shipsLost;
  let warps = state.profile.warps;

  return {
    tally,
    before(s) {
      snaps.clear();
      warps = s.profile.warps;
      for (const sh of s.run.ships) {
        const st = shipStats(sh, s.profile);
        snaps.set(sh.id, {
          hull: sh.hull,
          shield: sh.shield,
          maxHull: st.maxHull,
          dmgMul: st.dmgMul,
          collisionCd: sh.collisionCd,
        });
      }
    },
    after(s) {
      if (s.profile.warps !== warps) return;
      tally.shipsLost = s.profile.stats.shipsLost - lostBase;
      const { run, profile } = s;
      const sys = run.system;
      const flare = FLARES[sys.starClass];
      for (const [id, prev] of snaps) {
        if (prev.hull <= 0) continue; // waiting to be rebuilt
        const ship = run.ships.find((x) => x.id === id);
        const st = ship ? shipStats(ship, profile) : null;
        const dead = !ship || ship.hull <= 0;
        let hullLoss: number;
        let shieldLoss: number;
        if (dead) {
          hullLoss = prev.hull;
          shieldLoss = prev.shield;
        } else {
          hullLoss = Math.max(0, prev.hull - ship.hull);
          const regen = Math.min(st!.maxShield, prev.shield + st!.shieldRegen * dt);
          shieldLoss = Math.max(0, regen - ship.shield);
          if (ship.hull > prev.hull && ship.hull === st!.maxHull && st!.maxHull === prev.maxHull && isDocked(run, ship))
            tally.repairOre += Math.ceil((st!.maxHull - prev.hull) * TUNING.repairOrePerHull);
        }
        const taken = hullLoss + shieldLoss;
        if (taken <= 0) continue;
        const mul = st?.dmgMul ?? prev.dmgMul;
        const raw = mul > 0 ? taken / mul : taken;
        tally.raw += raw;
        tally.armor += raw - taken;
        tally.shield += shieldLoss;

        // Split the hull loss by source. Heat and flare are recomputed; the rest is a hit or a blast.
        const pos = ship?.pos;
        let left = hullLoss;
        if (pos && Math.hypot(pos.x, pos.z) < sys.heatRadius) {
          const d = Math.hypot(pos.x, pos.z);
          const k = 1 - (d - sys.starRadius) / (sys.heatRadius - sys.starRadius);
          const heat = Math.min(left, TUNING.starHeatDps * Math.max(0.2, k) * dt * mul);
          tally.hull.heat += heat;
          left -= heat;
        }
        if (ship && flare) {
          const k = flareExposure(run, ship);
          const fl = Math.min(left, flare.dps * HAZARD_LEVELS[level].damage * k * dt * mul);
          tally.hull.flare += fl;
          left -= fl;
        }
        if (left > 0) {
          let src: DamageSource = 'other';
          if (ship && ship.collisionCd > prev.collisionCd) {
            src = 'collision';
            for (const r of run.rocks)
              if (r.comet && Math.hypot(ship.pos.x - r.pos.x, ship.pos.z - r.pos.z) < r.radius + st!.size + 5) {
                src = 'comet';
                break;
              }
          }
          tally.hull[src] += left;
        }
      }
    },
  };
}
