// Headless balance report (#43). The bot plays N seeds × M warps; we record
// pacing milestones, time and value per warp, and drone vs flagship income,
// then write a markdown report (default docs/balance.md).
//
//   npm run balance
//   npm run balance -- --seeds 10 --warps 5 --out docs/balance.md
//
// The per-warp table counts seeds whose time more than doubles (> 2× prev), and
// a modifiers table compares each modifier's time to its system median.
//
// Seeds run in parallel worker threads (each has its own sim module state),
// so results are identical to a sequential run.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MODIFIER_IDS, MODIFIERS } from '../src/data/modifiers';
import { walletValue } from '../src/data/resources';
import { newGame } from '../src/sim/create';
import { isDocked } from '../src/sim/economy';
import { droneCount, fleetCap, isFlagship } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { runBot } from './harness';

/** A warp that takes longer than this is reported as a wall and ends the seed. */
const WARP_CAP_SEC = 3600;

interface WarpStats {
  sec: number;
  value: number;
  hd: number;
  flagshipValue: number;
  droneValue: number;
  /** walletValue of contract rewards paid this warp. */
  contractValue: number;
  /** Contracts completed this warp. */
  contracts: number;
  /** Refinery alloy produced this warp. */
  alloy: number;
  /** Refinery fuel produced this warp. */
  fuel: number;
  /** The system's modifier ids joined with '+'; empty when it has none. */
  mods: string;
}

interface SeedResult {
  seed: number;
  /** Sim seconds from game start, or null if never reached. */
  firstPurchase: number | null;
  firstT2: number | null;
  firstDrone: number | null;
  fleetFull: number | null;
  warps: WarpStats[];
  /** Index of the warp that hit WARP_CAP_SEC, if any. */
  wall: number | null;
}

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const tierSum = (s: GameState): number =>
  s.run.ships.filter(isFlagship).reduce((n, sh) => n + sh.slots.reduce((m, f) => m + (f?.tier ?? 0), 0), 0);

export function playSeed(seed: number, warps: number): SeedResult {
  const state = newGame(seed);
  const res: SeedResult = {
    seed,
    firstPurchase: null,
    firstT2: null,
    firstDrone: null,
    fleetFull: null,
    warps: [],
    wall: null,
  };
  let clock = 0;
  const startTiers = tierSum(state);
  const cargoBefore = new Map<number, number>();

  for (let w = 0; w < warps; w++) {
    const startWarps = state.profile.warps;
    const earnedBefore = state.profile.dataEarned;
    const cur: WarpStats = {
      sec: 0,
      value: 0,
      hd: 0,
      flagshipValue: 0,
      droneValue: 0,
      contractValue: 0,
      contracts: 0,
      alloy: 0,
      fuel: 0,
      mods: state.run.system.modifiers.join('+'),
    };
    const ran = runBot(state, {
      seconds: WARP_CAP_SEC,
      before: (s) => {
        cargoBefore.clear();
        for (const sh of s.run.ships) cargoBefore.set(sh.id, walletValue(sh.cargo));
      },
      after: (s) => {
        if (s.profile.warps !== startWarps) return true;
        const t = clock + s.run.time;
        if (w === 0) {
          if (res.firstPurchase == null && (tierSum(s) > startTiers || droneCount(s.run) > 0)) res.firstPurchase = t;
          if (res.firstT2 == null && s.run.ships.some((sh) => sh.slots.some((f) => (f?.tier ?? 0) >= 2)))
            res.firstT2 = t;
          if (res.firstDrone == null && droneCount(s.run) > 0) res.firstDrone = t;
          if (res.fleetFull == null && droneCount(s.run) >= fleetCap(s.profile)) res.fleetFull = t;
        }
        // Credit each unload to whoever made it.
        for (const sh of s.run.ships) {
          const before = cargoBefore.get(sh.id) ?? 0;
          if (before > 0 && walletValue(sh.cargo) === 0 && isDocked(s.run, sh)) {
            if (isFlagship(sh)) cur.flagshipValue += before;
            else cur.droneValue += before;
          }
        }
        cur.value = s.run.runValue;
        cur.contractValue = s.run.contracts.rewardValue;
        cur.contracts = s.run.contracts.completed;
        cur.alloy = s.run.refinery.produced.alloy;
        cur.fuel = s.run.refinery.produced.fuel;
      },
    });
    cur.sec = ran;
    clock += ran;
    if (state.profile.warps === startWarps) {
      res.wall = w;
      res.warps.push(cur);
      break;
    }
    cur.hd = state.profile.dataEarned - earnedBefore;
    res.warps.push(cur);
  }
  return res;
}

