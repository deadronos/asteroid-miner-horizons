// The warp picker takes focus on open and keeps Tab inside itself, so keyboard
// and gamepad use cannot wander into the HUD behind it.

import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import type { GameState } from '../src/sim/types';
import { WarpPanel } from '../src/ui/panels/WarpPanel';
import type { FakeEl } from './domStub';
import { pressKey, resetDom } from './domStub';

afterEach(() => {
  resetDom();
});

const mount = (state: GameState): { el: FakeEl; opener: FakeEl; panel: WarpPanel } => {
  resetDom();
  const doc = document as unknown as { createElement: (tag: string) => FakeEl; body: FakeEl };
  const opener = doc.createElement('button');
  const el = doc.createElement('div');
  el.className = 'modal hidden';
  doc.body.append(opener, el);
  const ctx = {
    getState: () => state,
    send: () => {},
    settings: { value: { hazards: 'normal' } } as unknown as SettingsStore,
  };
  const panel = new WarpPanel(el as unknown as HTMLElement, ctx);
  return { el, opener, panel };
};

const active = (): FakeEl => (document as unknown as { activeElement: FakeEl }).activeElement;

/** The picker's buttons in Tab order: one per candidate system, then Cancel. */
const buttons = (el: FakeEl): FakeEl[] => el.querySelectorAll('button:not([disabled])');

describe('warp picker focus', () => {
  it('focuses the first candidate on open', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { el, opener, panel } = mount(state);
    opener.focus();
    panel.toggle(true);
    expect(panel.open).toBe(true);
    expect(el.contains(active())).toBe(true);
    expect(active()).toBe(buttons(el)[0]);
    expect(active().textContent.startsWith('WARP')).toBe(true);
  });

  it('wraps Tab from the last button to the first', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { el, panel } = mount(state);
    panel.toggle(true);
    const list = buttons(el);
    list[list.length - 1]!.focus();
    pressKey('Tab');
    expect(el.contains(active())).toBe(true);
    expect(active()).toBe(list[0]);
  });

  it('wraps Shift-Tab from the first button to the last', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { el, panel } = mount(state);
    panel.toggle(true);
    const list = buttons(el);
    list[0]!.focus();
    pressKey('Tab', true);
    expect(el.contains(active())).toBe(true);
    expect(active()).toBe(list[list.length - 1]);
  });

  it('restores focus to the opener on close', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { opener, panel } = mount(state);
    opener.focus();
    panel.toggle(true);
    expect(active()).not.toBe(opener);
    panel.toggle(false);
    expect(active()).toBe(opener);
  });
});
