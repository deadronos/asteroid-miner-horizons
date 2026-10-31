// Sensor-ping pulse: a ground ring that expands to the ping's range and fades over a second. Reduced motion
// holds the ring at a fixed radius and fades it instead; Low quality uses fewer segments and no additive glow.

import * as THREE from 'three';
import type { Vec2 } from '../core/vec';

/** Seconds a ping pulse takes to fade out. */
export const PING_LIFE = 1;

/** A thin ground-plane ring geometry (authored in XY, laid onto XZ). */
const ringGeometry = (segments: number): THREE.BufferGeometry =>
  new THREE.RingGeometry(0.985, 1, segments).rotateX(-Math.PI / 2);

/** Ring radius and opacity at a point in the pulse. Reused so the frame loop allocates nothing. */
export interface PingShape {
  radius: number;
  opacity: number;
  visible: boolean;
}

/** Segments per quality preset: Low keeps the ring cheap, higher presets keep it smooth. */
export const pingSegments = (low: boolean): number => (low ? 24 : 96);

/**
 * The ring at `t` seconds into a ping of `range` world units. Reduced motion holds it at 85% of the range
 * and fades it, so the cue still reads without a sweeping motion.
 */
export function pingPulse(
  t: number,
  range: number,
  reducedMotion: boolean,
  out: PingShape = { radius: 0, opacity: 0, visible: false },
): PingShape {
  if (!(t >= 0) || t >= PING_LIFE) {
    out.radius = 0;
    out.opacity = 0;
    out.visible = false;
    return out;
  }
  const k = t / PING_LIFE;
  if (reducedMotion) out.radius = range * 0.85;
  else {
    // Ease out so the front of the pulse is fast, then settles at the range.
    const e = 1 - (1 - k) * (1 - k);
    out.radius = range * (0.06 + 0.94 * e);
  }
  out.opacity = (1 - k) ** 1.4;
  out.visible = true;
  return out;
}

export class PingRing {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private shape: PingShape = { radius: 0, opacity: 0, visible: false };
  private readonly pos: Vec2 = { x: 0, z: 0 };
  private range = 0;
  private elapsed = PING_LIFE;
  private low: boolean | null = null;
  private enabled = true;
  private reduced = false;

  constructor() {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geo = ringGeometry(pingSegments(false));
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.setQuality(false);
  }

  /** Low quality: no additive glow and a coarser ring. Replacing the geometry is a one-off on a settings change. */
  setQuality(low: boolean): void {
    if (this.low === low) return;
    this.low = low;
    const old = this.geo;
    this.geo = ringGeometry(pingSegments(low));
    this.mesh.geometry = this.geo;
    old.dispose();
    this.mat.blending = low ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.mat.needsUpdate = true;
  }

  /** Starts a new pulse at `pos` out to `range` world units. */
  trigger(pos: Vec2, range: number): void {
    this.pos.x = pos.x;
    this.pos.z = pos.z;
    this.range = range;
    this.elapsed = 0;
    this.mesh.position.set(pos.x, 6, pos.z);
    this.mesh.visible = this.enabled;
  }

  /** Advances the pulse; call once per rendered frame. */
  update(dt: number, reducedMotion = this.reduced): void {
    this.reduced = reducedMotion;
    if (this.elapsed >= PING_LIFE) return;
    this.elapsed += dt;
    const s = pingPulse(this.elapsed, this.range, reducedMotion, this.shape);
    this.mesh.visible = this.enabled && s.visible;
    if (!s.visible) return;
    this.mesh.scale.setScalar(s.radius);
    this.mat.opacity = s.opacity;
  }

  /** Hide the pulse while the playfield is hidden (warp) without cancelling it. */
  setVisible(on: boolean): void {
    this.enabled = on;
    if (!on) this.mesh.visible = false;
  }

  /** True while a pulse is still fading, so a paused loop keeps rendering it. */
  get busy(): boolean {
    return this.elapsed < PING_LIFE;
  }
}
