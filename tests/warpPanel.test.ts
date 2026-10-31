// The warp picker takes focus on open and keeps Tab inside itself, so keyboard
// and gamepad use cannot wander into the HUD behind it.

import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import type { GameState } from '../src/sim/types';
import { closeTopModal } from '../src/ui/modalKey';
import { ResearchPanel } from '../src/ui/panels/ResearchPanel';
import { WarpPanel } from '../src/ui/panels/WarpPanel';
import type { FakeEl } from './domStub';
import { pressKey, resetDom } from './domStub';

afterEach(() => {
  resetDom();
});

const ctx = (state: GameState) => ({
  getState: () => state,
  send: () => {},
  settings: { value: { hazards: 'normal' } } as unknown as SettingsStore,
});

const doc = (): { createElement: (tag: string) => FakeEl; body: FakeEl } =>
  document as unknown as { createElement: (tag: string) => FakeEl; body: FakeEl };

const mount = (state: GameState): { el: FakeEl; opener: FakeEl; panel: WarpPanel } => {
  resetDom();
  const opener = doc().createElement('button');
  const el = doc().createElement('div');
  el.className = 'modal hidden';
  doc().body.append(opener, el);
  const panel = new WarpPanel(el as unknown as HTMLElement, ctx(state));
  return { el, opener, panel };
};

const active = (): FakeEl => (document as unknown as { activeElement: FakeEl }).activeElement;

/** The picker's buttons in Tab order: one per candidate system, then Cancel. */
const buttons = (el: FakeEl): FakeEl[] => el.querySelectorAll('button:not([disabled])');

/** What Hud.escape does once the menu has had its turn: close whichever dialog is on top. */
const escape = (researchEl: FakeEl, research: ResearchPanel, warpEl: FakeEl, warp: WarpPanel): boolean =>
  closeTopModal([
    { el: researchEl as unknown as HTMLElement, close: () => research.toggle(false) },
    { el: warpEl as unknown as HTMLElement, close: () => warp.toggle(false) },
  ]);

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

  it('falls back to the top bar WARP button when the opener is gone', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { el, opener, panel } = mount(state);
    const bar = doc().createElement('div');
    bar.id = 'topbar';
    const warp = doc().createElement('button');
    warp.className = 'warp';
    bar.append(warp);
    doc().body.append(bar);
    opener.focus();
    panel.toggle(true);
    doc().body.replaceChildren(bar, el);
    expect(opener.isConnected).toBe(false);
    panel.toggle(false);
    expect(active()).toBe(warp);
  });

  it('leaves focus on the body when the opener and the WARP button are both gone', () => {
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const { el, opener, panel } = mount(state);
    opener.focus();
    panel.toggle(true);
    doc().body.replaceChildren(el);
    panel.toggle(false);
    expect(active()).toBe(doc().body);
  });
});

describe('stacked warp picker and research', () => {
  it('closes the picker first and restores focus in order', () => {
    resetDom();
    const opener = doc().createElement('button');
    const researchEl = doc().createElement('div');
    researchEl.className = 'modal hidden';
    const warpEl = doc().createElement('div');
    warpEl.className = 'modal hidden';
    doc().body.append(opener, researchEl, warpEl);
    const state = newGame(5);
    state.run.bank.fuel = 500;
    const research = new ResearchPanel(researchEl as unknown as HTMLElement, ctx(state));
    const warp = new WarpPanel(warpEl as unknown as HTMLElement, ctx(state));

    opener.focus();
    research.toggle(true);
    const doctrine = active();
    expect(researchEl.contains(doctrine)).toBe(true);
    warp.toggle(true);
    expect(warpEl.contains(active())).toBe(true);

    // Tab stays in the picker on top, not in Research underneath it.
    pressKey('Tab');
    expect(warpEl.contains(active())).toBe(true);

    expect(escape(researchEl, research, warpEl, warp)).toBe(true);
    expect(warp.open).toBe(false);
    expect(research.open).toBe(true);
    expect(active()).toBe(doctrine);

    expect(escape(researchEl, research, warpEl, warp)).toBe(true);
    expect(research.open).toBe(false);
    expect(active()).toBe(opener);

    expect(escape(researchEl, research, warpEl, warp)).toBe(false);
  });
});
