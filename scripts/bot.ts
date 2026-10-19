// Scripted player for headless runs (bench, balance). It plays the flagship
// purely through sim Commands, like the UI would; drones keep their own AI.
//
// Each call looks at the state and returns the commands for the next tick:
//   buy affordable perks → warp once the bank has the fuel → accept a
//   serviceable contract → dock when the hold is full → while docked,
//   repair / buy one thing → deploy an outpost on a large rock alongside (once
//   a hauler can service it) → chase nearby debris → mine the nearest rock of
//   whichever resource the bank (or the active delivery contract) needs.
//   Hazard reflexes come first in the flagship's order: step out of a comet
//   path, and dock (staying docked) or flee past the reach of a pending or
//   burning flare; targets in either are skipped. A fuel refine rides
//   alongside the flagship's order rather than replacing it, so refining never
//   costs the pilot a decision cycle; while docked the purchase is priced
//   against the bank the refine leaves behind, so a price is not checked
//   against ice the refine is about to spend and the ship still buys before it
//   undocks.
//
// Ice reserve: any ice-priced purchase must leave at least ICE_RESERVE × warp
// cost worth of ice (counting fuel as its ice equivalent), otherwise
// ice-priced upgrades would starve the warp forever. An upgrade blocked only by
// alloy is smelted from ore.

import { dist, distSq, type Vec2 } from '../src/core/vec';
import { variantDef, type ComponentId, type VariantId } from '../src/data/components';
import { CONTRACTS } from '../src/data/contracts';
import { HULLS } from '../src/data/hulls';
import type { PerkId } from '../src/data/perks';
import { RECIPES } from '../src/data/refining';
import { canAfford, pay, type Cost } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import type { Command } from '../src/sim/commands';
import { hullBlock, isDocked, perkCost, refitBlock, repairCost, upgradeCost, warpCost } from '../src/sim/economy';
import { isHauler, outpostAt, outpostBlock } from '../src/sim/automation';
import { cometPathEscape, flareShelter, inFlareZone } from '../src/sim/hazards';
import { batchCost, queuedOutput, refineBlock } from '../src/sim/refining';
import { cargoFree, flagship, isAlive, isFlagship, shipStats, type ShipStats } from '../src/sim/ships';
import { canMine } from '../src/sim/traits';
import type { GameState, Rock, Run, Ship } from '../src/sim/types';

export const ICE_RESERVE = 0.5;
/** Ice the fuel recipe eats per unit of fuel produced. */
const ICE_PER_FUEL = (RECIPES.fuel.input.ice ?? 0) / RECIPES.fuel.output;
/** Ore the alloy recipe eats per unit of alloy produced. */
const ORE_PER_ALLOY = (RECIPES.alloy.input.ore ?? 0) / RECIPES.alloy.output;
/** Fill order for empty slots, with the variant each install fits. */
const INSTALL_ORDER: { comp: ComponentId; variant: VariantId }[] = [
  { comp: 'cargo', variant: 'standard' },
  { comp: 'sensor', variant: 'standard' },
  { comp: 'engine', variant: 'ion' },
  { comp: 'armor', variant: 'standard' },
  { comp: 'laser', variant: 'focused' },
  { comp: 'shield', variant: 'standard' },
];
/** Upgrade order for fitted components. */
const UPGRADE_ORDER: ComponentId[] = ['laser', 'cargo', 'sensor', 'engine', 'armor', 'shield'];
const PERK_ORDER: PerkId[] = ['yield', 'optics', 'bay', 'kit', 'thrust', 'warp'];
const PICKUP_CHASE = 260;
/** Mining drones owned before the bot spends a fleet slot on a hauler. */
const HAULER_AFTER = 2;
/** How far sideways the flagship is sent to leave a comet path. */
const COMET_STEP = 150;

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
    // Price the purchase against the bank the refine leaves behind, then issue
    // both: refining first keeps the fuel schedule, and the purchase still
    // happens before the ship undocks (a skipped cycle would lose the visit).
    const buy = nextPurchase(fuel ? projectedState(state, fuel) : state, wc);
    if (buy) return fuel ? [fuel, buy] : [buy];
  }

  const outpost = nextOutpost(state, fs, wc);
  if (outpost) return fuel ? [fuel, outpost] : [outpost];

  const order = flagshipOrder(state, fs, st, wc);
  return fuel ? [fuel, ...order] : order;
}

