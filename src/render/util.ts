// Small three.js helpers shared by the render modules.

import * as THREE from 'three';
import { makeRng, next, type Rng } from '../core/rng';

/** Flat-on-the-ground mesh helper: geometry authored in XY is laid onto XZ. */
export function flat<T extends THREE.BufferGeometry>(geo: T): T {
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function radialTexture(stops: [number, string][], size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const glowTexture = radialTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.25, 'rgba(255,255,255,0.55)'],
  [1, 'rgba(255,255,255,0)'],
]);

export function additive(color: number, opacity = 1, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function circleLoop(radius: number, color: number, opacity: number, segments = 160): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

/**
 * Shape family of a rock, keyed off the resource kind it carries: `rock` for
 * ore, `gem` for ice, `shard` for crystal. Selecting a style only changes the
 * silhouette, never the sim.
 */
export type RockStyle = 'rock' | 'gem' | 'shard';

/** Per-vertex radial scale that gives each style its silhouette. */
const STYLE_SCALE: Record<RockStyle, (r: Rng) => number> = {
  // Ore: chunky and irregular, the original shape.
  rock: (r) => 0.72 + next(r) * 0.5,
  // Ice: rounded and uniform, so the highlight reads as a smooth gem.
  gem: (r) => 0.9 + next(r) * 0.14,
  // Crystal: `rng*rng` biases most vertices inward and throws a few out.
  shard: (r) => {
    const u = next(r);
    return 0.55 + u * u * 0.6;
  },
};

/**
 * A lumpy low-poly rock of unit radius; `seed` picks the shape, `style` the
 * kind family (default `'rock'`, which keeps older callers byte-identical).
 */
export function rockGeometry(seed: number, style: RockStyle = 'rock'): THREE.BufferGeometry {
  const r = makeRng(seed);
  const geo = new THREE.IcosahedronGeometry(1, style === 'rock' ? 1 : 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  // Displace shared vertices consistently so the flat-shaded mesh stays closed.
  const scale = STYLE_SCALE[style];
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let s = offsets.get(key);
    if (s == null) {
      s = scale(r);
      offsets.set(key, s);
    }
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}
