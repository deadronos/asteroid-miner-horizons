import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { titleSummary } from '../src/ui/TitleScreen';

describe('title summary', () => {
  it('names the slot, system and time', () => {
    const state = newGame(4);
    expect(titleSummary(state, 2)).toBe(`Slot 3 · System ${state.run.system.number} · 0s`);
  });
});
