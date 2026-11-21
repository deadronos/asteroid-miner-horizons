import { afterEach, describe, expect, it } from 'vitest';
import type { SaveActions } from '../src/session';
import { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import { queueRefine } from '../src/sim/refining';
import { makeShip } from '../src/sim/ships';
import type { Command } from '../src/sim/commands';
import { Hud } from '../src/ui/Hud';
import { Menu } from '../src/ui/Menu';
import { nextFocusIndex } from '../src/ui/focus';
import { createFleetPanel } from '../src/ui/panels/FleetPanel';
import { createRefineryPanel } from '../src/ui/panels/RefineryPanel';
import { createShipPanel } from '../src/ui/panels/ShipPanel';
import type { FakeEl } from './domStub';
import { resetDom } from './domStub';
import { memStorage } from './memStorage';

// The menu's Tab trap: forward/backward wrap, entering from outside, and a single item.
describe('nextFocusIndex', () => {
  it('wraps forward from the last item to the first', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, false)).toBe(1);
  });

  it('wraps backward from the first item to the last', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });

  it('enters at the matching end when the index is outside the list', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, 3, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(3, 7, true)).toBe(2);
  });

  it('stays on the only item when there is one', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
    expect(nextFocusIndex(1, -1, false)).toBe(0);
  });

  it('reports nothing to focus when the list is empty', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });
});

const fireKey = (el: FakeEl, key: string): { prevented: boolean; stopped: boolean } => {
  const res = { prevented: false, stopped: false };
  el.dispatch('keydown', {
    key,
    target: el,
    preventDefault: () => {
      res.prevented = true;
    },
    stopPropagation: () => {
      res.stopped = true;
    },
  } as unknown as Event);
  return res;
};

