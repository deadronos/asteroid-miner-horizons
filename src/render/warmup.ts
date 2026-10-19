// Visibility helper for shader warm-up: forces objects visible around a callback so the
// scene's lights are gathered. Kept free of the canvas-dependent util.ts.

import type * as THREE from 'three';

/**
 * Runs `fn` with every object forced visible, then puts each object's previous `visible`
 * back, even when `fn` throws (the error still propagates).
 */
export function withVisible(objects: readonly THREE.Object3D[], fn: () => void): void {
  const saved = objects.map((o) => [o, o.visible] as const);
  try {
    for (const o of objects) o.visible = true;
    fn();
  } finally {
    for (const [o, visible] of saved) o.visible = visible;
  }
}
