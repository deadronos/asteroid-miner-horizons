// Player intent → state changes. Input and UI never mutate GameState
// directly; they enqueue Commands that the sim applies at the start of a tick.
// Invalid commands are rejected with a log line explaining why.

import { v, type Vec2 } from '../core/vec';
import { COMPONENTS, type ComponentId, type Tier } from '../data/components';
import { HULLS, type HullId } from '../data/hulls';
import { PERKS, type PerkId } from '../data/perks';
import { RESOURCES, pay, type Cost } from '../data/resources';
import { newRun } from './create';
import { dataGain, halve, hullBlock, investedCost, perkCost, refitBlock, repairCost, upgradeCost, warpCost } from './economy';
import { droneCount, findShip, flagship, isAlive, isFlagship, makeShip, shipStats } from './ships';
import type { AiMode, GameState, Ship } from './types';

export type Command =
  | { t: 'select'; shipId: number }
  | { t: 'move'; shipId: number; to: Vec2 }
  | { t: 'mine'; shipId: number; rockId: number }
  | { t: 'dock'; shipId: number }
  | { t: 'stop'; shipId: number }
  | { t: 'aiMode'; shipId: number; mode: AiMode }
  | { t: 'install'; shipId: number; slot: number; comp: ComponentId }
  | { t: 'upgrade'; shipId: number; slot: number }
  | { t: 'remove'; shipId: number; slot: number }
  | { t: 'repair'; shipId: number }
  | { t: 'buyHull'; hullId: HullId }
  | { t: 'scrap'; shipId: number }
  | { t: 'buyPerk'; perk: PerkId }
  | { t: 'warp' };

function refund(state: GameState, c: Cost): void {
  for (const r of RESOURCES) state.run.bank[r] += c[r] ?? 0;
}

/** Keeps hull/shield within new maxima after a refit, preserving damage taken. */
function clampToStats(state: GameState, ship: Ship): void {
  const st = shipStats(ship, state.profile);
  ship.hull = Math.min(ship.hull, st.maxHull);
  ship.shield = Math.min(ship.shield, st.maxShield);
}

export function applyCommand(state: GameState, cmd: Command): void {
  const { run, profile, out } = state;
  const fail = (msg: string): void => void out.log.push({ level: 'warn', text: msg });

  if (cmd.t === 'buyPerk') {
    const cost = perkCost(state, cmd.perk);
    if (cost == null) return fail('Perk already maxed.');
    if (profile.data < cost) return fail('Not enough Horizon Data.');
    profile.data -= cost;
    profile.perks[cmd.perk] += 1;
    out.log.push({ level: 'major', text: `Researched ${PERKS[cmd.perk].name} ${profile.perks[cmd.perk]}.` });
    for (const s of run.ships) clampToStats(state, s);
    return;
  }

  if (cmd.t === 'warp') {
    const cost = warpCost(state);
    if (run.bank.ice < cost) return fail(`Warp needs ${cost} ice in the station bank.`);
    const gain = dataGain(state);
    profile.data += gain;
    profile.dataEarned += gain;
    profile.warps += 1;
    state.run = newRun(profile);
    out.fx.push({ t: 'warp' });
    out.log.push({ level: 'major', text: `Warp complete: welcome to ${state.run.system.name} (system ${state.run.system.number}). +${gain} Horizon Data.` });
    return;
  }

  if (cmd.t === 'buyHull') {
    const block = hullBlock(state, cmd.hullId);
    if (block) return fail(block);
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
      const taken = run.ships.map((s) => (s.name.startsWith(`${prefix}-`) ? Number(s.name.slice(prefix.length + 1)) || 0 : 0));
      const ship = makeShip(run, profile, cmd.hullId, `${prefix}-${Math.max(0, ...taken) + 1}`, v(st.x + n * 6, st.z - 20));
      run.ships.push(ship);
      out.log.push({ level: 'info', text: `${ship.name} launched from the station.` });
    }
    return;
  }

  const ship = findShip(run, cmd.shipId);
  if (!ship) return;

  switch (cmd.t) {
    case 'select':
      run.selectedId = ship.id;
      return;
    case 'move':
      if (isAlive(ship)) ship.order = { kind: 'move', to: { ...cmd.to } };
      return;
    case 'mine':
      if (!isAlive(ship)) return;
      if (shipStats(ship, profile).dps <= 0) return fail(`${ship.name} has no mining laser fitted.`);
      if (run.rocks.some((r) => r.id === cmd.rockId)) ship.order = { kind: 'mine', rockId: cmd.rockId };
      return;
    case 'dock':
      if (isAlive(ship)) ship.order = { kind: 'dock' };
      return;
    case 'stop':
      ship.order = null;
      ship.aiTargetId = null;
      return;
    case 'aiMode':
      ship.aiMode = cmd.mode;
      ship.aiTargetId = null;
      return;
    case 'repair': {
      const cost = repairCost(state, ship);
      const block = refitBlock(state, ship);
      if (block) return fail(block);
      if (cost <= 0) return;
      if (!pay(run.bank, { ore: cost })) return fail(`Repair needs ${cost} ore.`);
      ship.hull = shipStats(ship, profile).maxHull;
      out.log.push({ level: 'info', text: `${ship.name} repaired.` });
      return;
    }
    case 'scrap': {
      if (isFlagship(ship)) return fail('The flagship cannot be scrapped.');
      const block = refitBlock(state, ship);
      if (block) return fail(block);
      refund(state, halve(HULLS[ship.hullId].cost));
      for (const f of ship.slots) if (f) refund(state, halve(investedCost(f.type, f.tier)));
      run.ships = run.ships.filter((s) => s !== ship);
      if (run.selectedId === ship.id) run.selectedId = flagship(run).id;
      out.log.push({ level: 'info', text: `${ship.name} scrapped for half value.` });
      return;
    }
  }

  // Remaining commands are slot refits.
  const block = refitBlock(state, ship);
  if (block) return fail(block);
  if (cmd.slot < 0 || cmd.slot >= ship.slots.length) return;
  const cur = ship.slots[cmd.slot] ?? null;

  if (cmd.t === 'upgrade') {
    const cost = upgradeCost(ship, cmd.slot);
    if (!cur || !cost) return;
    if (!pay(run.bank, cost)) return fail('Not enough resources for that upgrade.');
    cur.tier = (cur.tier + 1) as Tier;
    out.log.push({ level: 'info', text: `${ship.name}: ${COMPONENTS[cur.type].name} → T${cur.tier}.` });
  } else if (cmd.t === 'remove') {
    if (!cur) return;
    refund(state, halve(investedCost(cur.type, cur.tier)));
    ship.slots[cmd.slot] = null;
    clampToStats(state, ship);
  } else if (cmd.t === 'install') {
    if (cur?.type === cmd.comp) return;
    if (!pay(run.bank, COMPONENTS[cmd.comp].cost(1))) return fail('Not enough resources for that component.');
    if (cur) refund(state, halve(investedCost(cur.type, cur.tier)));
    ship.slots[cmd.slot] = { type: cmd.comp, tier: 1 };
    clampToStats(state, ship);
    out.log.push({ level: 'info', text: `${ship.name}: installed ${COMPONENTS[cmd.comp].name}.` });
  }
}