describe('UI accessibility (#272)', () => {
  afterEach(() => {
    resetDom();
  });

  it('makes fleet ship rows keyboard-focusable with role, aria-current and Enter/Space activation, but not outpost rows', () => {
    resetDom();
    const state = newGame(3);
    const drone = makeShip(state.run, state.profile, 'drone', 'Drone 1', { x: 0, z: 0 });
    state.run.ships.push(drone);
    state.run.automation.outposts.push({
      rockId: 1,
      kind: 'ore',
      pos: { x: 10, z: 0 },
      stored: { ore: 0, ice: 0, crystal: 0, alloy: 0, fuel: 0 },
      reserve: 100,
    });
    const sent: Command[] = [];
    const root = document.createElement('div');
    const panel = createFleetPanel(root, {
      getState: () => state,
      send: (c) => sent.push(c),
      settings: new SettingsStore(memStorage()),
    });
    panel.refresh();

    const rows = (root as unknown as FakeEl).querySelectorAll('.shiprow');
    expect(rows.length).toBe(3);
    const [flagRow, droneRow, outpostRow] = rows as [FakeEl, FakeEl, FakeEl];

    expect(flagRow.getAttribute('tabindex')).toBe('0');
    expect(flagRow.getAttribute('role')).toBe('button');
    expect(flagRow.getAttribute('aria-current')).toBe('true');

    expect(droneRow.getAttribute('tabindex')).toBe('0');
    expect(droneRow.getAttribute('role')).toBe('button');
    expect(droneRow.getAttribute('aria-current')).toBeNull();

    expect(fireKey(droneRow, 'Enter')).toEqual({ prevented: true, stopped: true });
    expect(fireKey(droneRow, ' ')).toEqual({ prevented: true, stopped: true });
    expect(sent).toEqual([
      { t: 'select', shipId: drone.id },
      { t: 'select', shipId: drone.id },
    ]);

    expect(outpostRow.classList.contains('outpost')).toBe(true);
    expect(outpostRow.getAttribute('role')).toBeNull();
    expect(outpostRow.getAttribute('tabindex')).toBeNull();
  });

  it('gives Menu tabs role=tablist/tab, aria-selected and Left/Right arrow switching', () => {
    resetDom();
    const state = newGame(3);
    const root = document.createElement('div');
    document.body.append(root);
    const saves = {
      current: () => state,
      activeSlot: () => 0,
      slotStatus: () => ({ kind: 'empty' }),
      list: () => [],
      active: () => 0,
      newGame: () => {},
      load: () => {},
      clear: () => {},
      exportSlot: () => '',
      importSlot: () => null,
      rename: () => {},
    } as unknown as SaveActions;
    const menu = new Menu(root, saves, new SettingsStore(memStorage()), () => state);
    menu.toggle(true);

    const tabBar = (root as unknown as FakeEl).querySelectorAll('.tabs')[0]!;
    expect(tabBar.getAttribute('role')).toBe('tablist');
    const tabs = tabBar.querySelectorAll('button');
    expect(tabs[0]!.getAttribute('role')).toBe('tab');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');

    fireKey(tabBar, 'ArrowRight');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect((document as unknown as { activeElement: FakeEl }).activeElement).toBe(tabs[1]);

    fireKey(tabBar, 'ArrowLeft');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect((document as unknown as { activeElement: FakeEl }).activeElement).toBe(tabs[0]);
  });

  it('sets ARIA live regions on Hud banners, toasts and log', () => {
    resetDom();
    const state = newGame(3);
    const root = document.createElement('div');
    document.body.append(root);
    const hud = new Hud(
      root,
      () => state,
      { send: () => {}, saves: {} as SaveActions },
      new SettingsStore(memStorage()),
    );
    const stack = (root as unknown as FakeEl).querySelectorAll('.hud-stack')[0]!;
    const paused = stack.childNodes.find((c) => c.classList.contains('paused'))!;
    const hazard = stack.childNodes.find((c) => c.classList.contains('hazard'))!;
    const toasts = stack.childNodes.find((c) => c.classList.contains('toasts'))!;
    const log = (root as unknown as FakeEl).querySelectorAll('#log')[0]!;

    expect(hazard.getAttribute('role')).toBe('alert');
    expect(hazard.getAttribute('aria-live')).toBe('assertive');
    expect(toasts.getAttribute('role')).toBe('status');
    expect(toasts.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('role')).toBe('status');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(paused.getAttribute('role')).toBe('status');
    expect(paused.getAttribute('aria-live')).toBe('polite');

    hud.showNotice('Graphics lost', { label: 'Reload', onClick: () => {} });
    expect(paused.getAttribute('role')).toBe('alert');
    expect(paused.getAttribute('aria-live')).toBe('assertive');
    hud.clearNotice();
    expect(paused.getAttribute('role')).toBe('status');
    expect(paused.getAttribute('aria-live')).toBe('polite');
  });

  it('labels icon-only remove/cancel buttons and empty-slot selects in ShipPanel and RefineryPanel', () => {
    resetDom();
    const state = newGame(3);
    state.run.ships[0]!.slots = [{ type: 'laser', variant: 'focused', tier: 1 }, null];
    state.run.bank.ore = 1000;
    queueRefine(state.run, 'alloy', 1);

    const shipRoot = document.createElement('div');
    const shipPanel = createShipPanel(shipRoot, {
      getState: () => state,
      send: () => {},
      settings: new SettingsStore(memStorage()),
    });
    shipPanel.refresh();
    const rmBtn = (shipRoot as unknown as FakeEl).querySelectorAll('button').find((b) => b.textContent === '✕');
    const select = (shipRoot as unknown as FakeEl).querySelectorAll('select')[0];
    expect(rmBtn?.getAttribute('aria-label')).toContain('Remove');
    expect(select?.getAttribute('aria-label')).toBe('Install component in slot 2');

    const refRoot = document.createElement('div');
    const refPanel = createRefineryPanel(refRoot, {
      getState: () => state,
      send: () => {},
      settings: new SettingsStore(memStorage()),
    });
    refPanel.refresh();
    const cancelBtn = (refRoot as unknown as FakeEl).querySelectorAll('button').find((b) => b.textContent === '✕');
    expect(cancelBtn?.getAttribute('aria-label')).toContain('Cancel');
  });
});
