// An open dialog owns the keyboard. Input's own handler runs after the panels' Tab
// trap, so its guards decide whether a key reaches the ship or another panel.

import { afterEach, describe, expect, it } from 'vitest';
import { PAD } from '../src/gamepad';
import { Input } from '../src/input';
import { SettingsStore } from '../src/settings';
import { newGame } from '../src/sim/create';
import type { Command } from '../src/sim/commands';
import type { GameState } from '../src/sim/types';
import type { FakeEl } from './domStub';
import { pressKey, resetDom } from './domStub';
import { memStorage } from './memStorage';

afterEach(() => {
  resetDom();
});

/** A HUD stand-in: only the open flags and the hooks Input reaches. */
interface FakeHud {
  warpOpen: boolean;
  researchOpen: boolean;
  gateOpen: boolean;
  menu: { open: boolean };
  touch: { onAction: ((action: string) => void) | null; thrust: { x: number; z: number } };
  escape: () => boolean;
  toggleResearch: () => void;
}

const mount = (state: GameState): { hud: FakeHud; sent: Command[]; research: () => number; input: Input } => {
  resetDom();
  const doc = document as unknown as { createElement: (tag: string) => FakeEl; body: FakeEl };
  let research = 0;
  const hud: FakeHud = {
    warpOpen: false,
    researchOpen: false,
    gateOpen: false,
    menu: { open: false },
    touch: { onAction: null, thrust: { x: 0, z: 0 } },
    escape: () => false,
    toggleResearch: () => research++,
  };
  const sent: Command[] = [];
  const renderer = {
    canvas: doc.createElement('canvas'),
    follow: false,
    panPixels: () => {},
    zoomAt: () => {},
  };
  const input = new Input(
    renderer as never,
    hud as never,
    () => state,
    (c: Command) => sent.push(c),
    new SettingsStore(memStorage()),
    () => {},
  );
  return { hud, sent, research: () => research, input };
};

describe('keyboard while the warp picker is open', () => {
  it('does not cycle ships with Tab', () => {
    const { hud, sent } = mount(newGame(5));
    pressKey('Tab', false, 'Tab');
    expect(sent.map((c) => c.t)).toEqual(['select']);

    hud.warpOpen = true;
    sent.length = 0;
    pressKey('Tab', false, 'Tab');
    expect(sent).toEqual([]);
  });

  it('does not thrust with the arrow keys', () => {
    const { hud, input } = mount(newGame(5));
    hud.warpOpen = true;
    pressKey('ArrowLeft', false, 'ArrowLeft');
    expect(input.thrust()).toEqual({ x: 0, z: 0 });

    hud.warpOpen = false;
    pressKey('ArrowLeft', false, 'ArrowLeft');
    expect(input.thrust()).toEqual({ x: -1, z: 0 });
  });

  it('does not open Research with its key', () => {
    const { hud, research } = mount(newGame(5));
    hud.warpOpen = true;
    pressKey('r', false, 'KeyR');
    expect(research()).toBe(0);

    hud.warpOpen = false;
    pressKey('r', false, 'KeyR');
    expect(research()).toBe(1);
  });
});

const setPad = (pressed: number[]): void => {
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) }));
  const pad = { connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons };
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [pad] },
    configurable: true,
  });
};

describe('gamepad overlay precedence', () => {
  const prevNavigator = globalThis.navigator;
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
  });

  it('prefers an open .modal over #boot even when #boot comes later in the DOM', () => {
    const { input, hud } = mount(newGame(5));
    const doc = document as unknown as {
      createElement: (tag: string) => FakeEl;
      body: FakeEl;
      activeElement: FakeEl | null;
    };
    const modal = doc.createElement('div');
    modal.className = 'modal';
    const modalBtn = doc.createElement('button');
    modalBtn.textContent = 'Modal action';
    modal.append(modalBtn);

    const boot = doc.createElement('div');
    boot.id = 'boot';
    const bootBtn = doc.createElement('button');
    bootBtn.textContent = 'Continue';
    boot.append(bootBtn);

    // #boot is appended after .modal, matching index.html DOM order.
    doc.body.append(modal, boot);
    hud.menu.open = true;

    // First poll primes PadReader; second poll emits the D-pad edge.
    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.DOWN]);
    input.pollGamepad(0.016);
    expect(doc.activeElement).toBe(modalBtn);

    // Closing the modal falls back to #boot.
    modal.classList.add('hidden');
    hud.menu.open = false;
    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.DOWN]);
    input.pollGamepad(0.016);
    expect(doc.activeElement).toBe(bootBtn);
  });
});
