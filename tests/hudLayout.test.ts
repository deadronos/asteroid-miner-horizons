import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import { queueRefine } from '../src/sim/refining';
import { makeShip } from '../src/sim/ships';
import { Hud } from '../src/ui/Hud';
import { Panel, bar } from '../src/ui/dom';
import {
  HELP_AUTO_HIDE_SEC,
  autoCollapsed,
  helpVisible,
  isCollapsed,
  toggledCollapse,
  touchControlsShown,
} from '../src/ui/hudLayout';
import type { SaveActions } from '../src/session';
import { resetDom, type FakeEl } from './domStub';
import { memStorage } from './memStorage';

describe('help box visibility', () => {
  it('auto shows help only for the first minutes of lifetime play', () => {
    expect(helpVisible('auto', 0)).toBe(true);
    expect(helpVisible('auto', HELP_AUTO_HIDE_SEC - 0.01)).toBe(true);
    expect(helpVisible('auto', HELP_AUTO_HIDE_SEC)).toBe(false);
  });

  it('on and off ignore play time', () => {
    expect(helpVisible('on', 1e6)).toBe(true);
    expect(helpVisible('off', 0)).toBe(false);
  });
});

describe('panel collapse', () => {
  it('auto-collapses only the refinery, and only while its queue is empty', () => {
    const s = newGame(7);
    expect(autoCollapsed('refinery', s)).toBe(true);
    expect(autoCollapsed('fleet', s)).toBe(false);
    expect(autoCollapsed('ship', s)).toBe(false);
    expect(autoCollapsed('contracts', s)).toBe(false);
    s.run.bank.ore = 1000;
    queueRefine(s.run, 'alloy', 1);
    expect(s.run.refinery.queue.length).toBe(1);
    expect(autoCollapsed('refinery', s)).toBe(false);
  });

  it('an explicit choice overrides the automatic state', () => {
    const s = newGame(7);
    expect(isCollapsed('refinery', { refinery: false }, s)).toBe(false);
    expect(isCollapsed('fleet', { fleet: true }, s)).toBe(true);
  });

  it('toggling stores a choice, and toggling back to the automatic state clears it', () => {
    const s = newGame(7);
    const open = toggledCollapse('refinery', {}, s);
    expect(open).toEqual({ refinery: false });
    expect(toggledCollapse('refinery', open, s)).toEqual({});

    const folded = toggledCollapse('fleet', {}, s);
    expect(folded).toEqual({ fleet: true });
    expect(toggledCollapse('fleet', folded, s)).toEqual({});
  });

  it('does not mutate the stored choices', () => {
    const s = newGame(7);
    const prefs = { ship: true };
    toggledCollapse('ship', prefs, s);
    toggledCollapse('contracts', prefs, s);
    expect(prefs).toEqual({ ship: true });
  });
});

describe('touch controls visibility', () => {
  it('auto follows the pointer; on and off ignore it', () => {
    expect(touchControlsShown('auto', true)).toBe(true);
    expect(touchControlsShown('auto', false)).toBe(false);
    expect(touchControlsShown('on', false)).toBe(true);
    expect(touchControlsShown('off', true)).toBe(false);
  });
});

describe('panel collapse on a narrow screen', () => {
  it('folds every panel by default, while explicit choices still win', () => {
    const s = newGame(7);
    for (const id of ['fleet', 'contracts', 'ship', 'refinery'] as const) {
      expect(autoCollapsed(id, s, true)).toBe(true);
      expect(isCollapsed(id, {}, s, true)).toBe(true);
    }
    expect(isCollapsed('ship', { ship: false }, s, true)).toBe(false);
  });

  it('opens one panel at a time', () => {
    const s = newGame(7);
    const fleet = toggledCollapse('fleet', {}, s, true);
    expect(fleet).toEqual({ fleet: false });
    const ship = toggledCollapse('ship', fleet, s, true);
    expect(ship).toEqual({ ship: false });
    // Folding the open panel returns to all folded.
    expect(toggledCollapse('ship', ship, s, true)).toEqual({});
  });

  it('keeps explicit folded choices when another panel opens', () => {
    const s = newGame(7);
    expect(toggledCollapse('ship', { fleet: false, refinery: true }, s, true)).toEqual({
      refinery: true,
      ship: false,
    });
  });

  it('is not an accordion on a wide screen', () => {
    const s = newGame(7);
    expect(toggledCollapse('refinery', { fleet: false }, s)).toEqual({ fleet: false, refinery: false });
  });
});

describe('HUD DOM perf helpers', () => {
  afterEach(() => {
    resetDom();
  });

  it('bar().set() dirty-checks fill.style.width before writing', () => {
    resetDom();
    const b = bar('hull');
    const fill = b.el.childNodes[0] as unknown as { style: { width: string } };
    let writes = 0;
    let cur = '';
    Object.defineProperty(fill.style, 'width', {
      get: () => cur,
      set: (v: string) => {
        writes++;
        cur = v;
      },
    });
    b.set(0.5, '50/100');
    b.set(0.5001, '50/100');
    expect(cur).toBe('50.0%');
    expect(writes).toBe(1);
    b.set(0.75, '75/100');
    expect(cur).toBe('75.0%');
    expect(writes).toBe(2);
  });

  it('Panel.built tracks whether the panel has rendered at least once', () => {
    resetDom();
    const el = document.createElement('div');
    const p = new Panel(
      el,
      () => 'k',
      () => [document.createElement('h3')],
    );
    expect(p.built).toBe(false);
    p.refresh();
    expect(p.built).toBe(true);
    p.invalidate();
    expect(p.built).toBe(false);
  });

  it('refreshes collapsed #fleet and #ship headings without rebuilding their bodies', () => {
    resetDom();
    const state = newGame(7);
    const settings = new SettingsStore(memStorage());
    settings.set({ hudCollapsed: { fleet: true, ship: true } });
    const root = document.createElement('div');
    document.body.append(root);
    const hud = new Hud(root, () => state, { send: () => {}, saves: {} as SaveActions }, settings);
    hud.refresh();

    const fleetEl = (root as unknown as FakeEl).querySelectorAll('#fleet')[0]!;
    const shipEl = (root as unknown as FakeEl).querySelectorAll('#ship')[0]!;
    const fleetHead = fleetEl.querySelectorAll('h3')[0]!;
    const shipHead = shipEl.querySelectorAll('h3')[0]!;
    const initialShipRows = fleetEl.querySelectorAll('.shiprow').length;
    expect(fleetHead.textContent).toContain('0/');
    expect(shipHead.textContent).toContain(state.run.ships[0]!.name);

    // Add a drone and select it while both panels stay collapsed.
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone Alpha', { x: 0, z: 0 });
    state.run.ships.push(drone);
    state.run.selectedId = drone.id;
    hud.refresh();

    // Headings update, while the collapsed fleet body is not rebuilt.
    expect(fleetHead.textContent).toContain('1/');
    expect(shipHead.textContent).toContain('Drone Alpha');
    expect(fleetEl.querySelectorAll('.shiprow').length).toBe(initialShipRows);
  });
});
