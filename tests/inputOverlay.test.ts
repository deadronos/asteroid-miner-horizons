// An open dialog owns the keyboard. Input's own handler runs after the panels' Tab
// trap, so its guards decide whether a key reaches the ship or another panel.

import { afterEach, describe, expect, it } from 'vitest';
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
