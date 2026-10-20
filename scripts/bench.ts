// Headless tick benchmark (#12). A full fleet (flagship + max drones, all
// kept busy by the bot) runs 10 sim minutes in one system; only the tick()
// call is timed. Then the resulting save is checked to load back and written
// to a slot 100 times (the autosave cost) and exported compactly. Over budget
// prints a GitHub Actions warning but never fails.
//
//   npm run bench                     # print results
//   npm run bench -- --json out.json  # also write them as JSON
//   BENCH_BUDGET_MS=0.3 npm run bench # override the mean ms/tick budget

import { writeFileSync } from 'node:fs';
import { newGame } from '../src/sim/create';
import { PERKS } from '../src/data/perks';
import { exportCompact, loadsBack, writeSlot } from '../src/sim/save';
import { droneCount, fleetCap } from '../src/sim/ships';
import { runBot } from './harness';

const SEED = 12345;
const WARMUP_SEC = 30;
const RUN_SEC = 600;
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? 0.1);
/** An autosave must fit inside one 60 fps frame even before it is moved to idle time. */
const SAVE_BUDGET_MS = 16;
const SAVE_RUNS = 100;

const state = newGame(SEED);
state.profile.perks.bay = PERKS.bay.max;
// Enough of everything that the bot fills the fleet and upgrades freely.
state.run.bank = { ore: 1e7, ice: 1e7, crystal: 1e5, alloy: 0, fuel: 0 };

runBot(state, { seconds: WARMUP_SEC, warp: false });

const times = new Float64Array(Math.round(RUN_SEC * 60));
let n = 0;
const wall0 = performance.now();
runBot(state, {
  seconds: RUN_SEC,
  warp: false,
  step: (doTick) => {
    const t0 = performance.now();
    doTick();
    times[n++] = performance.now() - t0;
  },
});
const wallSec = (performance.now() - wall0) / 1000;

// A stand-in for localStorage that keeps the last write, so the save is really built.
let saved = '';
Object.defineProperty(globalThis, 'localStorage', {
  value: { setItem: (_k: string, v: string) => void (saved = v) },
  configurable: true,
});
const saveTimes = new Float64Array(SAVE_RUNS);
for (let i = 0; i < SAVE_RUNS; i++) {
  const t0 = performance.now();
  if (!loadsBack(state)) throw new Error('the bench save would not load back');
  writeSlot(0, state);
  saveTimes[i] = performance.now() - t0;
}
const saveSorted = saveTimes.toSorted();
const compact = await exportCompact(state);

const sorted = times.subarray(0, n).toSorted();
const pct = (p: number): number => sorted[Math.min(n - 1, Math.floor(n * p))]!;
const mean = sorted.reduce((a, b) => a + b, 0) / n;
const result = {
  ships: state.run.ships.length,
  drones: `${droneCount(state.run)}/${fleetCap(state.profile)}`,
  rocks: state.run.rocks.length,
  ticks: n,
  meanMs: +mean.toFixed(4),
  p95Ms: +pct(0.95).toFixed(4),
  p99Ms: +pct(0.99).toFixed(4),
  maxMs: +sorted[n - 1]!.toFixed(4),
  ticksPerSec: Math.round(n / wallSec),
  budgetMs: BUDGET_MS,
  saveBytes: saved.length,
  exportBytes: compact.length,
  saveMeanMs: +(saveSorted.reduce((a, b) => a + b, 0) / SAVE_RUNS).toFixed(4),
  saveMaxMs: +saveSorted[SAVE_RUNS - 1]!.toFixed(4),
};

console.log(
  `tick bench · ${result.ships} ships (${result.drones} drones) · ${result.rocks} rocks · ${n} ticks (${RUN_SEC / 60} sim min)`,
);
console.log(
  `  mean ${result.meanMs} ms · p95 ${result.p95Ms} ms · p99 ${result.p99Ms} ms · max ${result.maxMs} ms · ${result.ticksPerSec} ticks/s`,
);
console.log(
  `  save ${result.saveBytes} B · export ${result.exportBytes} B (${Math.round((100 * result.exportBytes) / result.saveBytes)}%) · write mean ${result.saveMeanMs} ms · max ${result.saveMaxMs} ms`,
);
if (result.saveMaxMs > SAVE_BUDGET_MS) {
  console.log(
    `::warning title=Save benchmark::a slot write took ${result.saveMaxMs} ms, over the ${SAVE_BUDGET_MS} ms frame`,
  );
}
if (mean > BUDGET_MS) {
  console.log(`::warning title=Tick benchmark::mean ${result.meanMs} ms/tick is over the ${BUDGET_MS} ms budget`);
}

const jsonAt = process.argv.indexOf('--json');
if (jsonAt >= 0 && process.argv[jsonAt + 1]) writeFileSync(process.argv[jsonAt + 1]!, JSON.stringify(result, null, 2));
