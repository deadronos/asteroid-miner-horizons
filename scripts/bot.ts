// Scripted player for headless runs (bench, balance). It plays the flagship
// purely through sim Commands, like the UI would; drones keep their own AI.
//
// Each call looks at the state and returns the commands for the next tick:
//   While 0 < run time < the doctrine window, also pick one doctrine pair from
//   the save seed: seed % 3 chooses the pair (fleet, haul, focus) and seed
//   parity chooses the side (even: the first side, odd: the second). The other
//   two pairs stay unpicked. That rides along with the decision below, costs
//   no Horizon Data, and never clears a pair. Time 0 is skipped so the
//   decision that warps (the old system's clock) is not also a respec; the
//   next decision lands inside the new system's window.
//   buy affordable perks → on the tick the bank can warp, deliver spare
//   resources to the Horizon Gate (warp fuel is left untouched). Spare
//   Horizon Data is included only from system 7 on (profile.warps >= 6), so
//   the delivery does not delay the perks the mid-game targets measure. From
//   then on, a stage that wants only Horizon Data is paid before any perk.
//   Then warp (to the route
//   with the most rock value, lower hazard on a tie) → accept a
//   serviceable contract → dock when the hold is full → while docked,
//   repair / buy one thing (after the first drone, the flagship's tier-2
//   laser before any more hulls) → deploy an outpost on a large rock alongside (once
//   a hauler can service it) → chase nearby debris → mine the nearest rock of
//   whichever resource the bank (or the active delivery contract) needs. The
//   flagship also leaves the rock to dock when the bank can pay for a hull, and
//   heads for a large rock when an outpost is affordable.
//   The sensors ping whenever they are ready, alongside any other order. Once
//   the opening purchases are done and until the first derelict is claimed, the
//   flagship sweeps points around the belts, so its pings reach ground the
//   station-side rocks never cover. A revealed, safe derelict outranks the
//   sweep and mining, and the warp waits until it is claimed. Far from the
//   station, rocks are scored from the station so the ship works its way home.
//   Hazard reflexes come first in the flagship's order: step out of a comet
//   path, and dock (staying docked) or flee past the reach of a pending or
//   burning flare; targets in either are skipped. A fuel refine rides
//   alongside the flagship's order rather than replacing it, so refining never
//   costs the pilot a decision cycle. The refine leaves the ice of the purchase
//   the bank can afford alone, so refining (docked or on the approach) never
//   prices it out; while docked the purchase is issued alongside the refine, so
//   the ship still buys before it undocks.
//
// Ice reserve: any ice-priced purchase must leave at least ICE_RESERVE × warp
// cost worth of ice (counting fuel as its ice equivalent), otherwise
// ice-priced upgrades would starve the warp forever. An upgrade blocked only by
// alloy is smelted from ore.

