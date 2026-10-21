import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { queueRefine } from '../src/sim/refining';
import { HELP_AUTO_HIDE_SEC, autoCollapsed, helpVisible, isCollapsed, toggledCollapse } from '../src/ui/hudLayout';

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