/** Price checks shared by every purchase: the ice reserve, and smelting an alloy shortfall from ore. */
interface Purse {
  /** Affordable now without dipping into the ice the next warp needs. */
  ok(c: Cost): boolean;
  /** Not affordable only because alloy is short. */
  needsAlloy(c: Cost): boolean;
  /** Smelts `c`'s alloy shortfall when the ore is there on top of the price. */
  smeltFor(c: Cost): Command | null;
}

function purse(state: GameState, wc: number): Purse {
  const { run } = state;
  const iceEq = run.bank.ice + ICE_PER_FUEL * (run.bank.fuel + queuedOutput(run, 'fuel'));
  const reserve = iceReserve(wc);
  const ok = (c: Cost): boolean => canAfford(run.bank, c) && (!c.ice || iceEq - c.ice >= reserve);
  const alloyHave = run.bank.alloy + queuedOutput(run, 'alloy');
  return {
    ok,
    needsAlloy: (c) => (c.alloy ?? 0) > alloyHave && ok({ ...c, alloy: 0 }),
    smeltFor: (c) => {
      const short = (c.alloy ?? 0) - alloyHave;
      if (short <= 0 || run.bank.ore - (c.ore ?? 0) < short * ORE_PER_ALLOY) return null;
      const block = refineBlock(run, 'alloy', short);
      return 'n' in block ? { t: 'refine', recipe: 'alloy', count: block.n } : null;
    },
  };
}

/**
 * Deploys an outpost on a large rock the flagship is already beside, once a hauler is in the fleet to service it and
 * the bank can pay without touching the warp's ice. Rocks in a flare zone or comet path are skipped.
 */
function nextOutpost(state: GameState, fs: Ship, wc: number): Command | null {
  const { run } = state;
  if (!run.ships.some(isHauler) || run.automation.outposts.length >= TUNING.outpostMax) return null;
  if (!purse(state, wc).ok(TUNING.outpostCost)) return null;
  const hz: Hazard = { comets: run.rocks.filter((r) => r.comet), out: { x: 0, z: 0 } };
  for (const r of run.rocks) {
    if (r.size !== 0 || dist(r.pos, fs.pos) > r.radius + TUNING.outpostDeployGap + 40) continue;
    if (!outpostBlock(state, r) && !unsafe(run, hz, r.pos)) return { t: 'deployOutpost', rockId: r.id };
  }
  return null;
}

/**
 * A shallow copy of `state` as the sim will see it once `refine` has run: its
 * inputs are already paid and its output already queued, so a purchase can be
 * priced against the bank the refine leaves behind without mutating `state`.
 */
function projectedState(state: GameState, refine: Command): GameState {
  if (refine.t !== 'refine') return state;
  const { run } = state;
  const bank = { ...run.bank };
  pay(bank, batchCost(refine.recipe, refine.count));
  const queue = run.refinery.queue.slice();
  const last = queue[queue.length - 1];
  if (last && last.recipe === refine.recipe) {
    queue[queue.length - 1] = { ...last, count: last.count + refine.count, total: last.total + refine.count };
  } else {
    queue.push({
      id: run.refinery.nextId,
      recipe: refine.recipe,
      count: refine.count,
      total: refine.count,
      progress: 0,
    });
  }
  return { ...state, run: { ...run, bank, refinery: { ...run.refinery, queue } } };
}

/** Live comet rocks plus a scratch vector, for the hazard checks of one decision cycle. */
interface Hazard {
  comets: Rock[];
  out: Vec2;
}

/** True if `pos` lies in the flare zone or a comet path (see `sim/hazards`). */
const unsafe = (run: Run, hz: Hazard, pos: Vec2): boolean =>
  inFlareZone(run, pos) || cometPathEscape(run, hz.comets, pos, TUNING.cometDodgePad, hz.out);

