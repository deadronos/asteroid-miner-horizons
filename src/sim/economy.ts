// Economy queries shared by the sim (to validate commands) and the UI
// (to show prices and disabled reasons). Nothing here mutates state.

import { dist } from '../core/vec';
import { variantDef, type ComponentId, type Tier, type VariantId } from '../data/components';
import { HULLS, type HullId } from '../data/hulls';
import { PERKS, type PerkId } from '../data/perks';
import { RESOURCES, canAfford, type Cost } from '../data/resources';
import { TUNING } from '../data/tuning';
import { droneCount, fleetCap, isAlive, isFlagship, shipStats } from './ships';
import type { GameState, Run, Ship } from './types';

export const isDocked = (run: Run, ship: Ship): boolean =>
  isAlive(ship) && dist(ship.pos, run.system.station.pos) <= TUNING.dockRadius;

/** Total resources sunk into a component up to its tier (for refunds). */
export function investedCost(type: ComponentId, variant: VariantId, tier: Tier): Cost {
  const total: Cost = {};
  for (let t = 1; t <= tier; t++) {
    const c = variantDef(type, variant).cost(t as Tier);
    for (const r of RESOURCES) total[r] = (total[r] ?? 0) + (c[r] ?? 0);
  }
  return total;
}

export const halve = (c: Cost): Cost =>
  Object.fromEntries(Object.entries(c).map(([k, n]) => [k, Math.floor((n ?? 0) / 2)])) as Cost;

export function upgradeCost(ship: Ship, slot: number): Cost | null {
  const f = ship.slots[slot];
  if (!f || f.tier >= 3) return null;
  return variantDef(f.type, f.variant).cost((f.tier + 1) as Tier);
}

export function repairCost(state: GameState, ship: Ship): number {
  const st = shipStats(ship, state.profile);
  return Math.ceil(Math.max(0, st.maxHull - ship.hull) * TUNING.repairOrePerHull);
}

/** Why a ship can't be refitted right now, or null if it can. */
export function refitBlock(state: GameState, ship: Ship): string | null {
  if (!isAlive(ship)) return 'Ship is being rebuilt';
  if (!isDocked(state.run, ship)) return 'Dock at the station to refit';
  return null;
}

/** Why a hull can't be bought right now, or null if it can. */
export function hullBlock(state: GameState, hullId: HullId): string | null {
  const { run, profile } = state;
  const h = HULLS[hullId];
  if (h.role === 'flagship') {
    const fs = run.ships.find(isFlagship)!;
    if (fs.hullId === hullId) return 'Already flying this hull';
    if (!isDocked(run, fs)) return 'Flagship must be docked';
  } else if (droneCount(run) >= fleetCap(profile)) {
    return `Fleet full (${fleetCap(profile)}); research Drone Bay`;
  }
  if (!canAfford(run.bank, h.cost)) return 'Not enough resources in the station bank';
  return null;
}

/** Bank fuel needed to warp; rises with each warp, cut by the warp perk. */
export function warpCost(state: GameState): number {
  const { profile } = state;
  return Math.round(TUNING.warpBaseFuel * TUNING.warpCostGrowth ** profile.warps * (1 - 0.08 * profile.perks.warp));
}

export function dataGain(state: GameState): number {
  return Math.floor(Math.sqrt(state.run.runValue / TUNING.dataDivisor));
}

export function perkCost(state: GameState, perk: PerkId): number | null {
  const lvl = state.profile.perks[perk];
  return lvl >= PERKS[perk].max ? null : PERKS[perk].cost(lvl);
}
