// Exploration: deterministic per-system anomaly placement, sensor pings and
// derelict salvage. The anomaly list itself is not saved; it is rolled from
// exploration.seed, which is mixed from the profile seed, system number and warp
// route without touching run.rng.

import { chance, int, makeRng, next, pick, range, type Rng } from '../core/rng';
import { dist, distSq, fromAngle, type Vec2 } from '../core/vec';
import { COMPONENTS, defaultVariant, variantDef } from '../data/components';
import { DERELICT_SALVAGE } from '../data/exploration';
import {
  credit,
  formatCost,
  RESOURCES,
  RESOURCE_INFO,
  walletValue,
  type Cost,
  type RawResource,
} from '../data/resources';
import { TUNING } from '../data/tuning';
import { ROCK_RADII, rockHp } from './generate';
import { isAlive } from './ships';
import type { Anomaly, Belt, Exploration, GameState, Rock, Run, Ship, StarSystem } from './types';

/**
 * Seed for a system's anomaly stream. Route 0 keeps the raw seed, matching
 * `generateSystem`, so a save that never chose a route still replays its system.
 */
export function explorationSeed(seed: number, number: number, route = 0): number {
  const routed = route === 0 ? seed : (seed ^ Math.imul(route, 0x632be5ab)) >>> 0;
  return (routed ^ Math.imul(number, 0x27d4eb2d)) >>> 0;
}

/** A fresh exploration state for system `number`: nothing revealed or claimed yet. */
export function newExploration(seed: number, number: number, route = 0): Exploration {
  return { seed: explorationSeed(seed, number, route), pingCd: 0, revealed: [], claimed: [] };
}

/** Picks a raw resource by a belt's mix weights. */
function rollKind(rng: Rng, mix: Belt['mix']): RawResource {
  const total = mix.ore + mix.ice + mix.crystal;
  let x = next(rng) * total;
  if ((x -= mix.ore) < 0) return 'ore';
  if ((x -= mix.ice) < 0) return 'ice';
  return 'crystal';
}

/** A point inside one of the system's belts, clear of the station's dock lane. */
function placeInBelt(rng: Rng, system: StarSystem): { pos: Vec2; mix: Belt['mix'] } {
  const clearance = TUNING.dockRadius * 2;
  let belt = system.belts[0]!;
  let pos = fromAngle(0, belt.inner);
  for (let tries = 0; tries < 16; tries++) {
    belt = system.belts[int(rng, 0, system.belts.length - 1)]!;
    pos = fromAngle(range(rng, 0, Math.PI * 2), range(rng, belt.inner, belt.outer));
    if (dist(pos, system.station.pos) >= clearance) break;
  }
  return { pos, mix: belt.mix };
}

/**
 * Rolls a system's hidden anomalies from `seed`. Pure and deterministic: the
 * same seed and system always produce the same ids, kinds and positions.
 */
export function rollAnomalies(seed: number, system: StarSystem): Anomaly[] {
  const rng = makeRng(seed);
  const list: Anomaly[] = [];
  const rich = int(rng, TUNING.richAnomalies[0], TUNING.richAnomalies[1]);
  const derelicts = int(rng, TUNING.derelictAnomalies[0], TUNING.derelictAnomalies[1]);
  for (let i = 0; i < rich; i++) {
    const { pos, mix } = placeInBelt(rng, system);
    list.push({ id: list.length, kind: 'rich', pos, resource: rollKind(rng, mix) });
  }
  for (let i = 0; i < derelicts; i++) {
    const { pos } = placeInBelt(rng, system);
    list.push({ id: list.length, kind: 'derelict', pos, salvage: int(rng, 0, DERELICT_SALVAGE.length - 1) });
  }
  return list;
}

/** One cached roll per seed; the list is read-only and only the system it was rolled for is valid. */
const anomalyCache = new Map<number, { system: StarSystem; list: Anomaly[] }>();

/**
 * The run's hidden anomalies, rolled once per seed and cached. Treat the result
 * as read-only: the sim copies positions out of it and never edits an entry.
 */
export function anomalies(run: Run): Anomaly[] {
  const { seed } = run.exploration;
  const hit = anomalyCache.get(seed);
  if (hit && hit.system === run.system) return hit.list;
  const list = rollAnomalies(seed, run.system);
  anomalyCache.set(seed, { system: run.system, list });
  return list;
}

/** True once a ping has revealed anomaly `id`. */
export const isRevealed = (run: Run, id: number): boolean => run.exploration.revealed.includes(id);

/** True once a derelict's salvage has been paid. */
export const isClaimed = (run: Run, id: number): boolean => run.exploration.claimed.includes(id);