/** The flagship's non-purchase order this cycle: get clear of a hazard, dock, chase debris, or mine. */
function flagshipOrder(state: GameState, fs: Ship, st: ShipStats, wc: number): Command[] {
  const { run } = state;
  const hz: Hazard = { comets: run.rocks.filter((r) => r.comet), out: { x: 0, z: 0 } };
  const free = cargoFree(fs, st);
  const full = isFull(st.cargoCap, free);

  if (cometPathEscape(run, hz.comets, fs.pos, TUNING.cometDodgePad + st.size, hz.out)) {
    const to = { x: fs.pos.x + hz.out.x * COMET_STEP, z: fs.pos.z + hz.out.z * COMET_STEP };
    return [{ t: 'move', shipId: fs.id, to }];
  }
  if (inFlareZone(run, fs.pos)) {
    if (isDocked(run, fs)) return fs.order ? [{ t: 'stop', shipId: fs.id }] : [];
    if (flareShelter(run, fs.pos, full, hz.out) === 'dock')
      return fs.order?.kind === 'dock' ? [] : [{ t: 'dock', shipId: fs.id }];
    return [{ t: 'move', shipId: fs.id, to: { ...hz.out } }];
  }

  if (full) return fs.order?.kind === 'dock' ? [] : [{ t: 'dock', shipId: fs.id }];
  const o = fs.order;
  if (o?.kind === 'dock') return [];
  // A mine order stands unless its rock has drifted into danger.
  let stale = false;
  if (o?.kind === 'mine') {
    const target = run.rocks.find((r) => r.id === o.rockId);
    if (!target || !unsafe(run, hz, target.pos)) return [];
    stale = true;
  }

  let pickup: { x: number; z: number } | null = null;
  let best = PICKUP_CHASE * PICKUP_CHASE;
  for (const p of run.pickups) {
    const d = distSq(fs.pos, p.pos);
    if (d < best && !unsafe(run, hz, p.pos)) {
      best = d;
      pickup = p.pos;
    }
  }
  if (pickup && best > st.magnet * st.magnet * 0.3) return [{ t: 'move', shipId: fs.id, to: pickup }];

  const rock = pickRock(state, fs, wc, hz);
  if (rock) return [{ t: 'mine', shipId: fs.id, rockId: rock.id }];
  return stale ? [{ t: 'stop', shipId: fs.id }] : [];
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

/** Repair, then one purchase per call: hauler or drone, empty-slot installs, upgrades, bigger flagship. */
function nextPurchase(state: GameState, wc: number): Command | null {
  const { run, profile } = state;
  const fs = flagship(run);
  const { ok, needsAlloy, smeltFor } = purse(state, wc);

  const rc = repairCost(state, fs);
  if (rc > 0 && fs.hull < shipStats(fs, profile).maxHull * 0.7 && run.bank.ore >= rc)
    return { t: 'repair', shipId: fs.id };

  // Once two drones mine, the next fleet slot is kept for one hauler rather than another drone.
  const miners = run.ships.filter((x) => !isFlagship(x) && !isHauler(x)).length;
  const wantHauler = miners >= HAULER_AFTER && !run.ships.some(isHauler);
  if (wantHauler && !hullBlock(state, 'hauler')) {
    if (ok(HULLS.hauler.cost)) return { t: 'buyHull', hullId: 'hauler' };
    const refine = needsAlloy(HULLS.hauler.cost) ? smeltFor(HULLS.hauler.cost) : null;
    if (refine) return refine;
  }
  if (!wantHauler && !hullBlock(state, 'drone') && ok(HULLS.drone.cost)) return { t: 'buyHull', hullId: 'drone' };

  const docked = run.ships.filter((s) => !refitBlock(state, s));
  for (const { comp, variant } of INSTALL_ORDER) {
    for (const s of docked) {
      const i = s.slots.indexOf(null);
      if (i >= 0 && ok(variantDef(comp, variant).cost(1)) && !s.slots.some((f) => f?.type === comp && comp !== 'laser'))
        return { t: 'install', shipId: s.id, slot: i, comp, variant };
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
 * an active breakLarge scores large (size-0) rocks at half distance. Rocks in
 * a flare zone or comet path are skipped.
 */
function pickRock(state: GameState, fs: Ship, wc: number, hz: Hazard): Rock | null {
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
  const st = shipStats(fs, state.profile);
  for (const r of state.run.rocks) {
    if (unsafe(state.run, hz, r.pos)) continue;
    if (!canMine(st, r) || outpostAt(state, r.id)) continue;
    let score = dist(fs.pos, r.pos) * (r.kind === want || (bonusCrystal && r.kind === 'crystal') ? 0.5 : 1);
    if (breakLarge && r.size === 0) score *= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
