// Per-tick allocation budget (#128). A full fleet ticks for 10 sim seconds and
// the heap growth across each tick() call is averaged. Ticks interrupted by a
// scavenge show a negative delta and are dropped, so no --expose-gc is needed.

import { describe, expect, it } from 'vitest';
import { runBot } from '../scripts/harness';
import { PERKS } from '../src/data/perks';
import { newGame } from '../src/sim/create';
import { droneCount, fleetCap, makeShip } from '../src/sim/ships';

/**
 * Mean bytes allocated per tick: ~22 KB measured on Node 24 (seed 12345 takes the odd doctrine: Ace Pilot,
 * Courier and Brawler; ~11 ships, ~250 rocks). Stable to about 2%. The headroom (#217) catches a per-rock
 * or per-ship allocation, not a single array copy. If a deliberate change moves the baseline, log `mean`
 * below to re-measure and keep roughly 25% headroom.
 */
const TICK_ALLOC_BUDGET = 28 * 1024;

// Tests compile without Node types (tsconfig `types: []`).
const { memoryUsage } = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;

describe('per-tick allocation', () => {
  it('stays within the budget with a full fleet', () => {
    const state = newGame(12345); // the bench's setup (scripts/bench.ts)
    state.profile.perks.bay = PERKS.bay.max;
    state.run.bank = { ore: 1e7, ice: 1e7, crystal: 1e5, alloy: 0, fuel: 0 };
    runBot(state, { seconds: 180, warp: false }); // fills the fleet and warms the JIT
    // Drones die and are rebought, so the count drifts; the bot had filled all 9 slots (9/9) here,
    // before the hand-added builder below.
    expect(droneCount(state.run)).toBeGreaterThanOrEqual(fleetCap(state.profile) - 2);

    // A construction drone joins the fleet by hand, warmed up so its first-tick records don't count.
    const st = state.run.system.station.pos;
    state.run.ships.push(makeShip(state.run, state.profile, 'constructionDrone', 'Builder', { ...st }));
    runBot(state, { seconds: 5, warp: false });

    // The builder's deploy path is covered deterministically in builder.test.ts; here only its steady-state
    // per-tick cost is measured, so a slow approach cannot look like an allocation regression.
    const deltas: number[] = [];
    runBot(state, {
      seconds: 10,
      warp: false,
      step: (doTick) => {
        const before = memoryUsage().heapUsed;
        doTick();
        const d = memoryUsage().heapUsed - before;
        if (d >= 0) deltas.push(d);
      },
    });
    expect(deltas.length).toBeGreaterThan(500); // of 600: only a few ticks hit a GC
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    expect(mean).toBeLessThan(TICK_ALLOC_BUDGET);
  });
});
