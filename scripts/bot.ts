// Scripted player for headless runs (bench, balance). It plays the flagship
// purely through sim Commands, like the UI would; drones keep their own AI.
//
// Each call looks at the state and returns the commands for the next tick:
//   buy affordable perks → warp when the bank has the ice → dock when the
//   hold is full → while docked, repair / buy one thing → chase nearby
//   debris → mine the nearest rock of whichever resource the bank needs.
//
// Ice reserve: any purchase must leave at least ICE_RESERVE × warp cost of
// ice in the bank, otherwise ice-priced
// upgrades would starve the warp forever.

import { dist, distSq } from '../src/core/vec';
import { COMPONENTS, type ComponentId } from '../src/data/components';
import { HULLS } from '../src/data/hulls';
import type { PerkId } from '../src/data/perks';
import { canAfford, type Cost } from '../src/data/resources';
import type { Command } from '../src/sim/commands';
import { hullBlock, isDocked, perkCost, refitBlock, repairCost, upgradeCost, warpCost } from '../src/sim/economy';
import { cargoFree, flagship, isAlive, shipStats } from '../src/sim/ships';
import type { GameState, Rock, Ship } from '../src/sim/types';

export const ICE_RESERVE = 0.5;
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
  if (opts.warp !== false && run.bank.ice >= wc) return [{ t: 'warp' }];
  if (!isAlive(fs)) return [];

  const st = shipStats(fs, profile);
  if (isDocked(run, fs)) {
    const buy = nextPurchase(state, wc);
    if (buy) return [buy];
  }

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

/** Repair, then one purchase per call: drone, empty-slot installs, upgrades, bigger flagship. */
function nextPurchase(state: GameState, wc: number): Command | null {
  const { run, profile } = state;
  const fs = flagship(run);
  const reserve = ICE_RESERVE * wc;
  const ok = (c: Cost): boolean => canAfford(run.bank, c) && (!c.ice || run.bank.ice - c.ice >= reserve);

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
      if (cost && ok(cost)) return { t: 'upgrade', shipId: s.id, slot: i };
    }
  }
  if (!hullBlock(state, 'excavator') && ok(HULLS.excavator.cost)) return { t: 'buyHull', hullId: 'excavator' };
  return null;
}

/** Nearest rock, with the resource the bank is shorter on counting as half the distance. */
function pickRock(state: GameState, fs: Ship, wc: number): Rock | null {
  const { bank } = state.run;
  const want = bank.ice / wc < bank.ore / 300 ? 'ice' : 'ore';
  let best: Rock | null = null;
  let bestScore = Infinity;
  for (const r of state.run.rocks) {
    const score = dist(fs.pos, r.pos) * (r.kind === want || r.kind === 'crystal' ? 0.5 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
