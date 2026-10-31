// Headless balance report (#43). The bot plays N seeds × M warps; we record
// pacing milestones, time and value per warp, and the income split between
// active play (flagship unloads + contract rewards) and automation (drones and
// haulers), then write a
// markdown report (default docs/balance.md). The mid-game active-play share is
// checked against the ≥40% target from #46.
//
//   npm run balance
//   npm run balance -- --seeds 30 --warps 10 --out docs/balance.md
//   npm run balance -- --hazards off --out /tmp/calm.md   (hazards default to 'normal', the game's default)
//
// The per-warp table counts seeds whose time more than doubles (> 2× prev),
// tracks the build-up milestones (first drone, first tier-2, peak drones) inside
// each system, since a warp starts a fresh run, and a modifiers table compares
// each modifier's time to its system median. The opening checks system 1's
// milestones against targets the player should reach before the first warp (#197).
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
import { droneCount, fleetCap, isBuilder, isFlagship, isHauler } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { runBot } from './harness';
import { createHazardMeter, DAMAGE_SOURCES, hullTotal, newTally, type HazardTally } from './hazardMeter';

/** A warp that takes longer than this is reported as a wall and ends the seed. */
const WARP_CAP_SEC = 3600;
/** Systems counted as the mid-game: after the opening, before the late-game drone drift. */
const MID_GAME_START = 3;
const MID_GAME_END = 6;
/** Acceptance target for active play's share of income through the mid-game (#46). */
const ACTIVE_SHARE_TARGET = 0.4;
/** By this system the refinery and an outpost should have shown up in most seeds (#206). */
const AUTOMATION_BY = 4;
/** Share of seeds that must have refined alloy and deployed an outpost by `AUTOMATION_BY` (#206). */
const AUTOMATION_TARGET_SHARE = 0.5;
/** From this system on the fleet should be nearly full when the player warps (#207). */
const FLEET_FROM = 4;
/** Median drones in the fleet at warp time required in each system from `FLEET_FROM` to the end of the mid-game. */
const FLEET_AT_WARP_TARGET = 4;
/** Systems whose outposts the builder row counts, and the share of them construction drones must place (#174). */
const BUILDER_FROM = 4;
const BUILDER_TO = 6;
const BUILDER_OUTPOST_TARGET = 0.5;
/** Share of seeds that must reach the opening target before the first warp (#197). */
const OPENING_TARGET_SHARE = 0.8;
/** Hazard level the report plays at unless --hazards says otherwise; matches the game's settings default. */
const DEFAULT_HAZARDS: HazardLevel = 'normal';

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
  /** Outposts placed this warp by a construction drone. */
  builderOutposts: number;
  /** Outposts placed this warp by the flagship's own deploy command. */
  flagshipOutposts: number;
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
  /** Seconds into this system the first drone flew, or null if none did. */
  firstDrone: number | null;
  /** Seconds into this system any ship first fitted a tier-2+ component, or null. */
  firstT2: number | null;
  /** Seconds into this system the flagship's laser first reached tier 2, or null. */
  firstLaserT2: number | null;
  /** Hazard damage, losses and repair spend this warp (#208). */
  hazard: HazardTally;
  /** Most drones in the fleet at once during this system. */
  peakDrones: number;
  /** Drones in the fleet on the last tick before the warp (what the player takes into the fuel stop). */
  fleetAtWarp: number;
  /** Fleet cap when the system ended (it grows with the bay perk). */
  fleetCap: number;
}

