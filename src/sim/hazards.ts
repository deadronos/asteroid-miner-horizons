// Hazards: the per-system schedule of comets and solar flares. Rolls come from a
// dedicated stream so they never shift run.rng or the rock layout.

import { removeItem } from '../core/array';
import { makeRng, range } from '../core/rng';
import { dist, fromAngle, len, type Vec2 } from '../core/vec';
import { FLARES, HAZARD_LEVELS, type HazardLevel } from '../data/hazards';
import { TUNING } from '../data/tuning';
import { isDocked } from './economy';
import { rockHp } from './generate';
import type { CometWarning, GameState, Hazards, Rock, Run, Ship } from './types';

const BELT_NAMES = ['inner', 'middle', 'outer'];
/** Comet radius range; a pending comet is treated as the largest. */
const COMET_RADIUS = [34, 44] as const;

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
  const speed = len(vel) || 1;
  const t = -(from.x * vel.x + from.z * vel.z) / speed;
  if (t <= 0) return len(from);
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
    const span = dist(crossing, from) || 1;
    const vel = { x: ((crossing.x - from.x) / span) * speed, z: ((crossing.z - from.z) / span) * speed };
    warning = { from, vel, belt, timeLeft: TUNING.cometWarning };
    if (closestApproach(from, vel) >= minMiss) break;
  }
  return warning!;
}

function spawnComet(state: GameState, w: CometWarning): void {
  const { run } = state;
  const rng = run.hazards.rng;
  const radius = range(rng, COMET_RADIUS[0], COMET_RADIUS[1]);
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
  state.profile.stats.comets += 1;
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
  const d = len(ship.pos);
  return Math.min(1, Math.max(0, 1 - (d - starRadius) / (profile.reach - starRadius)));
}

/**
 * True while a flare is pending or burning in a flaring system and `pos` lies within its reach plus
 * `TUNING.flareShelterPad`: where the AI should not be.
 */
export function inFlareZone(run: Run, pos: Vec2): boolean {
  const profile = FLARES[run.system.starClass];
  if (!run.hazards.flare || !profile) return false;
  const r = profile.reach + TUNING.flareShelterPad;
  return pos.x * pos.x + pos.z * pos.z < r * r;
}

/** Writes the unit vector out of the path ahead of `from` along `vel` into `out` if `pos` lies within `half` of it. */
function pathEscape(from: Vec2, vel: Vec2, half: number, pos: Vec2, out: Vec2): boolean {
  const sp = len(vel);
  if (sp < 1e-6) return false;
  const dx = vel.x / sp;
  const dz = vel.z / sp;
  const rx = pos.x - from.x;
  const rz = pos.z - from.z;
  if (rx * dx + rz * dz < -half) return false; // safely behind
  const lateral = rx * -dz + rz * dx; // + means left of the path
  if (Math.abs(lateral) >= half) return false;
  const side = lateral >= 0 ? 1 : -1;
  out.x = -dz * side;
  out.z = dx * side;
  return true;
}

/**
 * True if `pos` lies on the path ahead of the pending comet or a live one in `comets` (within the comet's radius
 * plus `pad`; the comet's own body counts). Writes the unit vector straight out of that path into `out`.
 */
export function cometPathEscape(run: Run, comets: readonly Rock[], pos: Vec2, pad: number, out: Vec2): boolean {
  const w = run.hazards.comet;
  if (w && pathEscape(w.from, w.vel, COMET_RADIUS[1] + pad, pos, out)) return true;
  for (const c of comets) if (pathEscape(c.pos, c.vel, c.radius + pad, pos, out)) return true;
  return false;
}

/**
 * Where a ship at `pos` inside the flare zone should shelter: `'dock'` when the station is no farther than the way
 * out (or `preferDock`), else `'flee'` with the point just outside the zone, radially away from the star, in `out`.
 */
export function flareShelter(run: Run, pos: Vec2, preferDock: boolean, out: Vec2): 'dock' | 'flee' {
  const profile = FLARES[run.system.starClass];
  const d = len(pos) || 1;
  const safe = (profile?.reach ?? 0) + TUNING.flareShelterPad + 40;
  out.x = (pos.x / d) * safe;
  out.z = (pos.z / d) * safe;
  if (preferDock || dist(run.system.station.pos, pos) <= safe - d) return 'dock';
  return 'flee';
}
