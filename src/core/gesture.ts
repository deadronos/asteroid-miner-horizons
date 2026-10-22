// Touch gesture maths: two-finger pinch/pan steps and the virtual thrust stick. Pure, so tests need no DOM.

import type { Vec2 } from './vec';

export interface Point {
  x: number;
  y: number;
}

/** One step of a two-finger gesture. */
export interface PinchStep {
  /** Camera zoom factor, as `zoomAt` takes it: above 1 zooms out (fingers closing), below 1 zooms in. */
  zoom: number;
  /** The fingers' midpoint after the step, in client pixels. */
  cx: number;
  cy: number;
  /** How far the midpoint moved, in client pixels. */
  dx: number;
  dy: number;
}

/** The step from fingers at `a0`, `b0` to `a1`, `b1`. Fingers (nearly) on top of each other do not zoom. */
export function pinchStep(a0: Point, b0: Point, a1: Point, b1: Point): PinchStep {
  const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
  const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
  const cx = (a1.x + b1.x) / 2;
  const cy = (a1.y + b1.y) / 2;
  return {
    zoom: d0 > 1 && d1 > 1 ? d0 / d1 : 1,
    cx,
    cy,
    dx: cx - (a0.x + b0.x) / 2,
    dy: cy - (a0.y + b0.y) / 2,
  };
}

/**
 * Thrust from a virtual stick pushed `dx`, `dy` pixels from its centre (screen down = +z). Zero inside the dead
 * zone (`dead` × `radius`); beyond it the magnitude rises from 0 to 1 at the rim and stays capped at 1.
 */
export function stickVector(dx: number, dy: number, radius: number, dead = 0.15): Vec2 {
  const d = Math.hypot(dx, dy);
  const r0 = radius * dead;
  if (radius <= 0 || d <= r0) return { x: 0, z: 0 };
  const mag = Math.min(1, (d - r0) / (radius - r0));
  return { x: (dx / d) * mag, z: (dy / d) * mag };
}
