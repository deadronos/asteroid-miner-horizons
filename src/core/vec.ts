// Minimal 2D vector helpers. The game map is the { x, z } plane (three.js
// ground plane), so the second component is called z everywhere.

export interface Vec2 {
  x: number;
  z: number;
}

export const v = (x = 0, z = 0): Vec2 => ({ x, z });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const fromAngle = (a: number, r = 1): Vec2 => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

/** Exponential damping factor for a per-second rate, frame-rate independent. */
export const damp = (ratePerSec: number, dt: number): number => Math.exp(-ratePerSec * dt);

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
