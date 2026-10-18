import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { queueRefine } from '../src/sim/refining';
import { refineryKey } from '../src/ui/panels/RefineryPanel';

// The panel rebuilds only when this key changes; distinct states must not collide.
describe('refineryKey', () => {
  it('is stable for identical states', () => {
    expect(refineryKey(newGame(7))).toBe(refineryKey(newGame(7)));
  });

  it('distinguishes seeds', () => {
    expect(refineryKey(newGame(7))).not.toBe(refineryKey(newGame(8)));
  });

  it('distinguishes system numbers', () => {
    const a = newGame(7);
    const b = newGame(7);
    b.run.system.number += 1;
    expect(refineryKey(a)).not.toBe(refineryKey(b));
  });

  it('distinguishes queued recipes', () => {
    const a = newGame(7);
    const b = newGame(7);
    queueRefine(a.run, 'alloy', 1);
    queueRefine(b.run, 'fuel', 1);
    expect(refineryKey(a)).not.toBe(refineryKey(b));
  });

  it('distinguishes job totals', () => {
    const a = newGame(7);
    const b = newGame(7);
    queueRefine(a.run, 'alloy', 1);
    queueRefine(b.run, 'alloy', 2);
    expect(refineryKey(a)).not.toBe(refineryKey(b));
  });

  it('is stable for an identical non-empty queue', () => {
    const a = newGame(7);
    const b = newGame(7);
    queueRefine(a.run, 'alloy', 3);
    queueRefine(b.run, 'alloy', 3);
    expect(refineryKey(a)).toBe(refineryKey(b));
  });
});
