// Per-ship autorepair and autoupgrade (#140). A flagged drone or hauler flies
// home when its hull drops below the player's threshold, and while docked it
// repairs, then spends the bank above the player's reserve on its cheapest
// next step: fill an empty slot from its role's build order, raise a tier, or
// buy a slot. It never removes or replaces a fitted part.

import { defaultVariant, variantDef, type ComponentId } from '../data/components';
import { HULLS } from '../data/hulls';
import { formatCost, type Cost, walletValue, type Wallet } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { FleetAuto } from './assists';
import { repairCost, slotCost, upgradeCost } from './economy';
import type { SimIndex } from './index';
import type { ShipStats } from './ships';
import type { GameState, Ship } from './types';

/** What an empty slot gets, in order; a type already fitted counts toward its place in the list. */
export const BUILD_ORDER: Record<'drone' | 'hauler', readonly ComponentId[]> = {
  drone: ['laser', 'cargo', 'engine', 'armor', 'shield', 'sensor'],
  hauler: ['cargo', 'engine', 'armor', 'shield', 'sensor', 'cargo'],
};

/** True when a ship with autorepair on should stop work and fly home to repair. */
export const needsRepair = (ship: Ship, st: ShipStats, auto: FleetAuto): boolean =>
  ship.autoRepair && ship.hull < st.maxHull * auto.repairAt;

/** True when `bank` covers `cost` while keeping `reserve` units of every resource. */
export function affordAbove(bank: Wallet, cost: Cost, reserve: number): boolean {
  for (const r in cost) {
    const k = r as keyof Wallet;
    if (bank[k] + 1e-9 < (cost[k] ?? 0) + reserve) return false;
  }
  return true;
}

function payFrom(bank: Wallet, cost: Cost): void {
  for (const r in cost) bank[r as keyof Wallet] -= cost[r as keyof Wallet] ?? 0;
}

/** The component type the ship's next empty slot should get, from its role's build order. */
export function nextBuildType(ship: Ship): ComponentId {
  const order = BUILD_ORDER[HULLS[ship.hullId].role === 'hauler' ? 'hauler' : 'drone'];
  const fitted = new Map<ComponentId, number>();
  for (const f of ship.slots) if (f) fitted.set(f.type, (fitted.get(f.type) ?? 0) + 1);
  for (const t of order) {
    const n = fitted.get(t) ?? 0;
    if (n > 0) fitted.set(t, n - 1);
    else return t;
  }
  return order[0]!;
}

type Step = { kind: 'install'; slot: number; type: ComponentId } | { kind: 'upgrade'; slot: number } | { kind: 'slot' };

/** The cheapest affordable upgrade step for `ship`, with its cost, or null if none fits the budget. */
export function cheapestStep(ship: Ship, bank: Wallet, reserve: number): { step: Step; cost: Cost } | null {
  let best: { step: Step; cost: Cost } | null = null;
  let bestValue = Infinity;
  const consider = (step: Step, cost: Cost | null): void => {
    if (!cost || !affordAbove(bank, cost, reserve)) return;
    const value = walletValue(cost);
    if (value < bestValue) {
      best = { step, cost };
      bestValue = value;
    }
  };
  let empty = -1;
  ship.slots.forEach((f, i) => {
    if (f) consider({ kind: 'upgrade', slot: i }, upgradeCost(ship, i));
    else if (empty < 0) empty = i;
  });
  if (empty >= 0) {
    const type = nextBuildType(ship);
    consider({ kind: 'install', slot: empty, type }, variantDef(type, defaultVariant(type)).cost(1));
  } else consider({ kind: 'slot' }, slotCost(ship));
  return best;
}

/**
 * A docked drone or hauler's upkeep, once per tick: autorepair first (waiting docked while the bank can't cover it
 * above the reserve), then at most one autoupgrade step per `autoUpgradeInterval`. Toggles off means no work and
 * no allocation.
 */
export function serviceDocked(state: GameState, index: SimIndex, ship: Ship, st: ShipStats, auto: FleetAuto): void {
  const { run, out } = state;
  if (!needsRepair(ship, st, auto)) index.repairWait.delete(ship.id);
  if (ship.autoRepair && ship.hull < st.maxHull) {
    const ore = repairCost(state, ship);
    if (affordAbove(run.bank, { ore }, auto.reserve)) {
      run.bank.ore -= ore;
      ship.hull = st.maxHull;
      out.log.push({ level: 'info', text: `${ship.name} auto-repaired for ${ore}⬢.` });
    } else if (needsRepair(ship, st, auto)) {
      if (!index.repairWait.has(ship.id)) {
        index.repairWait.add(ship.id);
        out.log.push({
          level: 'warn',
          text: `${ship.name} is waiting docked for ${ore}⬢ above the reserve to repair.`,
        });
      }
      return; // Repair first: don't spend on upgrades while the ship can't fly.
    }
  }
  if (!ship.autoUpgrade) return;
  // A ready time beyond one interval ahead was set in an earlier run (warps restart run.time): ignore it.
  const ready = index.upgradeReadyAt.get(ship.id) ?? 0;
  if (run.time < ready && ready - run.time <= TUNING.autoUpgradeInterval) return;
  const pick = cheapestStep(ship, run.bank, auto.reserve);
  if (!pick) return;
  index.upgradeReadyAt.set(ship.id, run.time + TUNING.autoUpgradeInterval);
  const { step, cost } = pick;
  payFrom(run.bank, cost);
  if (step.kind === 'slot') {
    ship.slots.push(null);
    out.log.push({ level: 'info', text: `${ship.name} bought slot ${ship.slots.length} (${formatCost(cost)}).` });
  } else if (step.kind === 'install') {
    ship.slots[step.slot] = { type: step.type, variant: defaultVariant(step.type), tier: 1 };
    const name = variantDef(step.type, defaultVariant(step.type)).name;
    out.log.push({ level: 'info', text: `${ship.name} installed ${name} (${formatCost(cost)}).` });
  } else {
    const f = ship.slots[step.slot]!;
    f.tier = (f.tier + 1) as 2 | 3;
    const name = variantDef(f.type, f.variant).name;
    out.log.push({ level: 'info', text: `${ship.name}: ${name} → T${f.tier} (${formatCost(cost)}).` });
  }
}