// ---------- report ----------
const median = (xs: number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
function mmss(sec: number | null): string {
  if (sec == null) return '—';
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
const stat = (xs: number[], f: (n: number) => string): string =>
  xs.length ? `${f(median(xs))} (${f(Math.min(...xs))}–${f(Math.max(...xs))})` : '—';

function report(results: SeedResult[], seeds: number, warps: number, seedStart: number): string {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout.
  }
  const seedArg = seedStart === 1000 ? '' : ` --seed-start ${seedStart}`;
  const lines: string[] = [
    '# Balance report',
    '',
    `Generated by \`npm run balance -- --seeds ${seeds} --warps ${warps}${seedArg}\` at commit \`${commit}\`. The bot (\`scripts/bot.ts\`) plays the flagship; drones use their built-in AI. Times are sim time (m:ss). Cells show median (min–max) across seeds.`,
    '',
    '## Opening (system 1)',
    '',
    '| Milestone | Time |',
    '| --- | --- |',
  ];
  const ms = (k: 'firstPurchase' | 'firstT2' | 'firstDrone' | 'fleetFull'): string => {
    const xs = results.map((r) => r[k]).filter((x): x is number => x != null);
    const missing = results.length - xs.length;
    return stat(xs, mmss) + (missing ? ` · not reached in ${missing}` : '');
  };
  lines.push(
    `| First purchase | ${ms('firstPurchase')} |`,
    `| First tier-2 upgrade | ${ms('firstT2')} |`,
    `| First drone | ${ms('firstDrone')} |`,
    `| Fleet full | ${ms('fleetFull')} |`,
    '',
    '## Per warp',
    '',
    '| System | Time in system | vs previous | > 2× prev | Value delivered | Value / min | HD earned | Drone share of income | Contract share of income | Contracts done | Refined ▣ / ◉ | Walls |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (let w = 0; w < warps; w++) {
    const rows = results.map((r) => r.warps[w]).filter((x): x is WarpStats => !!x);
    if (!rows.length) break;
    const done = results.filter((r) => r.warps[w] && r.wall !== w);
    const ratios = done
      .map((r) => (w > 0 && r.warps[w - 1] ? r.warps[w]!.sec / r.warps[w - 1]!.sec : NaN))
      .filter((x) => !Number.isNaN(x));
    const spikes = ratios.filter((x) => x > 2).length;
    const walls = results.filter((r) => r.wall === w).length;
    lines.push(
      `| ${w + 1} | ${stat(
        rows.map((x) => x.sec),
        mmss,
      )} | ${w > 0 ? stat(ratios, (n) => `${n.toFixed(2)}×`) : '—'} | ${w > 0 ? spikes : '—'} | ${stat(
        rows.map((x) => x.value),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => (x.value / x.sec) * 60),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => x.hd),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => x.droneValue / Math.max(1, x.droneValue + x.flagshipValue)),
        (n) => `${Math.round(n * 100)}%`,
      )} | ${stat(
        rows.map((x) => x.contractValue / Math.max(1, x.value + x.contractValue)),
        (n) => `${Math.round(n * 100)}%`,
      )} | ${stat(
        rows.map((x) => x.contracts),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => x.alloy),
        (n) => `${Math.round(n)}`,
      )} / ${stat(
        rows.map((x) => x.fuel),
        (n) => `${Math.round(n)}`,
      )} | ${walls ? `${walls} (cap ${WARP_CAP_SEC / 60} min)` : '—'} |`,
    );
  }
  lines.push(
    '',
    '## Modifiers',
    '',
    'Time in system relative to the median of all non-wall seeds at that system.',
    '',
    '| Modifier | Seed-warps | Time vs system median |',
    '| --- | --- | --- |',
  );
  const sysMedian = new Map<number, number>();
  for (let w = 0; w < warps; w++) {
    const secs = results.filter((r) => r.warps[w] && r.wall !== w).map((r) => r.warps[w]!.sec);
    if (secs.length) sysMedian.set(w, median(secs));
  }
  const modRow = (label: string, pick: (x: WarpStats) => boolean): string => {
    const rel: number[] = [];
    let n = 0;
    for (const r of results)
      r.warps.forEach((x, w) => {
        if (!pick(x)) return;
        n++;
        if (r.wall !== w) rel.push(x.sec / sysMedian.get(w)!);
      });
    return `| ${label} | ${n} | ${stat(rel, (v) => `${v.toFixed(2)}×`)} |`;
  };
  for (const id of MODIFIER_IDS) lines.push(modRow(MODIFIERS[id].name, (x) => x.mods.split('+').includes(id)));
  lines.push(
    '',
    '## Raw data',
    '',
    '```csv',
    'seed,system,sec,value,hd,flagship_value,drone_value,contract_value,contracts,alloy,fuel,wall,mods',
    ...results.flatMap((r) =>
      r.warps.map(
        (x, w) =>
          `${r.seed},${w + 1},${x.sec.toFixed(1)},${Math.round(x.value)},${x.hd},${Math.round(x.flagshipValue)},${Math.round(x.droneValue)},${Math.round(x.contractValue)},${x.contracts},${x.alloy},${x.fuel},${r.wall === w ? 1 : 0},${x.mods}`,
      ),
    ),
    '```',
    '',
  );
  return lines.join('\n');
}

/** Plays seeds across a pool of worker threads; results come back in seed order. */
async function playAll(seedList: number[], warps: number): Promise<SeedResult[]> {
  const results: SeedResult[] = Array.from({ length: seedList.length });
  let next = 0;
  const pool = Math.min(seedList.length, availableParallelism());
  await Promise.all(
    Array.from({ length: pool }, async () => {
      const worker = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx'], workerData: { warps } });
      try {
        while (next < seedList.length) {
          const i = next++;
          // Each worker plays its seeds one after another; the pool supplies the parallelism.
          // oxlint-disable-next-line no-await-in-loop
          results[i] = await new Promise<SeedResult>((resolve, reject) => {
            worker.once('message', resolve);
            worker.once('error', reject);
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads, not window
            worker.postMessage(seedList[i]);
          });
          console.log(`seed ${seedList[i]}: ${results[i].warps.map((w) => mmss(w.sec)).join(' · ')}`);
        }
      } finally {
        await worker.terminate();
      }
    }),
  );
  return results;
}

if (isMainThread) {
  const seeds = Number(arg('seeds', '10'));
  const warps = Number(arg('warps', '5'));
  const seedStart = Number(arg('seed-start', '1000'));
  const out = arg('out', 'docs/balance.md');
  const t0 = performance.now();
  const results = await playAll(
    Array.from({ length: seeds }, (_, i) => seedStart + i),
    warps,
  );
  writeFileSync(out, report(results, seeds, warps, seedStart));
  console.log(`wrote ${out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} else {
  const { warps } = workerData as { warps: number };
  parentPort!.on('message', (seed: number) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads, not window
    parentPort!.postMessage(playSeed(seed, warps)),
  );
}
