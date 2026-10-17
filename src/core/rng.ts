// Deterministic PRNG (mulberry32). The sim never calls Math.random: every
// random roll goes through an Rng whose state lives in the save game, so a
// run replays identically from the same seed and commands.

export interface Rng {
  /** Raw 32-bit generator state; persisted with the game. */
  s: number;
}

export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** Uniform float in [0, 1). Advances the generator. */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r: Rng, lo: number, hi: number): number => lo + next(r) * (hi - lo);
export const int = (r: Rng, lo: number, hiInclusive: number): number => Math.floor(range(r, lo, hiInclusive + 1));
export const pick = <T>(r: Rng, items: readonly T[]): T => items[Math.floor(next(r) * items.length)]!;
export const chance = (r: Rng, p: number): boolean => next(r) < p;

/** Stateless hash → [0, 1); handy for cosmetic per-id variation in the renderer. */
export function hash01(n: number): number {
  let t = (n * 0x9e3779b1) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
