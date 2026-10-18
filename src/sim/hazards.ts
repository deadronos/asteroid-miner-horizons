// Hazards: the per-system schedule of comets and solar flares. Rolls come from a
// dedicated stream so they never shift run.rng or the rock layout.

import { removeItem } from '../core/array';
import { makeRng, range } from '../core/rng';
import { fromAngle, type Vec2 } from '../core/vec';
import { FLARES, HAZARD_LEVELS, type HazardLevel } from '../data/hazards';
import { TUNING } from '../data/tuning';
import { isDocked } from './economy';
import { rockHp } from './generate';
import type { CometWarning, GameState, Hazards, Run, Ship } from './types';

const BELT_NAMES = ['inner', 'middle', 'outer'];

/** A fresh hazard board for system `number`: timers set past the grace period, nothing pending. */
export function newHazards(seed: number, number: number): Hazards {
  const rng = makeRng(((seed ^ 0x51ed270b) + number * 2654435761) >>> 0);
  return {
    rng,
    cometTimer: TUNING.hazardFirstDelay + range(rng, 0, 30),
    comet: null,
    flareTimer: TUNING.hazardFirstDelay + range(rng, 20, 60),
    flare: null,
    comets: 0,
    flares: 0,
  };
}

/** Closest the straight path from `from` along `vel` (t >= 0) comes to the star. */
function closestApproach(from: Vec2, vel: Vec2): number {
  const speed = Math.hypot(vel.x, vel.z) || 1;
  const t = -(from.x * vel.x + from.z * vel.z) / speed;
  if (t <= 0) return Math.hypot(from.x, from.z);
  return Math.abs(from.x * vel.z - from.z * vel.x) / speed;
}

/** Rolls where a comet will enter and which belt it crosses, avoiding paths through the star's heat zone. */
function rollComet(state: GameState, speed: number): CometWarning {
  const { run } = state;
  const rng = run.hazards.rng;
  const minMiss = run.system.heatRadius + 150;
  let warning: CometWarning | null = null;
  for (let tries = 0; tries < 8; tries++) {
    const belt = Math.floor(range(rng, 0, run.system.belts.length));
    const b = run.system.belts[belt]!;
    const crossing = fromAngle(range(rng, 0, Math.PI * 2), (b.inner + b.outer) / 2);
    const from = fromAngle(range(rng, 0, Math.PI * 2), TUNING.cometEdge);
    const len = Math.hypot(crossing.x - from.x, crossing.z - from.z) || 1;
    const vel = { x: ((crossing.x - from.x) / len) * speed, z: ((crossing.z - from.z) / len) * speed };
    warning = { from, vel, belt, timeLeft: TUNING.cometWarning };
    if (closestApproach(from, vel) >= minMiss) break;
  }
  return warning!;
}

function spawnComet(state: GameState, w: CometWarning): void {
  const { run } = state;
  const rng = run.hazards.rng;
  const radius = range(rng, 34, 44);
  const hp = rockHp(radius, 'ice') * TUNING.cometHpMul;
  const units = Math.max(
    1,
    Math.round(TUNING.rockYieldK * radius * radius * run.system.richness * TUNING.cometYieldMul),
  );
  run.rocks.push({
    id: run.nextId++,
    kind: 'ice',
    size: 0,
    pos: { ...w.from },
    vel: { ...w.vel },
    radius,
    hp,
    maxHp: hp,
    units,
    belt: w.belt,
    comet: true,
  });
  run.hazards.comets += 1;
  state.out.fx.push({ t: 'hazard', kind: 'comet', phase: 'start', pos: { ...w.from } });
}

/**
 * Advances the hazard schedule one tick: despawns comets that have left, clears everything when hazards are off,
 * otherwise runs the comet warning/spawn cycle and the solar flare cycle. Draws only from `run.hazards.rng`.
 */
export function updateHazards(state: GameState, dt: number, level: HazardLevel): void {
  const { run, out } = state;
  const hz = run.hazards;
  const sys = run.system;

  // Always: a comet in flight when hazards go off (or that flew past) still leaves.
  const limit = TUNING.cometEdge + 200;
  for (let i = run.rocks.length - 1; i >= 0; i--) {
    const r = run.rocks[i]!;
    if (r.comet && r.pos.x * r.pos.x + r.pos.z * r.pos.z > limit * limit && r.pos.x * r.vel.x + r.pos.z * r.vel.z > 0)
      removeItem(run.rocks, r);
  }

  if (level === 'off' || sys.number < TUNING.hazardMinSystem) {
    hz.comet = null;
    hz.flare = null;
    return;
  }
  const lv = HAZARD_LEVELS[level];

  if (hz.comet) {
    hz.comet.timeLeft -= dt;
    if (hz.comet.timeLeft <= 0) {
      spawnComet(state, hz.comet);
      hz.comet = null;
    }
  } else {
    hz.cometTimer -= dt;
    if (hz.cometTimer <= 0) {
      hz.comet = rollComet(state, TUNING.cometSpeed * lv.damage);
      hz.cometTimer = range(hz.rng, TUNING.cometInterval[0], TUNING.cometInterval[1]) * lv.interval;
      out.log.push({
        level: 'warn',
        text: `☄ Comet inbound — crossing the ${BELT_NAMES[hz.comet.belt] ?? 'outer'} belt in ${TUNING.cometWarning}s.`,
      });
      out.fx.push({ t: 'hazard', kind: 'comet', phase: 'warn' });
    }
  }

  const profile = FLARES[sys.starClass];
  if (!profile) return;
  const fl = hz.flare;
  if (!fl) {
    hz.flareTimer -= dt;
    if (hz.flareTimer <= 0) {
      hz.flare = { phase: 'warning', timeLeft: TUNING.flareWarning };
      hz.flareTimer = range(hz.rng, profile.interval[0], profile.interval[1]) * lv.interval;
      out.log.push({
        level: 'warn',
        text: `☀ Solar flare building — dock or get clear of the star within ${TUNING.flareWarning}s.`,
      });
      out.fx.push({ t: 'hazard', kind: 'flare', phase: 'warn' });
    }
    return;
  }
  fl.timeLeft -= dt;
  if (fl.timeLeft > 0) return;
  if (fl.phase === 'warning') {
    fl.phase = 'active';
    fl.timeLeft = TUNING.flareDuration;
    out.log.push({ level: 'warn', text: '☀ Solar flare!' });
    out.fx.push({ t: 'hazard', kind: 'flare', phase: 'start' });
  } else {
    hz.flare = null;
    hz.flares += 1;
    out.log.push({ level: 'info', text: 'Flare subsided.' });
  }
}

/** 0..1 flare exposure of `ship`: 0 unless a flare is active, the star class has flares, the ship is undocked and within reach. */
export function flareExposure(run: Run, ship: Ship): number {
  const profile = FLARES[run.system.starClass];
  if (run.hazards.flare?.phase !== 'active' || !profile || isDocked(run, ship)) return 0;
  const { starRadius } = run.system;
  const d = Math.hypot(ship.pos.x, ship.pos.z);
  return Math.min(1, Math.max(0, 1 - (d - starRadius) / (profile.reach - starRadius)));
}
