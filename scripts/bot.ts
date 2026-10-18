// Scripted player for headless runs (bench, balance). It plays the flagship
// purely through sim Commands, like the UI would; drones keep their own AI.
//
// Each call looks at the state and returns the commands for the next tick:
//   buy affordable perks → warp once the bank has the fuel → accept a
//   serviceable contract → dock when the hold is full → while docked,
//   repair / buy one thing → chase nearby debris → mine the nearest rock of
//   whichever resource the bank (or the active delivery contract) needs. A fuel
//   refine rides alongside the flagship's order rather than replacing it, so
//   refining never costs the pilot a decision cycle; a refine cycle skips
//   purchases so a price is not checked against ice the refine is about to spend.
//
// Ice reserve: any ice-priced purchase must leave at least ICE_RESERVE × warp
// cost worth of ice (counting fuel as its ice equivalent), otherwise
// ice-priced upgrades would starve the warp forever. An upgrade blocked only by
// alloy is smelted from ore.

import { dist, distSq } from '../src/core/vec';
import { COMPONENTS, type ComponentId } from '../src/data/components';
import { CONTRACTS } from '../src/data/contracts';
import { HULLS } from '../src/data/hulls';
import type { PerkId } from '../src/data/perks';
import { RECIPES } from '../src/data/refining';
import { canAfford, type Cost } from '../src/data/resources';
import type { Command } from '../src/sim/commands';
import { hullBlock, isDocked, perkCost, refitBlock, repairCost, upgradeCost, warpCost } from '../src/sim/economy';
import { queuedOutput, refineBlock } from '../src/sim/refining';
import { cargoFree, flagship, isAlive, shipStats, type ShipStats } from '../src/sim/ships';
import type { GameState, Rock, Ship } from '../src/sim/types';

export const ICE_RESERVE = 0.5;
/** Ice the fuel recipe eats per unit of fuel produced. */
const ICE_PER_FUEL = (RECIPES.fuel.input.ice ?? 0) / RECIPES.fuel.output;
/** Ore the alloy recipe eats per unit of alloy produced. */
const ORE_PER_ALLOY = (RECIPES.alloy.input.ore ?? 0) / RECIPES.alloy.output;
/** Fill order for empty slots. */
const INSTALL_ORDER: ComponentId[] = ['cargo', 'sensor', 'engine', 'armor', 'laser', 'shield'];
/** Upgrade order for fitted components. */
const UPGRADE_ORDER: ComponentId[] = ['laser', 'cargo', 'sensor', 'engine', 'armor', 'shield'];
const PERK_ORDER: PerkId[] = ['yield', 'optics', 'bay', 'kit', 'thrust', 'warp'];
const PICKUP_CHASE = 260;

export interface BotOptions {
  /** Allow the bot to warp (the bench turns this off to stay in one system). */
  warp?: boolean;
}

/** Hold counts as full below this much free space (matches the drone AI). */
const isFull = (cap: number, free: number): boolean => free < Math.max(2, cap * 0.04);

export function botCommands(state: GameState, opts: BotOptions = {}): Command[] {
  const { run, profile } = state;
  const fs = flagship(run);

  const perk = nextPerk(state);
  if (perk) return [{ t: 'buyPerk', perk }];

  const wc = warpCost(state);
  if (opts.warp !== false && run.bank.fuel >= wc) return [{ t: 'warp' }];

  if (!isAlive(fs)) return [];

  // The refinery is station-side, so its command rides alongside the flagship's
  // order instead of consuming this decision cycle.
  const fuel = refineFuel(state, wc);

  const contract = nextContract(state);
  if (contract) return fuel ? [fuel, contract] : [contract];

  const st = shipStats(fs, profile);
  if (isDocked(run, fs)) {
    // A refine cycle skips purchases: the refine is about to spend the ice a
    // price would have been checked against.
    const buy = fuel ? null : nextPurchase(state, wc);
    if (buy) return [buy];
  }

  const order = flagshipOrder(state, fs, st, wc);
  return fuel ? [fuel, ...order] : order;
}

/** The flagship's non-purchase order this cycle: dock, chase debris, or mine. */
function flagshipOrder(state: GameState, fs: Ship, st: ShipStats, wc: number): Command[] {
  const { run } = state;
  const free = cargoFree(fs, st);
  if (isFull(st.cargoCap, free)) return fs.order?.kind === 'dock' ? [] : [{ t: 'dock', shipId: fs.id }];
  if (fs.order?.kind === 'dock' || fs.order?.kind === 'mine') return [];

  let pickup: { x: number; z: number } | null = null;
  let best = PICKUP_CHASE * PICKUP_CHASE;
  for (const p of run.pickups) {
    const d = distSq(fs.pos, p.pos);
    if (d < best) {
      best = d;
      pickup = p.pos;
    }
  }
  if (pickup && best > st.magnet * st.magnet * 0.3) return [{ t: 'move', shipId: fs.id, to: pickup }];

  const rock = pickRock(state, fs, wc);
  return rock ? [{ t: 'mine', shipId: fs.id, rockId: rock.id }] : [];
}

function nextPerk(state: GameState): PerkId | null {
  let pick: PerkId | null = null;
  let pickCost = Infinity;
  for (const p of PERK_ORDER) {
    const c = perkCost(state, p);
    if (c != null && c <= state.profile.data && c < pickCost) {
      pick = p;
      pickCost = c;
    }
  }
  return pick;
}

