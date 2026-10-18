// One named handler per Command variant, dispatched through an exhaustive map
// keyed by Command['t']. Bodies are lifted verbatim from applyCommand so
// behaviour is unchanged; the map type makes a missing variant a compile error.

import { removeItem } from '../core/array';
import { v } from '../core/vec';
import { COMPONENTS, type Tier } from '../data/components';
import { HULLS } from '../data/hulls';
import { PERKS } from '../data/perks';
import { RECIPES } from '../data/refining';
import { RESOURCES, formatCost, pay, type Cost } from '../data/resources';
import type { Command } from './commands'; // type-only (erased): no runtime cycle
import { describeContract, fillBoard } from './contracts';
import { newRun } from './create';
import {
  dataGain,
  halve,
  hullBlock,
  investedCost,
  perkCost,
  refitBlock,
  repairCost,
  upgradeCost,
  warpCost,
} from './economy';
import { describeModifiers } from './modifiers';
import { batchCost, cancelRefine, queueRefine } from './refining';
import { droneCount, findShip, flagship, isAlive, isFlagship, makeShip, shipStats } from './ships';
import { canMine } from './traits';
import type { Fitted, GameState, Ship } from './types';

export type Handler<K extends Command['t']> = (state: GameState, cmd: Extract<Command, { t: K }>) => void;
export type Handlers = { [K in Command['t']]: Handler<K> };

function fail(state: GameState, msg: string): void {
  state.out.log.push({ level: 'warn', text: msg });
}

function refund(state: GameState, c: Cost): void {
  for (const r of RESOURCES) state.run.bank[r] += c[r] ?? 0;
}

/** Keeps hull/shield within new maxima after a refit, preserving damage taken. */
function clampToStats(state: GameState, ship: Ship): void {
  const st = shipStats(ship, state.profile);
  ship.hull = Math.min(ship.hull, st.maxHull);
  ship.shield = Math.min(ship.shield, st.maxShield);
}

/** The eleven ship-scoped variants (everything with a shipId). */
type ShipCommand = Extract<Command, { shipId: number }>;

/**
 * Wraps a ship-scoped handler: resolves the ship and is a silent no-op when it
 * is missing (unchanged from the old shared `findShip` guard).
 */
const withShip =
  <K extends ShipCommand['t']>(fn: (state: GameState, ship: Ship, cmd: Extract<ShipCommand, { t: K }>) => void) =>
  (state: GameState, cmd: Extract<ShipCommand, { t: K }>): void => {
    const ship = findShip(state.run, cmd.shipId);
    if (!ship) return;
    fn(state, ship, cmd);
  };

/**
 * Rejects a refit that isn't docked/alive (warn-and-return, like before) and a
 * slot index that is out of bounds (silent no-op, like before); otherwise the
 * slot's current fitting, which may be null.
 */
function slotTarget(state: GameState, ship: Ship, slot: number): { cur: Fitted | null } | null {
  const block = refitBlock(state, ship);
  if (block) {
    fail(state, block);
    return null;
  }
  if (slot < 0 || slot >= ship.slots.length) return null;
  return { cur: ship.slots[slot] ?? null };
}