import { dist, distSq, type Vec2 } from '../src/core/vec';
import { variantDef, type ComponentId, type VariantId } from '../src/data/components';
import { CONTRACTS } from '../src/data/contracts';
import { GATE_STAGES, gateOpen, gateRemainder } from '../src/data/gate';
import { HULLS, type HullId } from '../src/data/hulls';
import { DOCTRINE_PAIR_IDS, DOCTRINE_PAIRS } from '../src/data/doctrines';
import type { PerkId } from '../src/data/perks';
import { RECIPES } from '../src/data/refining';
import { canAfford, pay, RESOURCES, type Cost, type Wallet } from '../src/data/resources';
import { TUNING } from '../src/data/tuning';
import { DEFAULT_FLEET_AUTO } from '../src/sim/assists';
import type { Command } from '../src/sim/commands';
import {
  doctrineWindowOpen,
  hullBlock,
  isDocked,
  perkCost,
  refitBlock,
  repairCost,
  upgradeCost,
  warpCost,
} from '../src/sim/economy';
import { gatePayment } from '../src/sim/gate';
import { outpostAt, outpostBlock } from '../src/sim/automation';
import { anomalies, isClaimed, isRevealed, pingReady } from '../src/sim/exploration';
import { findRock } from '../src/sim/generate';
import { cometPathEscape, flareShelter, inFlareZone } from '../src/sim/hazards';
import { batchCost, batchesPerCycle, cycleTime, queuedOutput, refineBlock } from '../src/sim/refining';
import { richestRoute, warpRoutes } from '../src/sim/routes';
import {
  findShip,
  flagship,
  isAlive,
  isBuilder,
  isFlagship,
  isHauler,
  isHoldFull,
  shipStats,
  type ShipStats,
} from '../src/sim/ships';
import { canMine } from '../src/sim/traits';
import type { Anomaly, GameState, Rock, Run, Ship } from '../src/sim/types';

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
const PERK_ORDER: PerkId[] = ['yield', 'optics', 'furnace', 'bay', 'hopper', 'kit', 'thrust', 'warp'];
const PICKUP_CHASE = 260;
/** Builder reserve the sim's default fleet settings hold back (see `DEFAULT_FLEET_AUTO`). */
const BUILDER_RESERVE = DEFAULT_FLEET_AUTO.builderReserve;
/** Mining drones owned before the bot spends a fleet slot on a hauler. */
export const HAULER_AFTER = 2;
/** How far sideways the flagship is sent to leave a comet path. */
const COMET_STEP = 150;
/** The free sensor ping and an empty order list, shared so a bot cycle allocates neither. */
const PING_ORDER: readonly Command[] = [{ t: 'ping' }];
const NO_COMMANDS: readonly Command[] = [];
/** Warps before the bot pays spare Horizon Data to the gate; before that, all of it buys perks. */
const DATA_DELIVERY_WARPS = 6;
/** Seconds spent sweeping the belts with the sensors once the opening purchases are done. */
const SURVEY_SEC = 80;
/** Survey stops once it has visited this many points around the belt. */
const SURVEY_POINTS = 8;
/** Beyond this many units from the station, mining is scored from the station so the ship comes home. */
const HOME_RADIUS = 900;

export interface BotOptions {
  /** Allow the bot to warp (the bench turns this off to stay in one system). */
  warp?: boolean;
  /** Warp route policy: `best` scores the candidates (the default), `first` always takes route 0. */
  route?: 'best' | 'first';
}

/** The warp route the bot takes: the richest candidate (see `richestRoute`). */
export const chooseRoute = (state: GameState): number => richestRoute(warpRoutes(state.profile));

export function botCommands(state: GameState, opts: BotOptions = {}): Command[] {
  const play = pilotCommands(state, opts);
  const doctrines = doctrinePicks(state);
  return doctrines.length ? [...play, ...doctrines] : play;
}

/**
 * One pair per save, while the respec window is open and the clock has started.
 * `seed % 3` selects the pair and seed parity selects its side. The other pairs
 * are left as they are (null on a fresh profile). A pair already on that side
 * is kept. See the file header.
 */
function doctrinePicks(state: GameState): Command[] {
  if (!(state.run.time > 0 && doctrineWindowOpen(state.run.time))) return [];
  const pair = DOCTRINE_PAIR_IDS[state.profile.seed % DOCTRINE_PAIR_IDS.length]!;
  const want = DOCTRINE_PAIRS[pair].sides[state.profile.seed % 2 === 0 ? 0 : 1].id;
  return state.profile.doctrines[pair] === want ? [] : [{ t: 'chooseDoctrine', pair, side: want }];
}

