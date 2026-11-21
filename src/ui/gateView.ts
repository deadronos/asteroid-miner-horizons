// Text for the Horizon Gate in the research panel, the top bar and the run summary.
// Pure: the panels bind these strings, and tests read them without a DOM.

import { formatDuration } from '../core/format';
import { DOCTRINE_PAIR_IDS, DOCTRINE_SIDES } from '../data/doctrines';
import {
  GATE_STAGES,
  NG_PLUS_RULE,
  addGateCost,
  formatGateCost,
  gateOpen,
  gateRemainder,
  gateStageCost,
  stageMet,
} from '../data/gate';
import { gatePayment } from '../sim/gate';
import type { GameState } from '../sim/types';
import type { GateSummary } from '../data/gate';
import { groupDigits } from './menu/StatsTab';

export interface SummaryRow {
  label: string;
  value: string;
}

/**
 * The record shown when the gate opens, and again from Research after the dialog is closed.
 * Warps, Horizon Data and doctrines are this run. The other rows are career totals: they are
 * lifetime stats, so a later New Game+ still counts the runs before it.
 */
export function summaryRows(summary: GateSummary): SummaryRow[] {
  const doctrines = DOCTRINE_PAIR_IDS.filter((pair) => summary.doctrines[pair]).map((pair) => {
    const side = summary.doctrines[pair]!;
    return `${DOCTRINE_SIDES[side].name} (${side})`;
  });
  return [
    { label: 'Warps', value: groupDigits(summary.warps) },
    { label: 'Career time', value: formatDuration(summary.time, { seconds: true }) },
    { label: 'Career asteroids broken', value: groupDigits(summary.rocksBroken) },
    { label: 'Career units mined', value: groupDigits(summary.unitsMined) },
    { label: 'Career contracts', value: groupDigits(summary.contracts) },
    { label: 'Career units refined', value: groupDigits(summary.refined) },
    { label: 'Horizon Data earned', value: groupDigits(summary.dataEarned) },
    { label: 'Doctrines', value: doctrines.length ? doctrines.join(', ') : 'None' },
  ];
}

export interface GatePanelView {
  /** Stage line, including the count so progress is not a bar alone. */
  status: string;
  /** What the next delivery still costs, or the keep rule once the gate is open. */
  next: string;
  /** 0..1, paired with `bar` so the fill is not the only progress cue. */
  fraction: number;
  bar: string;
  deliverLabel: string;
  /** Set when Deliver should explain why it will not spend anything. */
  deliverBlocked: string | null;
  summary: SummaryRow[] | null;
  rule: string;
}

/** Research-panel copy for the gate at `state`. */
export function gatePanel(state: GameState): GatePanelView {
  const { gate, ngPlus } = state.profile;
  const total = GATE_STAGES.length;
  const cyclePrefix = ngPlus > 0 ? `NG+${ngPlus} · ` : '';
  if (gateOpen(gate) && gate.summary) {
    return {
      status: `${cyclePrefix}Horizon Gate open. Stage ${total} of ${total}.`,
      next: 'A new run can keep part of this one.',
      fraction: 1,
      bar: `${total} of ${total} stages`,
      deliverLabel: 'Deliver',
      deliverBlocked: 'The Horizon Gate is already open',
      summary: summaryRows(gate.summary),
      rule: NG_PLUS_RULE,
    };
  }
  const stage = GATE_STAGES[gate.stage]!;
  const cost = gateStageCost(gate.stage, ngPlus);
  const due = gateRemainder(gate.paid, cost);
  // Share of this stage's priced columns already delivered, so the bar matches the words.
  const columns: [number, number][] = [
    [gate.paid.data, cost.data],
    [gate.paid.ore, cost.ore],
    [gate.paid.ice, cost.ice],
    [gate.paid.crystal, cost.crystal],
    [gate.paid.alloy, cost.alloy],
    [gate.paid.fuel, cost.fuel],
  ];
  const priced = columns.filter(([, c]) => c > 0);
  const filled = priced.reduce((sum, [paid, c]) => sum + Math.min(1, paid / c), 0);
  const fraction = (gate.stage + (priced.length ? filled / priced.length : 0)) / total;
  const payment = gatePayment(state);
  const ready = payment != null && stageMet(addGateCost(gate.paid, payment), cost);
  return {
    status: `${cyclePrefix}Stage ${gate.stage + 1} of ${total}: ${stage.name}. ${stage.detail}`,
    next: `Still to deliver: ${formatGateCost(due)}.${ready ? ' The bank can finish this stage.' : ''}`,
    fraction,
    bar: `${gate.stage} of ${total} stages, ${stage.name} in progress`,
    deliverLabel: ready ? 'Deliver stage' : 'Deliver',
    // A partial spend cannot finish the stage, so the button stays disabled until the whole bill fits.
    deliverBlocked: ready
      ? null
      : payment
        ? `A delivery pays this whole stage or nothing. Still needed: ${formatGateCost(due)}.`
        : `Nothing spare to deliver. ${formatGateCost(due)} still needed. Warp fuel stays in the bank.`,
    summary: null,
    rule: NG_PLUS_RULE,
  };
}

/** Top-bar chip: progress and the next stage's cost, in words. */
export function gateChip(state: GameState): { text: string; label: string } {
  const { gate, ngPlus } = state.profile;
  const total = GATE_STAGES.length;
  const cyclePrefix = ngPlus > 0 ? `NG+${ngPlus} · ` : '';
  if (gateOpen(gate)) {
    const label = `${cyclePrefix}Horizon Gate open. New Game+ is available in Research.`;
    return { text: `${cyclePrefix}Gate open`, label };
  }
  const stage = GATE_STAGES[gate.stage]!;
  const cost = gateStageCost(gate.stage, ngPlus);
  const due = formatGateCost(gateRemainder(gate.paid, cost));
  const payment = gatePayment(state);
  const ready = payment != null && stageMet(addGateCost(gate.paid, payment), cost);
  const text = `${cyclePrefix}Gate ${gate.stage}/${total} · next ${due}${ready ? ' · ready' : ''}`;
  const label = `${cyclePrefix}Horizon Gate, stage ${gate.stage + 1} of ${total}: ${stage.name}. Next: ${due}.${ready ? ' Ready to deliver.' : ''}`;
  return { text, label };
}