interface SeedResult {
  seed: number;
  /** Sim seconds from game start, or null if never reached. */
  firstPurchase: number | null;
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

/** Tier of the flagship's laser, 0 without one. */
const laserTier = (s: GameState): number =>
  s.run.ships.find(isFlagship)?.slots.find((f) => f?.type === 'laser')?.tier ?? 0;

export function playSeed(seed: number, warps: number, hazards: HazardLevel = 'off'): SeedResult {
  const state = newGame(seed);
  const res: SeedResult = {
    seed,
    firstPurchase: null,
    warps: [],
    wall: null,
  };
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
      builderOutposts: 0,
      flagshipOutposts: 0,
      contractValue: 0,
      contracts: 0,
      alloy: 0,
      fuel: 0,
      mods: state.run.system.modifiers.join('+'),
      hazard: newTally(),
      firstDrone: null,
      firstT2: null,
      firstLaserT2: null,
      peakDrones: 0,
      fleetAtWarp: 0,
      fleetCap: fleetCap(state.profile),
    };
    // Outposts seen last tick, and the flagship deploy commands queued for the tick about to run.
    let seenOutposts = state.run.automation.outposts.length;
    let flagshipDeploys = 0;
    const meter = createHazardMeter(state, hazards);
    cur.hazard = meter.tally;
    const ran = runBot(state, {
      seconds: WARP_CAP_SEC,
      hazards,
      commands: (cmds) => {
        flagshipDeploys = cmds.filter((c) => c.t === 'deployOutpost').length;
      },
      before: (s) => {
        meter.before(s);
        cargoBefore.clear();
        for (const sh of s.run.ships) cargoBefore.set(sh.id, walletValue(sh.cargo));
      },
      after: (s) => {
        meter.after(s);
        if (s.profile.warps !== startWarps) return true;
        const t = s.run.time;
        const drones = droneCount(s.run);
        if (w === 0 && res.firstPurchase == null && (tierSum(s) > startTiers || drones > 0)) res.firstPurchase = t;
        if (cur.firstT2 == null && s.run.ships.some((sh) => sh.slots.some((f) => (f?.tier ?? 0) >= 2))) cur.firstT2 = t;
        if (cur.firstDrone == null && drones > 0) cur.firstDrone = t;
        if (cur.firstLaserT2 == null && laserTier(s) >= 2) cur.firstLaserT2 = t;
        cur.peakDrones = Math.max(cur.peakDrones, drones);
        cur.fleetAtWarp = drones;
        cur.fleetCap = fleetCap(s.profile);
        // Credit each unload to whoever made it.
        for (const sh of s.run.ships) {
          const before = cargoBefore.get(sh.id) ?? 0;
          if (before > 0 && walletValue(sh.cargo) === 0 && isDocked(s.run, sh)) {
            if (isFlagship(sh)) cur.flagshipValue += before;
            else if (isHauler(sh) || isBuilder(sh)) cur.haulerValue += before;
            else cur.droneValue += before;
          }
        }
        cur.value = s.run.runValue;
        cur.contractValue = s.run.contracts.rewardValue;
        cur.contracts = s.run.contracts.completed;
        cur.alloy = s.run.refinery.produced.alloy;
        cur.fuel = s.run.refinery.produced.fuel;
        cur.outpostUnits = s.run.automation.extracted;
        // A new outpost is the flagship's when it queued a deploy this tick, else a construction drone's.
        const placed = Math.max(0, s.run.automation.outposts.length - seenOutposts);
        const byFlagship = Math.min(placed, flagshipDeploys);
        cur.flagshipOutposts += byFlagship;
        cur.builderOutposts += placed - byFlagship;
        seenOutposts = s.run.automation.outposts.length;
        flagshipDeploys = 0;
      },
    });
    cur.sec = ran;
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

/** Median (min–max) time of the reached entries, plus how many never got there. */
const reached = (ts: (number | null)[]): string => {
  const xs = ts.filter((x): x is number => x != null);
  const missing = ts.length - xs.length;
  return stat(xs, mmss) + (missing ? ` · not reached in ${missing}` : '');
};

/** How many of `ts` were reached, as `hit/total`. */
const count = (ts: (number | null)[]): string => `${ts.filter((x) => x != null).length}/${ts.length}`;

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

/**
 * Baselines for the #174 collision row, taken from `npm run balance:ci` at commit 0e525b1 (before pilots braked for
 * rocks): the collision metric below and the mid-game median value/min, both rounded to whole numbers.
 */
const COLLISION_BASELINE = 165;
const VALUE_PER_MIN_BASELINE = 392;
/** Collision damage must fall to this share of the baseline... */
const COLLISION_TARGET_SHARE = 2 / 3;
/** ...without mid-game value/min dropping below this share of its baseline (no buying safety with slow flight). */
const VALUE_GUARD_SHARE = 0.95;

/** Systems whose collision damage the #174 row compares against the baseline. */
const COLLISION_FROM = 3;
const COLLISION_TO = 10;

/**
 * Collision damage metric: the mean over systems COLLISION_FROM..COLLISION_TO of that system's median (across seeds)
 * collision hull loss. Systems nobody reached are skipped.
 */
function collisionMetric(results: SeedResult[]): number {
  const per: number[] = [];
  for (let w = COLLISION_FROM - 1; w < COLLISION_TO; w++) {
    const xs = results.flatMap((r) => (r.warps[w] ? [r.warps[w]!.hazard.hull.collision] : []));
    if (xs.length) per.push(median(xs));
  }
  return per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0;
}

/** Median value/min over every finished mid-game seed-warp (the same systems the active-play target uses). */
function midValuePerMin(results: SeedResult[]): number {
  const xs = results.flatMap((r) =>
    r.warps
      .slice(MID_GAME_START - 1, MID_GAME_END)
      .flatMap((x, i) => (r.wall === MID_GAME_START - 1 + i ? [] : [(x.value / x.sec) * 60])),
  );
  return xs.length ? median(xs) : 0;
}

const dmg = (n: number): string => n.toFixed(n < 10 ? 1 : 0);
const whole = (n: number): string => `${Math.round(n)}`;

function report(results: SeedResult[], seeds: number, warps: number, seedStart: number, hazards: HazardLevel): string {
  let commit = process.env.BALANCE_COMMIT ?? 'unknown';
  try {
    if (process.env.BALANCE_COMMIT) throw new Error('commit supplied by scripts/balance-ci.sh');
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    // Uncommitted sim or harness changes mean HEAD did not produce these numbers.
    if (execSync('git status --porcelain -- src scripts package-lock.json', { encoding: 'utf8' }).trim())
      commit += '-dirty';
  } catch {
    // Not a git checkout.
  }
  const seedArg =
    (seedStart === 1000 ? '' : ` --seed-start ${seedStart}`) +
    (hazards === DEFAULT_HAZARDS ? '' : ` --hazards ${hazards}`);
  const lines: string[] = [
    '# Balance report',
    '',
    `Generated by \`npm run balance -- --seeds ${seeds} --warps ${warps}${seedArg}\` at commit \`${commit}\` on Node ${process.versions.node} (${process.platform} ${process.arch}). The bot (\`scripts/bot.ts\`) plays the flagship; drones, haulers and construction drones use their built-in AI. While a system's respec window is open it sets each doctrine pair from the save seed (even: Swarm Doctrine, Bulk Freighter, Survey Array; odd: Ace Pilot, Courier, Brawler) and then keeps it. At each warp the bot takes the richest of the candidate routes (most opening rocks × richness, lower hazard on a tie). Hazards: ${hazards}. Times are sim time (m:ss). Cells show median (min–max) across seeds.`,
    '',
    '## Opening (system 1)',
    '',
    `Every warp starts a fresh run (new fleet, new loadout), so the opening asks what the player should have built before leaving system 1, not what a long stay would reach. The target is the first drone and the flagship's tier-2 laser, both before the first warp, in at least ${pct(OPENING_TARGET_SHARE)} of seeds; the other rows are for context. The bot warps as soon as the bank holds the fuel, so it is the impatient player.`,
    '',
    '| Milestone | Time | Target | Seeds | Result |',
    '| --- | --- | --- | --- | --- |',
  ];
  const opening = results.map((r) => r.warps[0]).filter((x): x is WarpStats => !!x);
  const info = (label: string, ts: (number | null)[]): string => `| ${label} | ${reached(ts)} | — | ${count(ts)} | — |`;
  // Both milestones reached: the later of the two.
  const kit = opening.map((x) =>
    x.firstDrone != null && x.firstLaserT2 != null ? Math.max(x.firstDrone, x.firstLaserT2) : null,
  );
  const kitHit = kit.filter((x) => x != null).length;
  lines.push(
    `| First purchase | ${reached(results.map((r) => r.firstPurchase))} | — | — | — |`,
    info(
      'First drone',
      opening.map((x) => x.firstDrone),
    ),
    info(
      'First tier-2 upgrade (any ship)',
      opening.map((x) => x.firstT2),
    ),
    info(
      'Flagship tier-2 laser',
      opening.map((x) => x.firstLaserT2),
    ),
    `| First drone + flagship tier-2 laser | ${reached(kit)} | both before the first warp | ${count(kit)} | **${kitHit >= OPENING_TARGET_SHARE * opening.length ? 'PASS' : 'FAIL'}** |`,
    `| Peak drones | ${stat(
      opening.map((x) => x.peakDrones),
      (n) => `${Math.round(n)}`,
    )} of ${stat(
      opening.map((x) => x.fleetCap),
      (n) => `${Math.round(n)}`,
    )} | — | — | — |`,
    '',
    '## Per warp',
    '',
    'First drone and first tier-2 are seconds into that system; peak drones is the most fielded at once, out of the fleet cap.',
    '',
    '| System | Time in system | vs previous | > 2× prev | Value delivered | Value / min | HD earned | Active-play share | Flagship share | Drone share | Hauler share | Contract share | Contracts done | Refined ▣ / ◉ | Outpost units | First drone | First tier-2 | Peak drones / cap | Walls |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
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
      )} | ${reached(rows.map((x) => x.firstDrone))} | ${reached(rows.map((x) => x.firstT2))} | ${stat(
        rows.map((x) => x.peakDrones),
        (n) => `${Math.round(n)}`,
      )} / ${stat(
        rows.map((x) => x.fleetCap),
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
  // Acceptance check for #206: refining, outposts and haulers must not sit idle until system 6.
  const earlySeeds = results.map((r) => r.warps.slice(0, AUTOMATION_BY));
  const alloySeeds = earlySeeds.filter((ws) => ws.some((x) => x.alloy > 0)).length;
  const outpostSeeds = earlySeeds.filter((ws) => ws.some((x) => x.outpostUnits > 0)).length;
  const bothSeeds = earlySeeds.filter((ws) => ws.some((x) => x.alloy > 0) && ws.some((x) => x.outpostUnits > 0)).length;
  const haulerMid = Array.from({ length: MID_GAME_END - AUTOMATION_BY + 1 }, (_, i) => {
    const w = AUTOMATION_BY - 1 + i;
    const xs = results.flatMap((r) => (r.warps[w] ? [share(r.warps[w]!.haulerValue, warpIncome(r.warps[w]!))] : []));
    return { w, median: xs.length ? median(xs) : 0 };
  });
  const haulerHit = haulerMid.every((h) => h.median > 0);
  lines.push(
    '',
    '## Automation by the early game (#206)',
    '',
    `Refining, outposts and haulers are the second pillar of the game, so they should show up before the mid-game, not at system ${MID_GAME_END}. Targets: refined alloy and a working outpost, both by system ${AUTOMATION_BY}, in at least ${pct(AUTOMATION_TARGET_SHARE)} of seeds; and a median hauler share of income above 0% in every system from ${AUTOMATION_BY} to ${MID_GAME_END}.`,
    '',
    '| Check | Result | Target | Verdict |',
    '| --- | --- | --- | --- |',
    `| Refined alloy by system ${AUTOMATION_BY} | ${alloySeeds}/${results.length} seeds | — | — |`,
    `| Outpost output by system ${AUTOMATION_BY} | ${outpostSeeds}/${results.length} seeds | — | — |`,
    `| Both by system ${AUTOMATION_BY} | ${bothSeeds}/${results.length} seeds (${pct(share(bothSeeds, results.length))}) | ≥ ${pct(AUTOMATION_TARGET_SHARE)} of seeds | **${bothSeeds >= AUTOMATION_TARGET_SHARE * results.length ? 'PASS' : 'FAIL'}** |`,
    `| Median hauler share, systems ${AUTOMATION_BY}–${MID_GAME_END} | ${haulerMid.map((h) => `${h.w + 1}: ${pct(h.median)}`).join(' · ')} | > 0% in each | **${haulerHit ? 'PASS' : 'FAIL'}** |`,
    '',
    'Known miss (#50): stacking all three doctrine pairs drops "both by system 4" under the 50% line. The bot sets every pair from the seed (even: all first sides, odd: all second sides), and each side taxes damage, speed, or cargo, so fewer seeds have outpost output by the end of system 4. A one-pair-per-seed pick rule is a likely follow-up; the doctrine numbers are unchanged.',
  );
  // Acceptance check for #207: the fleet cap must not sit unused for most of a run.
  const fleetRows = Array.from({ length: warps }, (_, w) => {
    const ws = results.flatMap((r) => (r.warps[w] && r.wall !== w ? [r.warps[w]!] : []));
    return { w, n: ws.length, atWarp: ws.map((x) => x.fleetAtWarp), cap: ws.map((x) => x.fleetCap) };
  }).filter((f) => f.n);
  const fleetHit = Array.from({ length: MID_GAME_END - FLEET_FROM + 1 }, (_, i) => fleetRows[FLEET_FROM - 1 + i]).every(
    (f) => !!f && median(f.atWarp) >= FLEET_AT_WARP_TARGET,
  );
  lines.push(
    '',
    '## Fleet utilisation (#207)',
    '',
    `The fleet cap (drones and haulers together) is a headline progression stat, so it should be in use well before the late game. Fleet at warp is the number of ships in the fleet on the last tick before the warp. The cap is not meant to be aspirational: target a median of **≥ ${FLEET_AT_WARP_TARGET} ships at warp in every system from ${FLEET_FROM} to ${MID_GAME_END}**. More automation lowers active play, so the active-play target above must still hold.`,
    '',
    '| System | Fleet at warp | Cap | Verdict |',
    '| --- | --- | --- | --- |',
    ...fleetRows.map(
      (f) =>
        `| ${f.w + 1} | ${stat(f.atWarp, whole)} | ${stat(f.cap, whole)} | ${f.w + 1 >= FLEET_FROM && f.w + 1 <= MID_GAME_END ? (median(f.atWarp) >= FLEET_AT_WARP_TARGET ? '**PASS**' : '**FAIL**') : '—'} |`,
    ),
    '',
    `- Overall (systems ${FLEET_FROM}–${MID_GAME_END}): **${fleetHit ? 'PASS' : 'FAIL'}**`,
  );
  // Acceptance check for #174: construction drones, not the flagship, should be placing the outposts by system 4.
  const builderSum = (pick: (x: WarpStats) => number, w: number): number =>
    results.reduce((n, r) => n + (r.warps[w] ? pick(r.warps[w]!) : 0), 0);
  const builderRows = Array.from({ length: BUILDER_TO - BUILDER_FROM + 1 }, (_, i) => {
    const w = BUILDER_FROM - 1 + i;
    return { w, b: builderSum((x) => x.builderOutposts, w), f: builderSum((x) => x.flagshipOutposts, w) };
  });
  const builderTotal = builderRows.reduce((n, x) => n + x.b, 0);
  const flagshipTotal = builderRows.reduce((n, x) => n + x.f, 0);
  const builderShare = share(builderTotal, builderTotal + flagshipTotal);
  const builderHit = builderTotal + flagshipTotal > 0 && builderShare >= BUILDER_OUTPOST_TARGET;
  lines.push(
    '',
    '## Outposts by builder vs flagship (#174)',
    '',
    `A construction drone builds outposts on its own, so once the bot owns one the flagship stops deploying them. Target: **construction drones place ≥ ${pct(BUILDER_OUTPOST_TARGET)} of the outposts in systems ${BUILDER_FROM}–${BUILDER_TO}**. Counts are outposts placed across all seeds.`,
    '',
    '| System | By builders | By flagship | Builder share |',
    '| --- | --- | --- | --- |',
    ...builderRows.map(
      (x) =>
        `| ${x.w + 1} | ${Math.round(x.b)} | ${Math.round(x.f)} | ${x.b + x.f ? pct(share(x.b, x.b + x.f)) : '—'} |`,
    ),
    '',
    `- Systems ${BUILDER_FROM}–${BUILDER_TO}: builders ${builderTotal} · flagship ${flagshipTotal} (${pct(builderShare)}) — **${builderHit ? 'PASS' : 'FAIL'}**`,
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
    '## Hazards (#208)',
    '',
    'Hull damage taken by every ship in the fleet, after armor and shields, per system (hazards: ' +
      `${hazards}). Collision is rocks and debris; comet is a hit from a comet; other is a volatile blast. Losses are ships destroyed (the flagship rebuilds at the station). Repair is paid in ore, not credits. The sim records no damage sources, so \`scripts/hazardMeter.ts\` attributes each tick's hull and shield loss from outside; heat and flare are recomputed from the tick's own formulas.`,
    '',
    `| System | Hull damage | ${DAMAGE_SOURCES.join(' | ')} | Ships lost | Seed-warps with a loss | Repair ore |`,
    `| --- | --- | ${DAMAGE_SOURCES.map(() => '---').join(' | ')} | --- | --- | --- |`,
  );
  for (let w = 0; w < warps; w++) {
    const hz = results.flatMap((r) => (r.warps[w] ? [r.warps[w]!.hazard] : []));
    if (!hz.length) break;
    lines.push(
      `| ${w + 1} | ${stat(hz.map(hullTotal), dmg)} | ${DAMAGE_SOURCES.map((src) =>
        stat(
          hz.map((h) => h.hull[src]),
          dmg,
        ),
      ).join(' | ')} | ${stat(
        hz.map((h) => h.shipsLost),
        whole,
      )} | ${hz.filter((h) => h.shipsLost > 0).length}/${hz.length} | ${stat(
        hz.map((h) => h.repairOre),
        whole,
      )} |`,
    );
  }
  const all = results.flatMap((r) => r.warps.map((x) => x.hazard));
  const raw = all.reduce((n, h) => n + h.raw, 0);
  const sum = (f: (h: HazardTally) => number): number => all.reduce((n, h) => n + f(h), 0);
  lines.push(
    '',
    `- Defensive share, pooled over ${all.length} seed-warps (${dmg(raw)} raw damage): armor turned away **${pct(sum((h) => h.armor) / Math.max(1e-9, raw))}**, shields absorbed **${pct(sum((h) => h.shield) / Math.max(1e-9, raw))}**, the hull took **${pct(sum(hullTotal) / Math.max(1e-9, raw))}**.`,
    `- Ships lost: ${sum((h) => h.shipsLost)} in total; repair spend ${whole(sum((h) => h.repairOre))} ore in total.`,
  );
  const roles = ['flagship', 'drone', 'hauler', 'builder'] as const;
  const hitCount = sum((h) => h.hits);
  const statusTotals = new Map<string, number>();
  for (const h of all)
    for (const [k, v] of Object.entries(h.collisionStatus)) statusTotals.set(k, (statusTotals.get(k) ?? 0) + v);
  lines.push(
    `- Collision hull loss by role (pooled): ${roles.map((r) => `${r} ${dmg(sum((h) => h.collisionRole[r]))}`).join(' · ')}.`,
    `- Collision hull loss by what the ship was doing (pooled): ${[...statusTotals]
      .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k} ${dmg(v)}`)
      .join(' · ')}.`,
    `- Damaging collisions: ${hitCount}, at a mean ${dmg(sum((h) => h.hitSpeed) / Math.max(1, hitCount))} speed before the tick.`,
  );
  const collisionNow = collisionMetric(results);
  const valueNow = midValuePerMin(results);
  const collisionOk = collisionNow <= COLLISION_BASELINE * COLLISION_TARGET_SHARE;
  const valueOk = valueNow >= VALUE_PER_MIN_BASELINE * VALUE_GUARD_SHARE;
  lines.push(
    '',
    `Collision damage is the mean over systems ${COLLISION_FROM}–${COLLISION_TO} of each system's median collision hull loss. Value/min is the median over mid-game seed-warps (systems ${MID_GAME_START}–${MID_GAME_END}). Baselines are from commit 0e525b1, before autopilot ships braked for rocks (#174).`,
    '',
    '| Check | Now | Baseline | Target | Verdict |',
    '| --- | --- | --- | --- | --- |',
    `| Collision damage vs baseline (#174) | ${dmg(collisionNow)} | ${COLLISION_BASELINE} | ≤ ${dmg(COLLISION_BASELINE * COLLISION_TARGET_SHARE)} (⅔) | **${collisionOk ? 'PASS' : 'FAIL'}** |`,
    `| Mid-game value/min vs baseline (#174) | ${whole(valueNow)} | ${VALUE_PER_MIN_BASELINE} | ≥ ${whole(VALUE_PER_MIN_BASELINE * VALUE_GUARD_SHARE)} (95%) | **${valueOk ? 'PASS' : 'FAIL'}** |`,
  );
  lines.push(
    '',
    '## Raw data',
    '',
    '```csv',
    'seed,system,sec,value,hd,flagship_value,drone_value,contract_value,contracts,alloy,fuel,wall,mods,hauler_value,outpost_units,first_drone,first_t2,peak_drones,fleet_cap,first_laser_t2',
    ...results.flatMap((r) =>
      r.warps.map(
        (x, w) =>
          `${r.seed},${w + 1},${x.sec.toFixed(1)},${Math.round(x.value)},${x.hd},${Math.round(x.flagshipValue)},${Math.round(x.droneValue)},${Math.round(x.contractValue)},${x.contracts},${x.alloy},${x.fuel},${r.wall === w ? 1 : 0},${x.mods},${Math.round(x.haulerValue)},${Math.round(x.outpostUnits)},${x.firstDrone?.toFixed(1) ?? ''},${x.firstT2?.toFixed(1) ?? ''},${x.peakDrones},${x.fleetCap},${x.firstLaserT2?.toFixed(1) ?? ''}`,
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
  const seeds = Number(arg('seeds', '30'));
  const warps = Number(arg('warps', '10'));
  const seedStart = Number(arg('seed-start', '1000'));
  const out = arg('out', 'docs/balance.md');
  const hazards = arg('hazards', DEFAULT_HAZARDS) as HazardLevel;
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
