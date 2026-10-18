// Procedural star systems: star class, planets with moons, asteroid belts and
// the mining station. Every system is a pure function of (seed, number).

import { chance, int, makeRng, next, pick, range, type Rng } from '../core/rng';
import { fromAngle, type Vec2 } from '../core/vec';
import type { RawResource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Belt, Planet, Rock, RockSize, Run, StarClass, StarSystem } from './types';

const SYL = ['ka', 've', 'lor', 'tha', 'zen', 'mi', 'dra', 'os', 'qu', 'rel', 'syn', 'tar', 'ul', 'ix', 'no', 'pha'];
const PLANET_COLORS = [0x4d7dd1, 0xc96b3a, 0x7fc46b, 0xb49be0, 0xd9c27a, 0x5fb3a8, 0xa04f6a];

const STAR_CLASSES: Record<StarClass, { radius: number; color: number; heat: number }> = {
  M: { radius: 55, color: 0xff7a4a, heat: 1.6 },
  G: { radius: 75, color: 0xffd27a, heat: 2.0 },
  B: { radius: 100, color: 0x9cc8ff, heat: 2.4 },
};

/** Size class → [min, max] radius. */
export const ROCK_RADII: Record<RockSize, readonly [number, number]> = {
  0: [30, 44],
  1: [16, 24],
  2: [8, 13],
};

function name(r: Rng, syllables: number): string {
  let s = '';
  for (let i = 0; i < syllables; i++) s += pick(r, SYL);
  return s[0]!.toUpperCase() + s.slice(1);
}

export function generateSystem(seed: number, number: number): StarSystem {
  const r = makeRng(seed ^ (number * 0x9e3779b1));
  const starClass: StarClass = number === 1 ? 'G' : pick(r, ['M', 'G', 'G', 'B'] as const);
  const sc = STAR_CLASSES[starClass];
  const sysName = name(r, 2);

  // Planet orbits avoid the belts (600–880, 1150–1450) and the station lane (~1000).
  const slots = [300, 470, 1720, 2300, 2750];
  const count = int(r, 3, 5);
  const planets: Planet[] = [];
  for (let i = 0; i < count; i++) {
    const moons = Array.from({ length: int(r, 0, 3) }, () => ({
      orbitR: range(r, 34, 70),
      radius: range(r, 4, 9),
      angle: range(r, 0, Math.PI * 2),
      speed: range(r, 0.2, 0.6),
      color: 0x9aa3b2,
    }));
    planets.push({
      name: `${sysName} ${['I', 'II', 'III', 'IV', 'V'][i]}`,
      orbitR: slots[i]! + range(r, -30, 30),
      radius: range(r, 16, 38),
      angle: range(r, 0, Math.PI * 2),
      speed: range(r, 0.006, 0.02) * (chance(r, 0.5) ? 1 : 0.7),
      color: pick(r, PLANET_COLORS),
      ringed: chance(r, 0.3),
      moons,
    });
  }

  // Crystal shows up only after the first warp, and more the further you go.
  const crystal = number >= 2 ? Math.min(0.15, 0.04 * (number - 1)) : 0;
  const richness = number === 1 ? 1 : range(r, 0.85, 1.35);
  const belts: Belt[] = [
    { inner: 610, outer: 870, mix: { ore: 0.72, ice: 0.28, crystal: 0 }, initialCount: Math.round(160 * richness) },
    {
      inner: 1160,
      outer: 1440,
      mix: { ore: 0.3, ice: 0.7 - crystal, crystal },
      initialCount: Math.round(140 * richness),
    },
  ];
  if (number >= 3) {
    belts.push({ inner: 1950, outer: 2150, mix: { ore: 0.35, ice: 0.35, crystal: 0.3 }, initialCount: 90 });
  }

  const stationAngle = range(r, 0, Math.PI * 2);
  return {
    name: sysName,
    number,
    starClass,
    starRadius: sc.radius,
    starColor: sc.color,
    heatRadius: sc.radius * sc.heat,
    planets,
    belts,
    station: { pos: fromAngle(stationAngle, 1010), angle: stationAngle },
    richness,
  };
}

function rollKind(r: Rng, mix: Record<RawResource, number>): RawResource {
  const total = mix.ore + mix.ice + mix.crystal;
  let x = next(r) * total;
  if ((x -= mix.ore) < 0) return 'ore';
  if ((x -= mix.ice) < 0) return 'ice';
  return 'crystal';
}

export function rockHp(radius: number, kind: RawResource): number {
  return TUNING.rockHpK * radius ** 1.5 * (kind === 'crystal' ? 2.2 : 1);
}

export function makeRock(
  run: Run,
  kind: RawResource,
  size: RockSize,
  pos: Vec2,
  units: number | null,
  belt: number,
): Rock {
  const [lo, hi] = ROCK_RADII[size];
  const radius = range(run.rng, lo, hi);
  const hp = rockHp(radius, kind);
  const baseUnits = TUNING.rockYieldK * radius * radius * (kind === 'crystal' ? 0.4 : 1) * run.system.richness;
  return {
    id: run.nextId++,
    kind,
    size,
    pos: { ...pos },
    vel: { x: 0, z: 0 },
    radius,
    hp,
    maxHp: hp,
    units: units ?? Math.max(1, Math.round(baseUnits)),
    belt,
  };
}

export function spawnBeltRock(run: Run, beltIndex: number, sizeOverride?: RockSize): Rock {
  const r = run.rng;
  const belt = run.system.belts[beltIndex]!;
  const roll = next(r);
  const size: RockSize = sizeOverride ?? (roll < 0.22 ? 0 : roll < 0.6 ? 1 : 2);
  const pos = fromAngle(range(r, 0, Math.PI * 2), range(r, belt.inner, belt.outer));
  const rock = makeRock(run, rollKind(r, belt.mix), size, pos, null, beltIndex);
  run.rocks.push(rock);
  return rock;
}

export function populateBelts(run: Run): void {
  run.rocks = [];
  run.system.belts.forEach((b, i) => {
    for (let n = 0; n < b.initialCount; n++) spawnBeltRock(run, i);
  });
}
