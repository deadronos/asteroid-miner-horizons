import { describe, expect, it } from 'vitest';
import { runBot } from '../scripts/harness';
import { newGame } from '../src/sim/create';
import { droneCount } from '../src/sim/ships';

describe('balance bot', () => {
  it('mines, unloads and buys a drone in the first system', () => {
    const s = newGame(1000);
    runBot(s, { seconds: 600, after: (st) => droneCount(st.run) > 0 });
    expect(s.run.runValue).toBeGreaterThan(0);
    expect(droneCount(s.run)).toBeGreaterThan(0);
  });
});