function pilotCommands(state: GameState, opts: BotOptions): Command[] {
  const { run, profile } = state;
  const fs = flagship(run);

  // The gate's data claim outranks a perk, so a cheap perk cannot spend the last point a stage needs.
  const gate = gateDataClaim(state);
  if (gate) return [gate];

  const perk = nextPerk(state);
  if (perk) return [{ t: 'buyPerk', perk }];

  const wc = warpCost(state);
  if (opts.warp !== false && run.bank.fuel >= wc) {
    // A safe, already-revealed derelict is a one-off payout: claim it before leaving.
    refreshComets(WARP_HAZARD, run);
    if (!isAlive(fs) || nearestDerelict(state, fs, WARP_HAZARD) == null) {
      const route = opts.route === 'first' ? 0 : chooseRoute(state);
      // Spare resources would be abandoned at the jump. Horizon Data joins them
      // only once the measured mid-game is over. Warp fuel is reserved either way.
      const data = profile.warps >= DATA_DELIVERY_WARPS;
      return gatePayment(state, { data })
        ? [
            { t: 'fundGate', data },
            { t: 'warp', route },
          ]
        : [{ t: 'warp', route }];
    }
  }

  if (!isAlive(fs)) return [];

  // A free sensor ping rides along with every other order, whenever it is ready.
  const ping = pingReady(run) ? PING_ORDER : NO_COMMANDS;

  // What the bank would buy now. The refine leaves that purchase's ice alone:
  // queueing a refine pays its ice up front and refining is one-way, so a refine
  // queued while docked, or on the approach, would otherwise price it out (#241).
  const want = nextPurchase(state, wc);
  // The refinery is station-side, so its command rides alongside the flagship's
  // order instead of consuming this decision cycle.
  const fuel = refineFuel(state, wc, want ? iceOf(state, want) : 0);
  const contract = nextContract(state);

  if (contract) return [...ping, ...(fuel ? [fuel] : NO_COMMANDS), contract];

  const st = shipStats(fs, profile);
  if (isDocked(run, fs)) {
    // Price the purchase against the bank the refine leaves behind, then issue
    // both, so the purchase still happens before the ship undocks.
    const buy = fuel ? nextPurchase(projectedState(state, fuel), wc) : want;
    if (buy) return [...ping, ...(fuel ? [fuel] : NO_COMMANDS), buy];
  }

  const outpost = nextOutpost(state, fs, wc);
  if (outpost) return [...ping, ...(fuel ? [fuel] : NO_COMMANDS), outpost];

  const order = flagshipOrder(state, fs, st, wc, want);
  return [...ping, ...(fuel ? [fuel] : NO_COMMANDS), ...order];
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
  if (run.ships.some(isBuilder) && run.automation.outposts.length < TUNING.outpostMax) {
    // A construction drone builds only above its reserve, so keep the alloy for the outpost and that reserve smelted.
    const need = {
      ore: TUNING.outpostCost.ore + BUILDER_RESERVE,
      alloy: (TUNING.outpostCost.alloy ?? 0) + BUILDER_RESERVE,
    };
    const { needsAlloy, smeltFor } = purse(state, wc);
    return needsAlloy(need) ? smeltFor(need) : null;
  }
  // A construction drone, once bought, builds the outposts; until then the flagship leaves them to it unless it can't be bought.
  if (!run.ships.some(isHauler) || !hullBlocked(state, 'constructionDrone')) return null;
  if (run.automation.outposts.length >= TUNING.outpostMax) return null;
  const { ok, needsAlloy, smeltFor } = purse(state, wc);
  if (needsAlloy(TUNING.outpostCost)) return smeltFor(TUNING.outpostCost);
  if (!ok(TUNING.outpostCost)) return null;
  const hz = refreshComets(WARP_HAZARD, run);
  for (const r of run.rocks) {
    if (r.size !== 0 || dist(r.pos, fs.pos) > r.radius + TUNING.outpostDeployGap + 40) continue;
    if (!outpostBlock(state, r, fs) && !unsafe(run, hz, r.pos)) return { t: 'deployOutpost', rockId: r.id };
  }
  return null;
}

