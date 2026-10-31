// Research stays open under the gate summary. Tab must stay inside the top dialog,
// and opening Research must not focus a button that spends the starting wallet.

import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import type { GameState } from '../src/sim/types';
import { GateDialog } from '../src/ui/panels/GateDialog';
import { ResearchPanel } from '../src/ui/panels/ResearchPanel';
import type { FakeEl } from './domStub';
import { pressKey, resetDom } from './domStub';

afterEach(() => {
  resetDom();
});

const mount = (state: GameState): { researchEl: FakeEl; gateEl: FakeEl; research: ResearchPanel; gate: GateDialog } => {
  resetDom();
  const doc = document as unknown as { createElement: (tag: string) => FakeEl; body: FakeEl };
  const researchEl = doc.createElement('div');
  researchEl.className = 'modal hidden';
  const gateEl = doc.createElement('div');
  gateEl.className = 'modal hidden';
  doc.body.append(researchEl, gateEl);
  const ctx = {
    getState: () => state,
    send: () => {},
    settings: {} as SettingsStore,
  };
  const research = new ResearchPanel(researchEl as unknown as HTMLElement, ctx);
  const gate = new GateDialog(gateEl as unknown as HTMLElement, ctx);
  return { researchEl, gateEl, research, gate };
};

const active = (): FakeEl => (document as unknown as { activeElement: FakeEl }).activeElement;

describe('stacked research and gate dialogs', () => {
  it('keeps Tab and Shift-Tab inside the gate summary while Research is also open', () => {
    const state = newGame(3);
    state.profile.data = 50;
    state.run.bank = { ore: 5000, ice: 5000, crystal: 5000, alloy: 5000, fuel: 5000 };
    state.profile.gate.stage = 3;
    state.profile.gate.summary = {
      warps: 4,
      time: 100,
      rocksBroken: 1,
      unitsMined: 1,
      contracts: 1,
      refined: 1,
      dataEarned: 8,
      doctrines: { fleet: 'swarm', haul: null, focus: null },
    };
    const { gateEl, research, gate } = mount(state);
    research.toggle(true);
    gate.refresh();
    expect(gate.open).toBe(true);
    expect(research.open).toBe(true);
    expect(gateEl.contains(active())).toBe(true);
    expect(active().textContent).toBe('New Game+');

    pressKey('Tab');
    expect(gateEl.contains(active())).toBe(true);
    expect(active().textContent).toBe('Keep playing');

    pressKey('Tab', true);
    expect(gateEl.contains(active())).toBe(true);
    expect(active().textContent).toBe('New Game+');

    pressKey('Tab', true);
    expect(gateEl.contains(active())).toBe(true);
    expect(active().textContent).toBe('Keep playing');
  });

  it('opens Research on a doctrine button and keeps Deliver disabled until the stage is payable', () => {
    const state = newGame(1);
    const { researchEl, research } = mount(state);
    research.toggle(true);
    const deliver = researchEl.querySelectorAll('button').find((b) => b.textContent.startsWith('Deliver'));
    expect(deliver?.disabled).toBe(true);
    expect(active().closest('.doctrine')).not.toBeNull();
    expect(active().textContent).toBe('Choose');

    state.profile.data = 1;
    state.run.bank.ore = 40;
    state.run.bank.ice = 15;
    research.refresh();
    expect(deliver?.disabled).toBe(false);
    expect(deliver?.textContent).toBe('Deliver stage');
    expect(active().closest('.doctrine')).not.toBeNull();
  });
});
