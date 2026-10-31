// Horizon Gate deliveries and New Game+. No RNG: a delivery spends what the
// player (or the bot) already holds, and New Game+ copies a fixed subset of
// perks and one doctrine pair. Warp fuel is never spent, so funding the gate
// cannot stop a warp that was already affordable.

import { DOCTRINE_PAIR_IDS, DOCTRINE_SIDES, emptyDoctrines, type DoctrineChoice } from '../data/doctrines';
import {
  GATE_STAGES,
  NG_PLUS_DOCTRINE_PAIRS,
  NG_PLUS_PERK_LEVELS,
  addGateCost,
  blankPerks,
  emptyGateCost,
  formatGateCost,
  freshGate,
  gateOpen,
  gateRemainder,
  stageMet,
  type GateCost,
  type GateProject,
  type GateSummary,
} from '../data/gate';
import { PERKS, PERK_IDS, type PerkId } from '../data/perks';
import { RESOURCES, pay, type Resource } from '../data/resources';
import { newRun } from './create';
import { doctrineRespecNotice, warpCost } from './economy';
import type { GameState } from './types';

/**
 * How much of `resource` a delivery may take. Fuel stops at the cost of the next warp, so a
 * delivery cannot turn an affordable warp into a failed one. Ice is not reserved: feedstock
 * the refinery would turn into fuel can be spent on the gate.
 */
export function deliverable(state: GameState, resource: Resource, need: number): number {
  if (need <= 1e-9) return 0;
  let have = state.run.bank[resource];
  if (resource === 'fuel') have = Math.max(0, have - warpCost(state));
  return Math.min(Math.max(0, have), need);
}

/**
 * What `fundGate` would spend right now, toward the current stage only.
 * Null when the gate is open or the player has nothing the stage still wants
 * (warp fuel does not count).
 */
export function gatePayment(state: GameState, opts: { data?: boolean } = {}): GateCost | null {
  const gate = state.profile.gate;
  if (gateOpen(gate)) return null;
  const stage = GATE_STAGES[gate.stage]!;
  const due = gateRemainder(gate.paid, stage.cost);
  const payBill = emptyGateCost();
  const data = opts.data === false ? 0 : Math.min(state.profile.data, due.data);
  if (data > 0) payBill.data = data;
  for (const r of RESOURCES) {
    const n = deliverable(state, r, due[r]);
    if (n > 0) payBill[r] = n;
  }
  const any = payBill.data > 0 || RESOURCES.some((r) => payBill[r] > 0);
  return any ? payBill : null;
}

const oweText = (gate: GateProject): string => {
  const stage = GATE_STAGES[Math.min(gate.stage, GATE_STAGES.length - 1)]!;
  return `${stage.name} still needs ${formatGateCost(gateRemainder(gate.paid, stage.cost))}`;
};

/**
 * Spends as much as `gatePayment` allows, repeating if that finishes a stage and more remains.
 * `data: false` keeps Horizon Data for perks; the balance bot uses that until the mid-game targets
 * are behind it.
 */
export function applyFundGate(state: GameState, opts: { data?: boolean } = {}): void {
  const { profile, out } = state;
  if (gateOpen(profile.gate)) {
    out.log.push({ level: 'warn', text: 'The Horizon Gate is already open. New Game+ is in Research.' });
    return;
  }
  const spent = emptyGateCost();
  const finished: string[] = [];
  for (;;) {
    const bill = gatePayment(state, opts);
    if (!bill) break;
    if (!pay(state.run.bank, bill)) break;
    profile.data -= bill.data;
    const gate = profile.gate;
    gate.paid = addGateCost(gate.paid, bill);
    spent.data += bill.data;
    for (const r of RESOURCES) spent[r] += bill[r];
    const stage = GATE_STAGES[gate.stage]!;
    if (!stageMet(gate.paid, stage.cost)) break;
    finished.push(stage.name);
    gate.stage += 1;
    gate.paid = emptyGateCost();
    if (gateOpen(gate)) {
      gate.summary = captureSummary(state);
      profile.stats.gates += 1;
      break;
    }
  }
  if (spent.data <= 0 && RESOURCES.every((r) => spent[r] <= 0)) {
    out.log.push({
      level: 'warn',
      text: `Nothing to deliver toward the Horizon Gate. Warp fuel stays in the bank. ${oweText(profile.gate)}.`,
    });
    return;
  }
  const delivered = `delivered ${formatGateCost(spent)}`;
  if (profile.gate.summary) {
    const s = profile.gate.summary;
    out.log.push({
      level: 'major',
      text: `Horizon Gate open after ${s.warps} warps. ${delivered}.`,
      event: 'research',
    });
    return;
  }
  if (finished.length > 0) {
    const name = finished[finished.length - 1]!;
    out.log.push({
      level: 'major',
      text: `Horizon Gate: ${delivered}. ${name} complete (stage ${profile.gate.stage} of ${GATE_STAGES.length}). ${oweText(profile.gate)}.`,
      event: 'research',
    });
    return;
  }
  out.log.push({
    level: 'info',
    text: `Horizon Gate: ${delivered}. ${oweText(profile.gate)}.`,
    event: 'research',
  });
}