/** Ice worth of fuel the bank must keep back for the next warp. */
const iceReserve = (wc: number): number => ICE_RESERVE * ICE_PER_FUEL * wc;

/**
 * Queues enough fuel for the next warp, keeping ICE_RESERVE of the warp's ice
 * worth back. Issues nothing when the warp is already covered or the queue and
 * bank can't take a batch.
 */
function refineFuel(state: GameState, wc: number): Command | null {
  const { run } = state;
  const fuelHave = run.bank.fuel + queuedOutput(run, 'fuel');
  if (fuelHave >= wc) return null;
  let want = wc - fuelHave;
  if (run.bank.ice < ICE_PER_FUEL * want) {
    // Short of a full warp's ice: bank fuel up to the reserve instead.
    want = Math.min(wc * ICE_RESERVE - fuelHave, Math.floor(run.bank.ice / ICE_PER_FUEL));
  }
  if (want < 1) return null;
  const block = refineBlock(run, 'fuel', want);
  return 'n' in block ? { t: 'refine', recipe: 'fuel', count: block.n } : null;
}

/** First offered contract this system can serve (crystal only where crystal rocks exist). */
function nextContract(state: GameState): Command | null {
  const { run } = state;
  if (run.contracts.active) return null;
  const hasCrystal = run.rocks.some((r) => r.kind === 'crystal');
  const offer = run.contracts.offers.find((o) => o.kind !== 'deliverCrystal' || hasCrystal);
  return offer ? { t: 'acceptContract', contractId: offer.id } : null;
}

/** Repair, then one purchase per call: drone, empty-slot installs, upgrades, bigger flagship. */
function nextPurchase(state: GameState, wc: number): Command | null {
  const { run, profile } = state;
  const fs = flagship(run);
  const iceEq = run.bank.ice + ICE_PER_FUEL * (run.bank.fuel + queuedOutput(run, 'fuel'));
  const reserve = iceReserve(wc);
  const ok = (c: Cost): boolean => canAfford(run.bank, c) && (!c.ice || iceEq - c.ice >= reserve);
  const alloyHave = run.bank.alloy + queuedOutput(run, 'alloy');
  /** A price the bot can't pay yet only because alloy is short. */
  const needsAlloy = (c: Cost): boolean => (c.alloy ?? 0) > alloyHave && ok({ ...c, alloy: 0 });
  /** Smelts `c`'s alloy shortfall when the ore is there on top of the price. */
  const smeltFor = (c: Cost): Command | null => {
    const short = (c.alloy ?? 0) - alloyHave;
    if (short <= 0 || run.bank.ore - (c.ore ?? 0) < short * ORE_PER_ALLOY) return null;
    const block = refineBlock(run, 'alloy', short);
    return 'n' in block ? { t: 'refine', recipe: 'alloy', count: block.n } : null;
  };

  const rc = repairCost(state, fs);
  if (rc > 0 && fs.hull < shipStats(fs, profile).maxHull * 0.7 && run.bank.ore >= rc)
    return { t: 'repair', shipId: fs.id };

  if (!hullBlock(state, 'drone') && ok(HULLS.drone.cost)) return { t: 'buyHull', hullId: 'drone' };

  const docked = run.ships.filter((s) => !refitBlock(state, s));
  for (const comp of INSTALL_ORDER) {
    for (const s of docked) {
      const i = s.slots.indexOf(null);
      if (i >= 0 && ok(COMPONENTS[comp].cost(1)) && !s.slots.some((f) => f?.type === comp && comp !== 'laser'))
        return { t: 'install', shipId: s.id, slot: i, comp };
    }
  }
  for (const comp of UPGRADE_ORDER) {
    for (const s of docked) {
      const i = s.slots.findIndex((f) => f?.type === comp);
      const cost = i >= 0 ? upgradeCost(s, i) : null;
      if (!cost) continue;
      if (ok(cost)) return { t: 'upgrade', shipId: s.id, slot: i };
      if (needsAlloy(cost)) {
        const refine = smeltFor(cost);
        if (refine) return refine;
      }
    }
  }
  if (!hullBlock(state, 'excavator')) {
    if (ok(HULLS.excavator.cost)) return { t: 'buyHull', hullId: 'excavator' };
    if (needsAlloy(HULLS.excavator.cost)) {
      const refine = smeltFor(HULLS.excavator.cost);
      if (refine) return refine;
    }
  }
  return null;
}

/**
 * Nearest rock, with the resource the bank is shorter on counting as half the
 * distance. An active delivery contract overrides that want with its resource;
 * an active breakLarge scores large (size-0) rocks at half distance.
 */
function pickRock(state: GameState, fs: Ship, wc: number): Rock | null {
  const { bank } = state.run;
  const active = state.run.contracts.active;
  const iceEq = bank.ice + ICE_PER_FUEL * (bank.fuel + queuedOutput(state.run, 'fuel'));
  const want =
    (active && CONTRACTS[active.kind].resource) ?? (iceEq / (ICE_PER_FUEL * wc) < bank.ore / 300 ? 'ice' : 'ore');
  const breakLarge = active?.kind === 'breakLarge';
  // A delivery contract owns the want: crystal stops being a free bonus while it runs.
  const bonusCrystal = !active || breakLarge;
  let best: Rock | null = null;
  let bestScore = Infinity;
  for (const r of state.run.rocks) {
    let score = dist(fs.pos, r.pos) * (r.kind === want || (bonusCrystal && r.kind === 'crystal') ? 0.5 : 1);
    if (breakLarge && r.size === 0) score *= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
