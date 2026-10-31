import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { pingCue, researchCue, resourceReadout, topBarKey } from '../src/ui/panels/TopBar';

// The top bar rebuilds only when this key changes (warp, or a loaded slot with different modifiers).
describe('topBarKey', () => {
  it('is equal for equal inputs', () => {
    expect(topBarKey(newGame(7))).toBe(topBarKey(newGame(7)));
    const a = newGame(7);
    const b = newGame(7);
    a.run.system.modifiers = ['nebula'];
    b.run.system.modifiers = ['nebula'];
    expect(topBarKey(a)).toBe(topBarKey(b));
  });

  describe('resourceReadout', () => {
    it('adds a short letter tag so resources are distinguishable without color', () => {
      expect(resourceReadout('ore', 12)).toBe('OR ⬢ 12');
      expect(resourceReadout('ice', 8)).toBe('IC ❄ 8');
      expect(resourceReadout('crystal', 5)).toBe('CR ◆ 5');
      expect(resourceReadout('alloy', 3)).toBe('AL ▣ 3');
      expect(resourceReadout('fuel', 2)).toBe('FU ◉ 2');
    });

    it('reuses the top-bar number formatting', () => {
      expect(resourceReadout('fuel', 15321)).toBe('FU ◉ 15.3k');
    });
  });

  it('differs for the same system number with different modifiers', () => {
    const a = newGame(7);
    const b = newGame(7);
    b.run.system.modifiers = ['nebula'];
    expect(topBarKey(a)).not.toBe(topBarKey(b));
  });

  it('names the doctrine respec on the Research button while the window is open', () => {
    expect(researchCue(true)).toEqual({ text: 'Research · respec', label: 'Research. Doctrine respec open.' });
    expect(researchCue(false)).toEqual({ text: 'Research', label: 'Research' });
  });

  it('shows the ping cooldown in whole seconds and re-enables only when ready', () => {
    expect(pingCue(0)).toEqual({ text: 'Ping ◉', label: 'Sensor ping ready', disabled: false, seconds: 0 });
    expect(pingCue(0.4)).toMatchObject({ text: 'Ping 1s', disabled: true, seconds: 1 });
    expect(pingCue(12.2)).toMatchObject({ text: 'Ping 13s', disabled: true, seconds: 13 });
    expect(pingCue(-3)).toMatchObject({ text: 'Ping ◉', disabled: false });
  });

  it('differs for different system numbers', () => {
    const a = newGame(7);
    const b = newGame(7);
    b.run.system.number = a.run.system.number + 1;
    expect(topBarKey(a)).not.toBe(topBarKey(b));
  });
});