function captureSummary(state: GameState): GateSummary {
  const { profile } = state;
  return {
    warps: profile.warps,
    time: profile.stats.time,
    rocksBroken: profile.stats.rocksBroken,
    unitsMined: profile.stats.unitsMined,
    contracts: profile.stats.contracts,
    refined: profile.stats.refined,
    dataEarned: profile.dataEarned,
    doctrines: { ...profile.doctrines },
  };
}

/**
 * The highest perk levels, up to `NG_PLUS_PERK_LEVELS` in total. Equal levels
 * keep the earlier perk in the perk table. A perk is never kept above the
 * level the run actually had.
 */
export function keptPerks(perks: Record<PerkId, number>): Record<PerkId, number> {
  const out = blankPerks();
  // Higher level first. Equal levels stay in perk-table order (a later perk never jumps an equal one).
  const ranked: PerkId[] = [];
  for (const id of PERK_IDS) {
    const level = perks[id];
    const at = ranked.findIndex((other) => level > perks[other]);
    ranked.splice(at < 0 ? ranked.length : at, 0, id);
  }
  let left = NG_PLUS_PERK_LEVELS;
  for (const id of ranked) {
    if (left <= 0) break;
    const give = Math.min(Math.max(0, perks[id]), left);
    out[id] = give;
    left -= give;
  }
  return out;
}

/** The first `NG_PLUS_DOCTRINE_PAIRS` set pairs, in pair-id order. The side id is copied unchanged. */
export function keptDoctrines(choice: DoctrineChoice): DoctrineChoice {
  const out = emptyDoctrines();
  let kept = 0;
  for (const pair of DOCTRINE_PAIR_IDS) {
    if (kept >= NG_PLUS_DOCTRINE_PAIRS) break;
    const side = choice[pair];
    if (!side) continue;
    out[pair] = side;
    kept += 1;
  }
  return out;
}

const keptText = (perks: Record<PerkId, number>, doctrines: DoctrineChoice): string => {
  const perkParts = PERK_IDS.filter((id) => perks[id] > 0).map((id) => `${PERKS[id].name} ${perks[id]}`);
  const doctrineParts = DOCTRINE_PAIR_IDS.filter((pair) => doctrines[pair]).map(
    (pair) => `${DOCTRINE_SIDES[doctrines[pair]!].name} (${doctrines[pair]})`,
  );
  const kept = [...perkParts, ...doctrineParts];
  return kept.length ? kept.join(', ') : 'nothing';
};

/** Resets the run and the profile's progression, copying the keep-rule subset first. */
export function applyNewGamePlus(state: GameState): void {
  const { profile, out } = state;
  if (!gateOpen(profile.gate) || !profile.gate.summary) {
    out.log.push({ level: 'warn', text: 'The Horizon Gate is not open yet.' });
    return;
  }
  const perks = keptPerks(profile.perks);
  const doctrines = keptDoctrines(profile.doctrines);
  profile.perks = perks;
  profile.doctrines = doctrines;
  profile.warps = 0;
  profile.data = 0;
  profile.dataEarned = 0;
  profile.gate = freshGate();
  state.run = newRun(profile, 0);
  out.fx.push({ t: 'warp' });
  out.log.push({
    level: 'major',
    text: `New Game+. Kept ${keptText(perks, doctrines)}. Warps, Horizon Data and the gate reset; lifetime stats stay.`,
    event: 'research',
  });
  out.log.push({ level: 'info', text: doctrineRespecNotice() });
}

/** Closes the summary dialog. The frozen summary stays until New Game+. */
export function applyDismissGate(state: GameState): void {
  const gate = state.profile.gate;
  if (!gate.summary) {
    state.out.log.push({ level: 'warn', text: 'No Horizon Gate summary to dismiss.' });
    return;
  }
  gate.acknowledged = true;
}
