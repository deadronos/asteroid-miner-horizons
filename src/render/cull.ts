// View-rectangle culling for the top-down orthographic camera. The camera
// looks straight down, so "on screen" is a plain AABB test on the ground plane.

/** The world rectangle the camera shows this frame: center plus half extents. */
export interface ViewRect {
  x: number;
  z: number;
  halfW: number;
  halfH: number;
}

/**
 * True when a circle of radius `r` at (x, z) overlaps the view. Callers pass a
 * radius that bounds everything the instance can draw, so nothing pops at the edges.
 */
export function inView(view: ViewRect, x: number, z: number, r: number): boolean {
  return Math.abs(x - view.x) <= view.halfW + r && Math.abs(z - view.z) <= view.halfH + r;
}
