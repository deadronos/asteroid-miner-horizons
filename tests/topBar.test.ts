import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { topBarKey } from '../src/ui/panels/TopBar';

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

  it('differs for the same system number with different modifiers', () => {
    const a = newGame(7);
    const b = newGame(7);
    b.run.system.modifiers = ['nebula'];
    expect(topBarKey(a)).not.toBe(topBarKey(b));
  });

  it('differs for different system numbers', () => {
    const a = newGame(7);
    const b = newGame(7);
    b.run.system.number = a.run.system.number + 1;
    expect(topBarKey(a)).not.toBe(topBarKey(b));
  });
});