/** Ice a purchase decision spends (a smelt or repair spends none). */
function iceOf(state: GameState, cmd: Command): number {
  const ship = cmd.t === 'upgrade' ? findShip(state.run, cmd.shipId) : undefined;
  const cost: Cost | null =
    cmd.t === 'buyHull'
      ? HULLS[cmd.hullId].cost
      : cmd.t === 'install'
        ? variantDef(cmd.comp, cmd.variant).cost(1)
        : cmd.t === 'upgrade' && ship
          ? upgradeCost(ship, cmd.slot)
          : null;
  return cost?.ice ?? 0;
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

/** Reused by the warp gate so its derelict check allocates nothing. */
const WARP_HAZARD: Hazard = { comets: [], out: { x: 0, z: 0 } };

/** Refills `hz.comets` in place with the run's live comets. */
function refreshComets(hz: Hazard, run: Run): Hazard {
  const comets = hz.comets;
  comets.length = 0;
  for (let i = 0; i < run.rocks.length; i++) {
    const r = run.rocks[i]!;
    if (r.comet) comets.push(r);
  }
  return hz;
}

/** Reused survey target, so scoring a rock allocates no vectors. */
const SURVEY: Vec2 = { x: 0, z: 0 };

/**
 * The current survey point, written into `SURVEY`. The sweep starts opposite
 * the station and steps around the belt, so its pings reach anomalies the
 * station-side rocks never cover.
 */
function surveyPoint(run: Run, elapsed: number): Vec2 {
  const st = run.system.station.pos;
  const belts = run.system.belts;
  const radius = belts.length ? (belts[0]!.inner + belts[belts.length - 1]!.outer) / 2 : 0;
  // Start opposite the station and step around the belt, so the sweep covers
  // both belts without ever aiming at a point the station-side pings reach.
  const phase = Math.min(SURVEY_POINTS - 1, Math.floor(elapsed / (SURVEY_SEC / SURVEY_POINTS)));
  const a = Math.atan2(st.z, st.x) + Math.PI + phase * (Math.PI / 4);
  SURVEY.x = Math.cos(a) * radius;
  SURVEY.z = Math.sin(a) * radius;
  return SURVEY;
}

/** True once a drone is in the fleet and the flagship's laser is tier 2, the opening purchases. */
function openingDone(state: GameState): boolean {
  const { run } = state;
  let drone = false;
  for (let i = 0; i < run.ships.length; i++) if (!isFlagship(run.ships[i]!)) drone = true;
  if (!drone) return false;
  const slots = flagship(run).slots;
  for (let i = 0; i < slots.length; i++) {
    const f = slots[i];
    if (f?.type === 'laser') return f.tier >= 2;
  }
  return false;
}

/**
 * Seconds into the current survey, or -1 when the system gets no survey. One
 * entry per run object: its start time, or `NO_SURVEY` once it is over.
 */
const NO_SURVEY = -1;
const surveyStart = new WeakMap<Run, number>();

/**
 * The sensor sweep starts after the opening purchases and runs for `SURVEY_SEC`,
 * so it never delays the opening targets. A claim or the end of the sweep marks
 * it done, so later bot cycles skip the opening check.
 */
function sweepElapsed(state: GameState): number {
  const { run } = state;
  const start = surveyStart.get(run);
  if (start === NO_SURVEY) return -1;
  if (run.exploration.claimed.length > 0) {
    surveyStart.set(run, NO_SURVEY);
    return -1;
  }
  if (start == null) {
    if (!openingDone(state)) return -1;
    surveyStart.set(run, run.time);
    return 0;
  }
  const elapsed = run.time - start;
  if (elapsed >= SURVEY_SEC) {
    surveyStart.set(run, NO_SURVEY);
    return -1;
  }
  return elapsed;
}

/** True if `pos` lies in the flare zone or a comet path (see `sim/hazards`). */
const unsafe = (run: Run, hz: Hazard, pos: Vec2): boolean =>
  inFlareZone(run, pos) || cometPathEscape(run, hz.comets, pos, TUNING.cometDodgePad, hz.out);

/** Nearest revealed, unclaimed derelict that is safe to fly to, or null. */
function nearestDerelict(state: GameState, fs: Ship, hz: Hazard): Anomaly | null {
  const { run } = state;
  const list = anomalies(run);
  let best: Anomaly | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.kind !== 'derelict' || !isRevealed(run, a.id) || isClaimed(run, a.id) || unsafe(run, hz, a.pos)) continue;
    const d = distSq(fs.pos, a.pos);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

/** The flagship's non-purchase order this cycle: get clear of a hazard, dock, chase debris, or mine. */
function flagshipOrder(state: GameState, fs: Ship, st: ShipStats, wc: number, want: Command | null): Command[] {
  const { run } = state;
  const hz = refreshComets(WARP_HAZARD, run);
  const full = isHoldFull(fs, st);

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

  // A hull the bank can already pay for is worth the trip home, as a player would dock for it (#206, #207).
  const affordsHull = want?.t === 'buyHull';
  if (full || affordsHull) return fs.order?.kind === 'dock' ? [] : [{ t: 'dock', shipId: fs.id }];
  const o = fs.order;
  if (o?.kind === 'dock') return [];
  // A revealed derelict pays once, so it outranks mining while it is safe to reach.
  const derelict = nearestDerelict(state, fs, hz);
  if (derelict && distSq(fs.pos, derelict.pos) > TUNING.derelictClaimRadius ** 2)
    return [{ t: 'move', shipId: fs.id, to: { ...derelict.pos } }];
  // Once the opening purchases are done, hold the current survey point for a
  // sweep: the station-side pings alone never reach anomalies out there.
  const sweep = sweepElapsed(state);
  if (sweep >= 0) {
    const p = surveyPoint(run, sweep);
    return distSq(fs.pos, p) > 120 * 120 ? [{ t: 'move', shipId: fs.id, to: { x: p.x, z: p.z } }] : [];
  }
  // A mine order stands unless its rock has drifted into danger.
  let stale = false;
  if (o?.kind === 'mine') {
    const target = findRock(run, o.rockId);
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

/** Refinery perks are researched only while the next warp's fuel would take longer than this to refine. */
const REFINE_SLOW_SEC = 60;
const REFINERY_PERKS: ReadonlySet<PerkId> = new Set(['furnace', 'hopper']);

/** Seconds the refinery needs to crack the next warp's fuel at the current perk levels. */
const warpRefineSec = (state: GameState): number =>
  (warpCost(state) / batchesPerCycle(state.profile)) * cycleTime('fuel', state.profile);

/** Cheapest affordable perk; refinery perks only once refining the warp's fuel has become slow. */
function nextPerk(state: GameState): PerkId | null {
  const refineSlow = warpRefineSec(state) > REFINE_SLOW_SEC;
  let pick: PerkId | null = null;
  let pickCost = Infinity;
  for (const p of PERK_ORDER) {
    if (!refineSlow && REFINERY_PERKS.has(p)) continue;
    const c = perkCost(state, p);
    if (c != null && c <= state.profile.data && c < pickCost) {
      pick = p;
      pickCost = c;
    }
  }
  return pick;
}

/**
 * The Horizon Data claim the gate gets before any perk: once the current stage wants nothing but data,
 * a delivery spends data alone, so it cannot starve a purchase the way the spare-resource delivery at
 * a warp would (#249). Null before the bot pays the gate, while the stage still wants a resource, and
 * once the gate is open.
 */
function gateDataClaim(state: GameState): Command | null {
  const { profile } = state;
  if (profile.warps < DATA_DELIVERY_WARPS || gateOpen(profile.gate)) return null;
  const stage = GATE_STAGES[profile.gate.stage]!;
  const due = gateRemainder(profile.gate.paid, stage.cost);
  if (due.data <= 0 || profile.data <= 0) return null;
  for (const r of RESOURCES) if (due[r] > 0) return null;
  return { t: 'fundGate', data: true };
}

/** Ice worth of fuel the bank must keep back for the next warp. */
const iceReserve = (wc: number): number => ICE_RESERVE * ICE_PER_FUEL * wc;

/**
 * Queues enough fuel for the next warp, keeping ICE_RESERVE of the warp's ice
 * worth back, from the ice left after `keepIce` (a pending purchase's). Issues
 * nothing when the warp is already covered or the queue and bank can't take a batch.
 */
function refineFuel(state: GameState, wc: number, keepIce: number): Command | null {
  const { run } = state;
  const fuelHave = run.bank.fuel + queuedOutput(run, 'fuel');
  if (fuelHave >= wc) return null;
  const ice = run.bank.ice - keepIce;
  let want = wc - fuelHave;
  if (ice < ICE_PER_FUEL * want) {
    // Short of a full warp's ice: bank fuel up to the reserve instead.
    want = Math.min(wc * ICE_RESERVE - fuelHave, Math.floor(ice / ICE_PER_FUEL));
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

/**
 * True if `hullId` is blocked for a reason a purchase could not fix (fleet full, flagship undocked). A resource
 * shortfall does not count: the bot smelts a missing alloy, so it must reach the price check to do that.
 */
function hullBlocked(state: GameState, hullId: HullId): boolean {
  const rich: Wallet = { ore: Infinity, ice: Infinity, crystal: Infinity, alloy: Infinity, fuel: Infinity };
  return hullBlock({ ...state, run: { ...state.run, bank: rich } }, hullId) != null;
}

/** Repair, then one purchase per call: hauler or drone, empty-slot installs, upgrades, bigger flagship. */
function nextPurchase(state: GameState, wc: number): Command | null {
  const { run, profile } = state;
  const fs = flagship(run);
  const { ok, needsAlloy, smeltFor } = purse(state, wc);

  const rc = repairCost(state, fs);
  if (rc > 0 && fs.hull < shipStats(fs, profile).maxHull * 0.7 && run.bank.ore >= rc)
    return { t: 'repair', shipId: fs.id };

  // After the first drone, the flagship's tier-2 laser comes before any more hulls, as a player would buy it (#197).
  const miners = run.ships.filter((x) => !isFlagship(x) && !isHauler(x) && !isBuilder(x)).length;
  const laser = fs.slots.findIndex((f) => f?.type === 'laser');
  const laserCost = miners >= 1 && laser >= 0 && fs.slots[laser]!.tier < 2 ? upgradeCost(fs, laser) : null;
  if (laserCost && ok(laserCost)) return { t: 'upgrade', shipId: fs.id, slot: laser };
  const hulls = !laserCost;

  // Once two drones mine, the next fleet slots are kept for one construction drone, then one hauler, rather than
  // more drones. The builder comes first: it is cheap, and it hauls until it has a rock to build on.
  const wantBuilder = miners >= HAULER_AFTER && !run.ships.some(isBuilder);
  const wantHauler = miners >= HAULER_AFTER && !wantBuilder && !run.ships.some(isHauler);
  for (const [want, hullId] of [
    [wantBuilder, 'constructionDrone'],
    [wantHauler, 'hauler'],
  ] as const) {
    if (!hulls || !want || hullBlocked(state, hullId)) continue;
    if (ok(HULLS[hullId].cost)) return { t: 'buyHull', hullId };
    const refine = needsAlloy(HULLS[hullId].cost) ? smeltFor(HULLS[hullId].cost) : null;
    if (refine) return refine;
  }
  if (hulls && !wantHauler && !wantBuilder && !hullBlocked(state, 'drone') && ok(HULLS.drone.cost))
    return { t: 'buyHull', hullId: 'drone' };

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
  if (hulls && !hullBlocked(state, 'excavator')) {
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
  // With a hauler to service one and the price in the bank, head for a large rock to plant an outpost on.
  const siting =
    state.run.ships.some(isHauler) &&
    state.run.automation.outposts.length < TUNING.outpostMax &&
    purse(state, wc).ok(TUNING.outpostCost);
  const breakLarge = active?.kind === 'breakLarge';
  // A delivery contract owns the want: crystal stops being a free bonus while it runs.
  const bonusCrystal = !active || breakLarge;
  // Far from the station, score rocks from the station so the ship works its way home.
  const station = state.run.system.station.pos;
  const from = distSq(fs.pos, station) > HOME_RADIUS * HOME_RADIUS ? station : fs.pos;
  let best: Rock | null = null;
  let bestScore = Infinity;
  const st = shipStats(fs, state.profile);
  for (const r of state.run.rocks) {
    if (unsafe(state.run, hz, r.pos)) continue;
    if (!canMine(st, r) || outpostAt(state, r.id)) continue;
    let score = dist(from, r.pos) * (r.kind === want || (bonusCrystal && r.kind === 'crystal') ? 0.5 : 1);
    if ((breakLarge || siting) && r.size === 0) score *= 0.5;
    // Rich deposits carry `richYieldMul` units, so a short detour is usually worth it.
    if (r.rich) score *= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