/** True when the sensors have recharged enough to ping again. */
export const pingReady = (run: Run): boolean => run.exploration.pingCd <= 0;

/** The belt whose inner/outer radii contain `pos`, or 0 for a point outside every belt. */
function beltAt(system: StarSystem, pos: Vec2): number {
  const radius = Math.hypot(pos.x, pos.z);
  for (let i = 0; i < system.belts.length; i++) {
    const b = system.belts[i]!;
    if (radius >= b.inner && radius <= b.outer) return i;
  }
  return 0;
}

/**
 * Spawns a rich deposit's one large rock. The radius comes from the anomaly's
 * own stream (seed and id), never run.rng, so a ping cannot shift the run's rock
 * and pickup sequence. Units are the usual large-rock yield times
 * `richYieldMul`; cracking conserves them like any other rock.
 */
export function spawnRichRock(run: Run, anomaly: Extract<Anomaly, { kind: 'rich' }>): Rock {
  const rng = makeRng((run.exploration.seed ^ Math.imul(anomaly.id + 1, 0x9e3779b1)) >>> 0);
  const [lo, hi] = ROCK_RADII[0];
  const radius = range(rng, lo, hi);
  const hp = rockHp(radius, anomaly.resource);
  const base = TUNING.rockYieldK * radius * radius * (anomaly.resource === 'crystal' ? 0.4 : 1) * run.system.richness;
  const rock: Rock = {
    id: run.nextId++,
    kind: anomaly.resource,
    size: 0,
    pos: { ...anomaly.pos },
    vel: { x: 0, z: 0 },
    radius,
    hp,
    maxHp: hp,
    units: Math.max(1, Math.round(base * TUNING.richYieldMul)),
    belt: beltAt(run.system, anomaly.pos),
    rich: true,
  };
  run.rocks.push(rock);
  return rock;
}

/** The first alive ship within `radius`, or null. No allocation: this runs every tick. */
function claimerAt(run: Run, pos: Vec2, radius: number): Ship | null {
  const r2 = radius * radius;
  for (let i = 0; i < run.ships.length; i++) {
    const ship = run.ships[i]!;
    if (isAlive(ship) && distSq(ship.pos, pos) <= r2) return ship;
  }
  return null;
}

/** "120 ore, 6 alloy" for a salvage log line. */
function rewardText(reward: Cost): string {
  const parts: string[] = [];
  for (const r of RESOURCES) {
    const n = reward[r] ?? 0;
    if (n > 0) parts.push(`${n} ${RESOURCE_INFO[r].name.toLowerCase()}`);
  }
  return parts.join(', ');
}

/**
 * Pays every revealed, unclaimed derelict a ship has reached. The component
 * roll comes from the anomaly's own stream (seed and id), not run.rng, so
 * salvage cannot shift the run's rock and pickup sequence. A drop fits the
 * claiming ship's first empty slot, or pays the part's install cost when the
 * hull has no room. Claimed ids are persisted, so a wreck never pays twice.
 */
export function updateExploration(state: GameState): void {
  const { run } = state;
  const { exploration } = run;
  if (exploration.revealed.length === 0) return;
  const list = anomalies(run);
  for (let i = 0; i < exploration.revealed.length; i++) {
    const id = exploration.revealed[i]!;
    if (exploration.claimed.includes(id)) continue;
    const anomaly = list[id];
    if (!anomaly || anomaly.id !== id || anomaly.kind !== 'derelict') continue;
    const claimer = claimerAt(run, anomaly.pos, TUNING.derelictClaimRadius);
    if (!claimer) continue;

    const salvage = DERELICT_SALVAGE[anomaly.salvage]!;
    exploration.claimed.push(id);
    credit(run.bank, salvage.reward);
    run.runValue += walletValue(salvage.reward);

    const dropRng = makeRng((exploration.seed ^ Math.imul(id + 1, 0x85ebca6b)) >>> 0);
    const drop = chance(dropRng, salvage.componentChance) ? pick(dropRng, salvage.components) : null;
    let tail = '';
    if (drop) {
      const variant = defaultVariant(drop);
      const slot = claimer.slots.indexOf(null);
      if (slot >= 0) {
        claimer.slots[slot] = { type: drop, variant, tier: 1 };
        tail = ` + ${COMPONENTS[drop].name}`;
      } else {
        const cost = variantDef(drop, variant).cost(1);
        credit(run.bank, cost);
        tail = ` + ${formatCost(cost)} for a ${COMPONENTS[drop].name}`;
      }
    }
    state.out.log.push({
      level: 'major',
      text: `Salvaged ${salvage.label}: ${rewardText(salvage.reward)}${tail}.`,
      event: 'salvage',
    });
  }
}
