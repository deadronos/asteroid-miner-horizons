// Gamepad maths: radial dead zone, stick to thrust, right-stick zoom, button edge detection and the context-free
// "interact" target pick. Pure, so tests need no DOM or Gamepad API.

import { stickVector } from './gesture';
import type { Vec2 } from './vec';

/** Dead-zone radius as a share of full stick travel. */
export const PAD_DEAD = 0.15;
/** Zoom speed at full right-stick tilt: factor change per second (e^k). */
const ZOOM_RATE = 1.6;

/**
 * Thrust from a left stick at `x`, `y` (each −1..1, down = +y, which is screen +z). Radial dead zone, then a
 * magnitude rising from 0 to 1 and capped at 1, so a square-gated stick's corners are not faster.
 */
export function padThrust(x: number, y: number, dead = PAD_DEAD): Vec2 {
  return stickVector(x, y, 1, dead);
}

/** `zoomAt` factor for one frame from a right-stick vertical axis: up zooms in (below 1), down zooms out. */
export function padZoom(axisY: number, dt: number, dead = PAD_DEAD): number {
  const v = padThrust(0, axisY, dead).z;
  return Math.exp(v * ZOOM_RATE * dt);
}

/** Indices of buttons pressed this frame (down now, up before). */
export function buttonEdges(prev: readonly boolean[], curr: readonly boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < curr.length; i++) if (curr[i] && !prev[i]) out.push(i);
  return out;
}

export interface PadRock {
  id: number;
  pos: Vec2;
  radius: number;
}

export type InteractTarget = { kind: 'rock'; id: number } | { kind: 'station' } | null;

/**
 * What the interact button acts on for a ship at `ship`: the station when the ship is within `stationRange` of it
 * (unload), else the rock whose surface is nearest within `rockRange`, else the station as a fallback (fly home).
 */
export function interactTarget(
  ship: Vec2,
  station: Vec2,
  stationRange: number,
  rocks: readonly PadRock[],
  rockRange: number,
): InteractTarget {
  if (Math.hypot(ship.x - station.x, ship.z - station.z) <= stationRange) return { kind: 'station' };
  let best: InteractTarget = null;
  let bestD = rockRange;
  for (const r of rocks) {
    const d = Math.hypot(ship.x - r.pos.x, ship.z - r.pos.z) - r.radius;
    if (d < bestD) {
      bestD = d;
      best = { kind: 'rock', id: r.id };
    }
  }
  return best ?? { kind: 'station' };
}
