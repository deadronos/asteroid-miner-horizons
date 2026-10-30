// Headless tick benchmark (#12). A full fleet (flagship + max drones, all
// kept busy by the bot) runs 10 sim minutes in one system; only the tick()
// call is timed. Then the resulting save is checked to load back and written
// to a slot 100 times (the autosave cost) and exported compactly. Over budget
// prints a GitHub Actions warning but never fails.
//
//   npm run bench                     # print results
//   npm run bench -- --json out.json  # also write them as JSON
//   npm run bench:stress              # opt-in stress mode (#159), see buildStress
//   BENCH_BUDGET_MS=0.3 npm run bench # override the mean ms/tick budget

import { writeFileSync } from 'node:fs';
import { fromAngle } from '../src/core/vec';
import { next, range } from '../src/core/rng';
import { PERKS } from '../src/data/perks';
import { TRAIT_IDS } from '../src/data/traits';
import { TUNING } from '../src/data/tuning';
import { newGame } from '../src/sim/create';
import { makeRock } from '../src/sim/generate';
import { makeShip } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { exportCompact, loadsBack, writeSlot } from '../src/sim/save';
import { droneCount, fleetCap } from '../src/sim/ships';
import { runBot } from './harness';

const STRESS = process.argv.includes('--stress');
const SEED = 12345;
const WARMUP_SEC = STRESS ? 5 : 30;
const RUN_SEC = STRESS ? 60 : 600;
/** Stress population: about what a long session with regrown belts could hold. */
const STRESS_ROCKS = 2000;
const STRESS_SHIPS = 50;
const STRESS_PICKUPS = 1000;
const STRESS_COMETS = 20;
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? (STRESS ? 1 : 0.1));
/** An autosave must fit inside one 60 fps frame even before it is moved to idle time. */
const SAVE_BUDGET_MS = 16;
const SAVE_RUNS = 100;

/**
 * Grows a fresh game to the stress population using the sim's own constructors: belt rocks cycling through
 * every trait (about 3 in 4 get one), live comets crossing the belts, scattered pickups and a drone fleet
 * past the normal cap (pushed directly, as `fleetCap` only gates the buy command).
 */
function buildStress(state: GameState): void {
  const { run } = state;
  const rng = run.rng;
  const belts = run.system.belts;
  run.rocks.length = 0;
  for (let i = 0; i < STRESS_ROCKS; i++) {
    const bi = i % belts.length;
    const b = belts[bi]!;
    const roll = next(rng);
    const size = roll < 0.22 ? 0 : roll < 0.6 ? 1 : 2;
    const kind = roll < 0.5 ? 'ore' : roll < 0.85 ? 'ice' : 'crystal';
    const trait = i % 4 === 3 ? null : TRAIT_IDS[i % TRAIT_IDS.length]!;
    const pos = fromAngle(range(rng, 0, Math.PI * 2), range(rng, b.inner, b.outer));
    run.rocks.push(makeRock(run, kind, size, pos, null, bi, trait));
  }
  for (let i = 0; i < STRESS_COMETS; i++) {
    const rock = makeRock(run, 'ice', 0, fromAngle(range(rng, 0, Math.PI * 2), TUNING.cometEdge * 0.5), null, 0);
    const a = range(rng, 0, Math.PI * 2);
    rock.vel = { x: Math.cos(a) * 60, z: Math.sin(a) * 60 };
    rock.comet = true;
    run.rocks.push(rock);
  }
  for (let i = 0; i < STRESS_PICKUPS; i++) {
    const b = belts[i % belts.length]!;
    run.pickups.push({
      id: run.nextId++,
      kind: i % 3 === 0 ? 'ice' : 'ore',
      amount: 5,
      pos: fromAngle(range(rng, 0, Math.PI * 2), range(rng, b.inner, b.outer)),
      vel: { x: 0, z: 0 },
      age: 0,
    });
  }
  const st = run.system.station.pos;
  for (let i = run.ships.length; i < STRESS_SHIPS; i++) {
    const pos = { x: st.x * 0.92 + range(rng, -80, 80), z: st.z * 0.92 + range(rng, -80, 80) };
    run.ships.push(makeShip(run, state.profile, 'drone', `Drone-${i}`, pos));
  }
}

const gc = (globalThis as { gc?: () => void }).gc;
const heapMB = (): number => {
  gc?.();
  return +(process.memoryUsage().heapUsed / 1048576).toFixed(1);
};

const state = newGame(SEED);
state.profile.perks.bay = PERKS.bay.max;
// Enough of everything that the bot fills the fleet and upgrades freely.
state.run.bank = { ore: 1e7, ice: 1e7, crystal: 1e5, alloy: 0, fuel: 0 };
if (STRESS) buildStress(state);

runBot(state, { seconds: WARMUP_SEC, warp: false, hazards: STRESS ? 'normal' : undefined });
const heapBeforeMB = heapMB();

const times = new Float64Array(Math.round(RUN_SEC * 60));
let n = 0;
const wall0 = performance.now();
runBot(state, {
  seconds: RUN_SEC,
  warp: false,
  hazards: STRESS ? 'normal' : undefined,
  step: (doTick) => {
    const t0 = performance.now();
    doTick();
    times[n++] = performance.now() - t0;
  },
});
const wallSec = (performance.now() - wall0) / 1000;
const heapAfterMB = heapMB();

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
  pickups: state.run.pickups.length,
  stress: STRESS,
  heapMB: gc ? heapAfterMB : null,
  heapGrowthMB: gc ? +(heapAfterMB - heapBeforeMB).toFixed(1) : null,
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
  `${STRESS ? 'STRESS ' : ''}tick bench · ${result.ships} ships (${result.drones} drones) · ${result.rocks} rocks · ${result.pickups} pickups · ${n} ticks (${RUN_SEC / 60} sim min)`,
);
console.log(
  `  mean ${result.meanMs} ms · p95 ${result.p95Ms} ms · p99 ${result.p99Ms} ms · max ${result.maxMs} ms · ${result.ticksPerSec} ticks/s`,
);
console.log(
  `  save ${result.saveBytes} B · export ${result.exportBytes} B (${Math.round((100 * result.exportBytes) / result.saveBytes)}%) · write mean ${result.saveMeanMs} ms · max ${result.saveMaxMs} ms`,
);
console.log(
  gc
    ? `  heap ${result.heapMB} MB after the run (${result.heapGrowthMB! >= 0 ? '+' : ''}${result.heapGrowthMB} MB over it)`
    : '  heap n/a (run with --expose-gc, e.g. npm run bench:stress)',
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
