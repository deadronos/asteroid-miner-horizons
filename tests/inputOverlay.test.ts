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

  it('triggers Research on LT and deploys an outpost on the nearest large rock on R3', () => {
    const state = newGame(5);
    const fs = state.run.ships[0]!;
    state.run.rocks = [
      {
        id: 10,
        kind: 'ore',
        size: 1,
        pos: { x: fs.pos.x + 20, z: fs.pos.z },
        vel: { x: 0, z: 0 },
        radius: 15,
        hp: 10,
        maxHp: 10,
        units: 10,
        belt: 0,
      },
      {
        id: 20,
        kind: 'ore',
        size: 0,
        pos: { x: fs.pos.x + 80, z: fs.pos.z },
        vel: { x: 0, z: 0 },
        radius: 30,
        hp: 30,
        maxHp: 30,
        units: 30,
        belt: 0,
      },
      {
        id: 30,
        kind: 'ice',
        size: 0,
        pos: { x: fs.pos.x + 300, z: fs.pos.z },
        vel: { x: 0, z: 0 },
        radius: 30,
        hp: 30,
        maxHp: 30,
        units: 30,
        belt: 0,
      },
    ];
    const { input, sent, research } = mount(state);

    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.LT]);
    input.pollGamepad(0.016);
    expect(research()).toBe(1);

    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.R3]);
    input.pollGamepad(0.016);
    expect(sent).toEqual([{ t: 'deployOutpost', rockId: 20 }]);
  });

  it('steps a focused range slider with D-pad Left/Right instead of moving focus away', () => {
    const { input, hud } = mount(newGame(5));
    const doc = document as unknown as {
      createElement: (tag: string) => FakeEl;
      body: FakeEl;
      activeElement: FakeEl | null;
    };
    const modal = doc.createElement('div');
    modal.className = 'modal';
    const beforeBtn = doc.createElement('button');
    const slider = doc.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.25';
    slider.value = '0.5';
    const afterBtn = doc.createElement('button');
    modal.append(beforeBtn, slider, afterBtn);
    doc.body.append(modal);
    hud.menu.open = true;

    const events: string[] = [];
    slider.addEventListener('input', () => events.push(`input:${slider.value}`));
    slider.addEventListener('change', () => events.push(`change:${slider.value}`));
    slider.focus();

    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.RIGHT]);
    input.pollGamepad(0.016);
    expect(doc.activeElement).toBe(slider);
    expect(slider.value).toBe('0.75');
    expect(events).toEqual(['input:0.75', 'change:0.75']);

    // Stepping up to max clamps at 1; stepping further does not emit extra events.
    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.RIGHT]);
    input.pollGamepad(0.016);
    expect(slider.value).toBe('1');
    events.length = 0;
    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.RIGHT]);
    input.pollGamepad(0.016);
    expect(slider.value).toBe('1');
    expect(events).toEqual([]);

    // Stepping left decrements cleanly, while Down still moves focus to the next control.
    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.LEFT]);
    input.pollGamepad(0.016);
    expect(slider.value).toBe('0.75');
    expect(doc.activeElement).toBe(slider);

    setPad([]);
    input.pollGamepad(0.016);
    setPad([PAD.DOWN]);
    input.pollGamepad(0.016);
    expect(doc.activeElement).toBe(afterBtn);
  });
});
