// Minimal 2D vector helpers. The game map is the { x, z } plane (three.js
// ground plane), so the second component is called z everywhere.

export interface Vec2 {
  x: number;
  z: number;
}

export const v = (x = 0, z = 0): Vec2 => ({ x, z });
/**
 * `Math.hypot(x, z)` for two arguments, bit for bit: the same scaled, compensated sum V8 uses. The builtin
 * returns a heap number the JIT cannot unbox, so every call in a hot loop allocates; this one does not.
 */
export function hypot2(x: number, z: number): number {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const max = ax > az ? ax : az;
  if (max === 0 || max === Infinity || max !== max || ax !== ax || az !== az) return Math.hypot(x, z);
  const nx = ax / max;
  const nz = az / max;
  let sum = nx * nx;
  let comp = 0;
  const summand = nz * nz - comp;
  const pre = sum + summand;
  comp = pre - sum - summand;
  sum = pre;
  return Math.sqrt(sum) * max;
}

export const dist = (a: Vec2, b: Vec2): number => hypot2(a.x - b.x, a.z - b.z);
export const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const len = (a: Vec2): number => hypot2(a.x, a.z);
export const fromAngle = (a: number, r = 1): Vec2 => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

/** One explicit Euler step: advances `body.pos` by `body.vel * dt`. */
export function integrate(body: { pos: Vec2; vel: Vec2 }, dt: number): void {
  body.pos.x += body.vel.x * dt;
  body.pos.z += body.vel.z * dt;
}

/** Exponential damping factor for a per-second rate, frame-rate independent. */
export const damp = (ratePerSec: number, dt: number): number => Math.exp(-ratePerSec * dt);

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
