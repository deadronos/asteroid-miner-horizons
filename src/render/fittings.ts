// Fitted-component attachments on a ship model: a turret per laser, a pod per
// cargo module, a shield-emitter dot and an engine flame sized by tier. The
// layout is pure data from the slots; the meshes are rebuilt only when the
// fit changes (`sameFit`), never per frame.

import * as THREE from 'three';
import type { Tier, VariantId } from '../data/components';
import type { Fitted } from '../sim/types';

/** One attachment placed in hull-local space (+x is the nose, y is up). */
export interface Attachment {
  kind: 'turret' | 'pod' | 'emitter';
  x: number;
  z: number;
  tier: Tier;
  variant: VariantId;
}

export interface FitLayout {
  parts: Attachment[];
  /** Flame length multiplier: 1 = a tier-1 engine; hulls with no engine still idle a short flame. */
  flameLength: number;
  /** Flame width multiplier; vector thrusters burn wider and stubbier. */
  flameWidth: number;
}

/** Flame length by best engine tier; index 0 = no engine fitted. */
export const FLAME_LENGTH = [0.7, 1, 1.35, 1.75] as const;
/** Each engine beyond the first stretches the flame a little further. */
const EXTRA_ENGINE_FLAME = 0.15;

/**
 * `count` slots along a row: an odd count puts one on the centreline, the
 * rest go in mirrored pairs stepping back by `step`.
 */
function row(count: number, x0: number, step: number, halfW: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let x = x0;
  if (count % 2 === 1) {
    out.push({ x, z: 0 });
    x -= step;
  }
  while (out.length < count) {
    out.push({ x, z: halfW }, { x, z: -halfW });
    x -= step;
  }
  return out;
}

/** Where each fitted component shows on a hull of collision radius `size`. */
export function fitLayout(slots: readonly (Fitted | null)[], size: number): FitLayout {
  const lasers: Fitted[] = [];
  const pods: Fitted[] = [];
  let shield: Fitted | null = null;
  let engineTier = 0;
  let engines = 0;
  let thrusters = 0;
  for (const f of slots) {
    if (!f) continue;
    if (f.type === 'laser') lasers.push(f);
    else if (f.type === 'cargo') pods.push(f);
    else if (f.type === 'shield') {
      if (!shield || f.tier > shield.tier) shield = f;
    } else if (f.type === 'engine') {
      engines++;
      if (f.variant === 'thruster') thrusters++;
      engineTier = Math.max(engineTier, f.tier);
    }
  }
  const parts: Attachment[] = [];
  const turretAt = row(lasers.length, size * 0.45, size * 0.3, size * 0.3);
  lasers.forEach((f, i) => parts.push({ kind: 'turret', ...turretAt[i]!, tier: f.tier, variant: f.variant }));
  // Pods hang off the flanks, so even a single one sits to the side.
  pods.forEach((f, i) =>
    parts.push({
      kind: 'pod',
      x: -size * 0.3 - Math.floor(i / 2) * size * 0.45,
      z: (i % 2 === 0 ? 1 : -1) * size * 0.7,
      tier: f.tier,
      variant: f.variant,
    }),
  );
  if (shield) parts.push({ kind: 'emitter', x: -size * 0.05, z: 0, tier: shield.tier, variant: shield.variant });
  const flameLength = FLAME_LENGTH[engineTier]! + Math.max(0, engines - 1) * EXTRA_ENGINE_FLAME;
  const flameWidth = engines > 0 && thrusters * 2 >= engines ? 1.3 : 1;
  return { parts, flameLength, flameWidth };
}

/** Copies a fit so later in-place upgrades (`tier++`) register as a change. */
export function snapshotFit(slots: readonly (Fitted | null)[]): (Fitted | null)[] {
  return slots.map((f) => (f ? { type: f.type, variant: f.variant, tier: f.tier } : null));
}

/** True when two fits would draw the same attachments. Allocation-free; runs per ship per frame. */
export function sameFit(a: readonly (Fitted | null)[], b: readonly (Fitted | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || x.type !== y.type || x.variant !== y.variant || x.tier !== y.tier) return false;
  }
  return true;
}

// Shared geometry and materials: attachments are tiny and numerous, so every
// ship reuses the same few buffers.
const turretBase = new THREE.CylinderGeometry(1.6, 2, 1.6, 8);
const barrel = new THREE.BoxGeometry(1, 0.9, 0.9).translate(0.5, 0, 0);
const podGeo = new THREE.CapsuleGeometry(1, 1, 2, 8).rotateZ(Math.PI / 2);
const emitterGeo = new THREE.SphereGeometry(1, 10, 8);

const TURRET_COLOR: Partial<Record<VariantId, number>> = { focused: 0xff6a4a, wide: 0xc77dff };
const metal = new THREE.MeshLambertMaterial({ color: 0x8a96a8, flatShading: true });
const podMat = new THREE.MeshLambertMaterial({
  color: 0xd8a868,
  emissive: 0xffa040,
  emissiveIntensity: 0.25,
  flatShading: true,
});
const emitterMat = new THREE.MeshBasicMaterial({ color: 0x6fd0ff });
const barrelMats = new Map<number, THREE.MeshLambertMaterial>();

function barrelMat(color: number): THREE.MeshLambertMaterial {
  let m = barrelMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5, flatShading: true });
    barrelMats.set(color, m);
  }
  return m;
}

/** Height of the hull's top face, where attachments sit. */
const DECK = 2;

/** Meshes for a layout's attachments; the flame is the caller's, sized from `flameLength`. */
export function buildFittings(layout: FitLayout): THREE.Group {
  const g = new THREE.Group();
  for (const p of layout.parts) {
    if (p.kind === 'turret') {
      const t = new THREE.Group();
      t.add(new THREE.Mesh(turretBase, metal));
      const b = new THREE.Mesh(barrel, barrelMat(TURRET_COLOR[p.variant] ?? 0xff6a4a));
      // Longer barrels for higher tiers; wide beams get a stubbier, fatter barrel.
      const wide = p.variant === 'wide';
      b.scale.set((wide ? 3 : 4) + p.tier * 1.5, 1, wide ? 1.8 : 1);
      b.position.y = 0.4;
      t.add(b);
      t.position.set(p.x, DECK, p.z);
      g.add(t);
    } else if (p.kind === 'pod') {
      const m = new THREE.Mesh(podGeo, podMat);
      m.scale.set(1.6 + p.tier * 0.5, 1.6, 1.8);
      m.position.set(p.x, DECK - 1, p.z);
      g.add(m);
    } else {
      const m = new THREE.Mesh(emitterGeo, emitterMat);
      m.scale.setScalar(1 + p.tier * 0.3);
      m.position.set(p.x, DECK + 0.5, p.z);
      g.add(m);
    }
  }
  return g;
}
