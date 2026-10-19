// Headless balance report (#43). The bot plays N seeds × M warps; we record
// pacing milestones, time and value per warp, and the income split between
// active play (flagship unloads + contract rewards) and automation (drones and
// haulers), then write a
// markdown report (default docs/balance.md). The mid-game active-play share is
// checked against the ≥40% target from #46.
//
//   npm run balance
//   npm run balance -- --seeds 10 --warps 5 --out docs/balance.md
//   npm run balance -- --hazards normal --out /tmp/hazards.md   (hazards are off by default)
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
import { formatCountdown } from '../src/core/format';
import { HAZARD_LEVEL_IDS, type HazardLevel } from '../src/data/hazards';
import { MODIFIER_IDS, MODIFIERS } from '../src/data/modifiers';
import { walletValue } from '../src/data/resources';
import { newGame } from '../src/sim/create';
import { isDocked } from '../src/sim/economy';
import { droneCount, fleetCap, isFlagship, isHauler } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { runBot } from './harness';

/** A warp that takes longer than this is reported as a wall and ends the seed. */
const WARP_CAP_SEC = 3600;
/** Systems counted as the mid-game: after the opening, before the late-game drone drift. */
const MID_GAME_START = 3;
const MID_GAME_END = 6;
/** Acceptance target for active play's share of income through the mid-game (#46). */
const ACTIVE_SHARE_TARGET = 0.4;

interface WarpStats {
  sec: number;
  value: number;
  hd: number;
  flagshipValue: number;
  droneValue: number;
  /** walletValue haulers unloaded (miner skims and outpost output). */
  haulerValue: number;
  /** Units outposts extracted this warp. */
  outpostUnits: number;
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

export function playSeed(seed: number, warps: number, hazards: HazardLevel = 'off'): SeedResult {
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
      haulerValue: 0,
      outpostUnits: 0,
      contractValue: 0,
      contracts: 0,
      alloy: 0,
      fuel: 0,
      mods: state.run.system.modifiers.join('+'),
    };
    const ran = runBot(state, {
      seconds: WARP_CAP_SEC,
      hazards,
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
            else if (isHauler(sh)) cur.haulerValue += before;
            else cur.droneValue += before;
          }
        }
        cur.value = s.run.runValue;
        cur.contractValue = s.run.contracts.rewardValue;
        cur.contracts = s.run.contracts.completed;
        cur.alloy = s.run.refinery.produced.alloy;
        cur.fuel = s.run.refinery.produced.fuel;
        cur.outpostUnits = s.run.automation.extracted;
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
  return formatCountdown(Math.round(sec));
}
const stat = (xs: number[], f: (n: number) => string): string =>
  xs.length ? `${f(median(xs))} (${f(Math.min(...xs))}–${f(Math.max(...xs))})` : '—';

const pct = (n: number): string => `${Math.round(n * 100)}%`;
/** All income in a warp: what the flagship, drones and haulers unloaded plus contract rewards. */
const warpIncome = (x: WarpStats): number => x.flagshipValue + x.droneValue + x.haulerValue + x.contractValue;
const share = (part: number, whole: number): number => part / Math.max(1, whole);
/**
 * Active-play share. Contract rewards are earned by the player's mining,
 * breaking and delivering, so they count as active play alongside the
 * flagship's own unloads (#46). Drones and haulers only earn by unloading.
 */
const activeShare = (x: WarpStats): number => share(x.flagshipValue + x.contractValue, warpIncome(x));