export const handlers: Handlers = {
  buyPerk: (state, cmd) => {
    const { run, profile, out } = state;
    const cost = perkCost(state, cmd.perk);
    if (cost == null) return fail(state, 'Perk already maxed.');
    if (profile.data < cost) return fail(state, 'Not enough Horizon Data.');
    profile.data -= cost;
    profile.perks[cmd.perk] += 1;
    out.log.push({ level: 'major', text: `Researched ${PERKS[cmd.perk].name} ${profile.perks[cmd.perk]}.` });
    for (const s of run.ships) clampToStats(state, s);
  },

  warp: (state) => {
    const { run, profile, out } = state;
    const cost = warpCost(state);
    if (run.bank.fuel < cost) return fail(state, `Warp needs ${cost} fuel in the station bank.`);
    const gain = dataGain(state);
    profile.data += gain;
    profile.dataEarned += gain;
    profile.warps += 1;
    const dropped = run.contracts.active;
    const left = run.refinery.queue;
    state.run = newRun(profile);
    out.fx.push({ t: 'warp' });
    out.log.push({
      level: 'major',
      text: `Warp complete: welcome to ${state.run.system.name} (system ${state.run.system.number}). +${gain} Horizon Data.`,
    });
    const mods = state.run.system.modifiers;
    if (mods.length > 0) out.log.push({ level: 'major', text: `System modifiers: ${describeModifiers(mods)}.` });
    if (dropped) out.log.push({ level: 'warn', text: `Contract left behind: ${describeContract(dropped)}.` });
    if (left.length > 0) {
      const jobs = left.map((j) => `${j.count} × ${RECIPES[j.recipe].name.toLowerCase()}`).join(', ');
      out.log.push({ level: 'warn', text: `Refinery queue left behind: ${jobs}.` });
    }
  },

  refine: (state, cmd) => {
    const result = queueRefine(state.run, cmd.recipe, cmd.count);
    if ('error' in result) return fail(state, result.error);
    state.out.log.push({
      level: 'info',
      text: `Refinery: queued ${result.queued} × ${RECIPES[cmd.recipe].name.toLowerCase()}.`,
    });
  },

  cancelRefine: (state, cmd) => {
    const job = cancelRefine(state.run, cmd.jobId);
    if (!job) return;
    const refundCost = batchCost(job.recipe, job.count);
    state.out.log.push({
      level: 'info',
      text: `Refinery: cancelled ${job.count} × ${RECIPES[job.recipe].name.toLowerCase()}, refunded ${formatCost(refundCost)}.`,
    });
  },

  buyHull: (state, cmd) => {
    const { run, profile, out } = state;
    const block = hullBlock(state, cmd.hullId);
    if (block) return fail(state, block);
    const h = HULLS[cmd.hullId];
    pay(run.bank, h.cost);
    if (h.role === 'flagship') {
      const fs = flagship(run);
      const frac = fs.hull / shipStats(fs, profile).maxHull;
      const old = fs.slots.filter((s) => s);
      fs.hullId = cmd.hullId;
      fs.slots = Array.from({ length: h.slots }, (_, i) => old[i] ?? null);
      // Parts that no longer fit are refunded at half value.
      for (const extra of old.slice(h.slots)) refund(state, halve(investedCost(extra!.type, extra!.tier)));
      fs.hull = frac * shipStats(fs, profile).maxHull;
      out.log.push({ level: 'major', text: `Flagship refitted onto a ${h.name} hull.` });
    } else {
      const st = run.system.station.pos;
      const n = droneCount(run) + 1;
      const prefix = h.name.split(' ').pop()!;
      const taken = run.ships.map((s) =>
        s.name.startsWith(`${prefix}-`) ? Number(s.name.slice(prefix.length + 1)) || 0 : 0,
      );
      const ship = makeShip(
        run,
        profile,
        cmd.hullId,
        `${prefix}-${Math.max(0, ...taken) + 1}`,
        v(st.x + n * 6, st.z - 20),
      );
      run.ships.push(ship);
      out.log.push({ level: 'info', text: `${ship.name} launched from the station.` });
    }
  },

  select: withShip((state, ship) => {
    state.run.selectedId = ship.id;
  }),

  move: withShip((state, ship, cmd) => {
    if (isAlive(ship)) ship.order = { kind: 'move', to: { ...cmd.to } };
  }),

  mine: withShip((state, ship, cmd) => {
    if (!isAlive(ship)) return;
    const st = shipStats(ship, state.profile);
    if (st.dps <= 0) return fail(state, `${ship.name} has no mining laser fitted.`);
    const rock = state.run.rocks.find((r) => r.id === cmd.rockId);
    if (!rock) return;
    if (!canMine(st, rock)) return fail(state, 'Dense rock — needs a tier-2 laser.');
    ship.order = { kind: 'mine', rockId: cmd.rockId };
  }),

  dock: withShip((state, ship) => {
    if (isAlive(ship)) ship.order = { kind: 'dock' };
  }),

  stop: withShip((_state, ship) => {
    ship.order = null;
    ship.aiTargetId = null;
  }),

  aiMode: withShip((_state, ship, cmd) => {
    ship.aiMode = cmd.mode;
    ship.aiTargetId = null;
  }),

  repair: withShip((state, ship) => {
    const cost = repairCost(state, ship);
    const block = refitBlock(state, ship);
    if (block) return fail(state, block);
    if (cost <= 0) return;
    if (!pay(state.run.bank, { ore: cost })) return fail(state, `Repair needs ${cost} ore.`);
    ship.hull = shipStats(ship, state.profile).maxHull;
    state.out.log.push({ level: 'info', text: `${ship.name} repaired.` });
  }),

  scrap: withShip((state, ship) => {
    if (isFlagship(ship)) return fail(state, 'The flagship cannot be scrapped.');
    const block = refitBlock(state, ship);
    if (block) return fail(state, block);
    refund(state, halve(HULLS[ship.hullId].cost));
    for (const f of ship.slots) if (f) refund(state, halve(investedCost(f.type, f.tier)));
    removeItem(state.run.ships, ship);
    if (state.run.selectedId === ship.id) state.run.selectedId = flagship(state.run).id;
    state.out.log.push({ level: 'info', text: `${ship.name} scrapped for half value.` });
  }),

  upgrade: withShip((state, ship, cmd) => {
    const t = slotTarget(state, ship, cmd.slot);
    if (!t) return;
    const { cur } = t;
    const cost = upgradeCost(ship, cmd.slot);
    if (!cur || !cost) return;
    if (!pay(state.run.bank, cost)) return fail(state, 'Not enough resources for that upgrade.');
    cur.tier = (cur.tier + 1) as Tier;
    state.out.log.push({ level: 'info', text: `${ship.name}: ${COMPONENTS[cur.type].name} → T${cur.tier}.` });
  }),

  remove: withShip((state, ship, cmd) => {
    const t = slotTarget(state, ship, cmd.slot);
    if (!t) return;
    const { cur } = t;
    if (!cur) return;
    refund(state, halve(investedCost(cur.type, cur.tier)));
    ship.slots[cmd.slot] = null;
    clampToStats(state, ship);
  }),

  install: withShip((state, ship, cmd) => {
    const t = slotTarget(state, ship, cmd.slot);
    if (!t) return;
    const { cur } = t;
    if (cur?.type === cmd.comp) return;
    if (!pay(state.run.bank, COMPONENTS[cmd.comp].cost(1)))
      return fail(state, 'Not enough resources for that component.');
    if (cur) refund(state, halve(investedCost(cur.type, cur.tier)));
    ship.slots[cmd.slot] = { type: cmd.comp, tier: 1 };
    clampToStats(state, ship);
    state.out.log.push({ level: 'info', text: `${ship.name}: installed ${COMPONENTS[cmd.comp].name}.` });
  }),

  acceptContract: (state, cmd) => {
    const board = state.run.contracts;
    if (board.active) return fail(state, 'Finish or abandon the current contract first.');
    const offer = board.offers.find((o) => o.id === cmd.contractId);
    if (!offer) return fail(state, 'That contract is no longer offered.');
    board.offers = board.offers.filter((o) => o !== offer);
    board.active = { ...offer, progress: 0, timeLeft: offer.timeLimit };
    fillBoard(board, state.run.system.number);
    state.out.log.push({ level: 'info', text: `Contract accepted: ${describeContract(offer)}.` });
  },

  abandonContract: (state) => {
    const board = state.run.contracts;
    const c = board.active;
    if (!c) return;
    board.failed++;
    board.active = null;
    state.out.log.push({ level: 'info', text: `Contract abandoned: ${describeContract(c)}.` });
  },
};
