import { describe, expect, it } from 'vitest';
import { fromAngle } from '../src/core/vec';
import { newGame } from '../src/sim/create';
import { isDocked } from '../src/sim/economy';
import { flagship } from '../src/sim/ships';
import { tick } from '../src/sim/update';

describe('autopilot', () => {
  it('docks from across the belts without wrecking the hull', () => {
    let docked = 0;
    let hullLost = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const s = newGame(100 + i);
      const ship = flagship(s.run);
      const st = s.run.system.station.pos;
      // Start on the far side of the inner belt.
      ship.pos = fromAngle(Math.atan2(st.z, st.x) + ((i % 5) - 2) * 0.15, 560);
      const input = { thrust: { x: 0, z: 0 }, commands: [{ t: 'dock' as const, shipId: ship.id }] };
      for (let t = 0; t < 25; t += 1 / 60) tick(s, 1 / 60, input);
      if (isDocked(s.run, ship)) docked++;
      hullLost += 100 - ship.hull;
    }
    console.log(`docked ${docked}/${N}, avg hull lost ${(hullLost / N).toFixed(1)}`);
    expect(docked).toBeGreaterThanOrEqual(N - 1);
    expect(hullLost / N).toBeLessThan(10);
  });
});
