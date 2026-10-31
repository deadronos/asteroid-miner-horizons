// The Horizon Gate, a multi-stage endgame project. Costs live here so the sim,
// the HUD and the balance report describe the same stages. Nothing here is random.

import type { DoctrineChoice } from './doctrines';
import type { PerkId } from './perks';
import { RESOURCE_INFO, RESOURCES, type Resource } from './resources';

/** Horizon Data plus one column per bank resource. */
export type GateCost = { data: number } & Record<Resource, number>;

export interface GateStage {
  id: string;
  name: string;
  /** One sentence under the stage name. */
  detail: string;
  cost: GateCost;
}

const cost = (data: number, ore: number, ice: number, crystal: number, alloy: number): GateCost => ({
  data,
  ore,
  ice,
  crystal,
  alloy,
  fuel: 0,
});

/**
 * Three stages. Horizon Data is small because the balance bot only has whatever
 * is left after it buys a perk; the resources are what a warp would abandon.
 * Fuel is never a cost: the delivery leaves the fuel a warp needs.
 */
export const GATE_STAGES: readonly GateStage[] = [
  {
    id: 'anchor',
    name: 'Anchor',
    detail: 'Sink the first pylons at the edge of the system.',
    cost: cost(1, 40, 15, 0, 0),
  },
  {
    id: 'ring',
    name: 'Ring',
    detail: 'Frame the aperture with crystal and a second load of ore.',
    cost: cost(1, 80, 20, 20, 0),
  },
  {
    id: 'aperture',
    name: 'Aperture',
    detail: 'Charge the ring and open the gate.',
    cost: cost(1, 100, 0, 30, 15),
  },
];

/** Perk levels New Game+ copies onto the fresh profile, taken from the highest perks. */
export const NG_PLUS_PERK_LEVELS = 3;
/** Doctrine pairs New Game+ copies, in pair-id order, skipping pairs left unset. */
export const NG_PLUS_DOCTRINE_PAIRS = 1;

/**
 * The keep rule, in the words the summary and the research panel show.
 * Perk ties follow the perk table (Refined Assays first). The doctrine kept is
 * the first set pair in Fleet, Hold, Beam order, copied by its stable side id.
 */
export const NG_PLUS_RULE =
  'New Game+ keeps 3 perk levels in total, on your highest perks (ties follow the perk list, Refined Assays first), and 1 doctrine pair: the first one set, in Fleet, Hold, Beam order, copied by its side id. Warps, Horizon Data, every other perk and doctrine, and the gate reset. Lifetime stats and achievements stay, and the galaxy seed stays.';

export interface GateSummary {
  warps: number;
  /** Sim seconds, from the lifetime clock at the moment the gate opened. */
  time: number;
  rocksBroken: number;
  unitsMined: number;
  contracts: number;
  refined: number;
  dataEarned: number;
  /** The doctrines in use when the gate opened. A later respec does not rewrite this. */
  doctrines: DoctrineChoice;
}

export interface GateProject {
  /** Stages completed, 0 through `GATE_STAGES.length`. */
  stage: number;
  /** Paid toward the current stage. Zero once a stage completes, and once the gate is open. */
  paid: GateCost;
  /** Frozen when the last stage completes. Null until then, and after New Game+. */
  summary: GateSummary | null;
  /** The player closed the run-summary dialog. The summary stays in Research either way. */
  acknowledged: boolean;
}

export const emptyGateCost = (): GateCost => ({ data: 0, ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 });

/** A profile that has not started the gate. */
export function freshGate(): GateProject {
  return { stage: 0, paid: emptyGateCost(), summary: null, acknowledged: false };
}

export const gateOpen = (gate: GateProject): boolean => gate.stage >= GATE_STAGES.length;

/** What is still owed on `cost` after `paid`. */
export function gateRemainder(paid: GateCost, costOf: GateCost): GateCost {
  const out = emptyGateCost();
  out.data = Math.max(0, costOf.data - paid.data);
  for (const r of RESOURCES) out[r] = Math.max(0, costOf[r] - paid[r]);
  return out;
}

export function addGateCost(a: GateCost, b: GateCost): GateCost {
  const out = emptyGateCost();
  out.data = a.data + b.data;
  for (const r of RESOURCES) out[r] = a[r] + b[r];
  return out;
}

/** True when `paid` covers every column of `cost`. */
export function stageMet(paid: GateCost, costOf: GateCost): boolean {
  if (paid.data + 1e-9 < costOf.data) return false;
  return RESOURCES.every((r) => paid[r] + 1e-9 >= costOf[r]);
}

const qty = (n: number): string => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(1));

const joinList = (parts: string[]): string => {
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
};

/** One bill, resource names spelled out so it does not depend on colour or icons. */
export function formatGateCost(bill: GateCost): string {
  const parts: string[] = [];
  if (bill.data > 0) parts.push(`${qty(bill.data)} Horizon Data`);
  for (const r of RESOURCES) {
    if (bill[r] > 0) parts.push(`${qty(bill[r])} ${RESOURCE_INFO[r].name.toLowerCase()}`);
  }
  return joinList(parts);
}

/** A zeroed perk table. The keep rule fills the levels it copies. */
export const blankPerks = (): Record<PerkId, number> =>
  ({ yield: 0, optics: 0, thrust: 0, bay: 0, kit: 0, warp: 0, furnace: 0, hopper: 0 }) as Record<PerkId, number>;