function report(results: SeedResult[], seeds: number, warps: number, seedStart: number, hazards: HazardLevel): string {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout.
  }
  const seedArg =
    (seedStart === 1000 ? '' : ` --seed-start ${seedStart}`) + (hazards === 'off' ? '' : ` --hazards ${hazards}`);
  const lines: string[] = [
    '# Balance report',
    '',
    `Generated by \`npm run balance -- --seeds ${seeds} --warps ${warps}${seedArg}\` at commit \`${commit}\`. The bot (\`scripts/bot.ts\`) plays the flagship; drones and haulers use their built-in AI. Times are sim time (m:ss). Cells show median (min–max) across seeds.`,
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
    '| System | Time in system | vs previous | > 2× prev | Value delivered | Value / min | HD earned | Active-play share | Flagship share | Drone share | Hauler share | Contract share | Contracts done | Refined ▣ / ◉ | Outpost units | Walls |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
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
      )} | ${stat(rows.map(activeShare), pct)} | ${stat(
        rows.map((x) => share(x.flagshipValue, warpIncome(x))),
        pct,
      )} | ${stat(
        rows.map((x) => share(x.droneValue, warpIncome(x))),
        pct,
      )} | ${stat(
        rows.map((x) => share(x.haulerValue, warpIncome(x))),
        pct,
      )} | ${stat(
        rows.map((x) => share(x.contractValue, warpIncome(x))),
        pct,
      )} | ${stat(
        rows.map((x) => x.contracts),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => x.alloy),
        (n) => `${Math.round(n)}`,
      )} / ${stat(
        rows.map((x) => x.fuel),
        (n) => `${Math.round(n)}`,
      )} | ${stat(
        rows.map((x) => x.outpostUnits),
        (n) => `${Math.round(n)}`,
      )} | ${walls ? `${walls} (cap ${WARP_CAP_SEC / 60} min)` : '—'} |`,
    );
  }
  // Acceptance check for #46: active play must stay ≥ 40% through the mid-game.
  const midSystems = (r: SeedResult): WarpStats[] => r.warps.slice(MID_GAME_START - 1, MID_GAME_END);
  const midRows = results.flatMap((r) => midSystems(r).filter((_, i) => r.wall !== MID_GAME_START - 1 + i));
  const midShares = midRows.map(activeShare);
  const midFlagship = midRows.reduce((n, x) => n + x.flagshipValue, 0);
  const midDrone = midRows.reduce((n, x) => n + x.droneValue, 0);
  const midHauler = midRows.reduce((n, x) => n + x.haulerValue, 0);
  const midContract = midRows.reduce((n, x) => n + x.contractValue, 0);
  const midIncome = midFlagship + midDrone + midHauler + midContract;
  const midPooled = share(midFlagship + midContract, midIncome);
  const perSystem = results.length
    ? `- Per system (median, min–max): ${Array.from({ length: MID_GAME_END - MID_GAME_START + 1 }, (_, i) => {
        const w = MID_GAME_START - 1 + i;
        const xs = results
          .map((r) => r.warps[w])
          .filter((x): x is WarpStats => !!x)
          .map(activeShare);
        return `${w + 1}: ${stat(xs, pct)}`;
      }).join(' · ')}`
    : '—';
  lines.push(
    '',
    '## Active-play share (#46)',
    '',
    `Active-play share is \`(flagship unloads + contract rewards) / all income\`, all income being flagship + drones + haulers + contracts. Contract rewards count as active play because the player earns them by mining, breaking and delivering; haulers (miner skims and outpost output, #39) count as idle play alongside drones. Target: **≥ ${pct(ACTIVE_SHARE_TARGET)} through the mid-game** (systems ${MID_GAME_START}–${MID_GAME_END}).`,
    '',
    `- Mid-game pooled (income-weighted, ${midShares.length} seed-warps): **${pct(midPooled)}** (flagship ${pct(midFlagship / Math.max(1, midIncome))} · drones ${pct(midDrone / Math.max(1, midIncome))} · haulers ${pct(midHauler / Math.max(1, midIncome))} · contracts ${pct(midContract / Math.max(1, midIncome))}) — **${midPooled >= ACTIVE_SHARE_TARGET ? 'PASS' : 'FAIL'}**`,
    `- Mid-game across seed-warps: median ${pct(median(midShares))}, ${pct(Math.min(...midShares))}–${pct(Math.max(...midShares))}`,
    perSystem,
  );
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
    'seed,system,sec,value,hd,flagship_value,drone_value,contract_value,contracts,alloy,fuel,wall,mods,hauler_value,outpost_units',
    ...results.flatMap((r) =>
      r.warps.map(
        (x, w) =>
          `${r.seed},${w + 1},${x.sec.toFixed(1)},${Math.round(x.value)},${x.hd},${Math.round(x.flagshipValue)},${Math.round(x.droneValue)},${Math.round(x.contractValue)},${x.contracts},${x.alloy},${x.fuel},${r.wall === w ? 1 : 0},${x.mods},${Math.round(x.haulerValue)},${Math.round(x.outpostUnits)}`,
      ),
    ),
    '```',
    '',
  );
  return lines.join('\n');
}

/** Plays seeds across a pool of worker threads; results come back in seed order. */
async function playAll(seedList: number[], warps: number, hazards: HazardLevel): Promise<SeedResult[]> {
  const results: SeedResult[] = Array.from({ length: seedList.length });
  let next = 0;
  const pool = Math.min(seedList.length, availableParallelism());
  await Promise.all(
    Array.from({ length: pool }, async () => {
      const worker = new Worker(new URL(import.meta.url), {
        execArgv: ['--import', 'tsx'],
        workerData: { warps, hazards },
      });
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
  const hazards = arg('hazards', 'off') as HazardLevel;
  if (!HAZARD_LEVEL_IDS.includes(hazards)) throw new Error(`--hazards must be one of ${HAZARD_LEVEL_IDS.join(', ')}`);
  const t0 = performance.now();
  const results = await playAll(
    Array.from({ length: seeds }, (_, i) => seedStart + i),
    warps,
    hazards,
  );
  writeFileSync(out, report(results, seeds, warps, seedStart, hazards));
  console.log(`wrote ${out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} else {
  const { warps, hazards } = workerData as { warps: number; hazards: HazardLevel };
  parentPort!.on('message', (seed: number) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads, not window
    parentPort!.postMessage(playSeed(seed, warps, hazards)),
  );
}
