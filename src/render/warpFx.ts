// Warp transition: the starfield stretches into radial streaks while the camera
// dives in, a white-out flashes over the swap, then the new system is revealed
// as the camera settles. Purely visual; the sim has already warped by the time it plays.

import * as THREE from 'three';
import { makeRng, range } from '../core/rng';

/** Seconds from the warp until the white-out peaks and the new system is revealed. */
export const WARP_OUT = 0.5;
/** Total length of the sequence in seconds. */
export const WARP_TOTAL = 1.2;

/** One frame of the warp sequence; every field is 0 (or 1 for `zoom`) at rest. */
export interface WarpFrame {
  /** 0..1 how far stars are stretched into streaks. */
  stretch: number;
  /** Multiplier on the view half-height: below 1 dives in, above 1 arrives from further out. */
  zoom: number;
  /** 0..1 white-out intensity for the HUD overlay. */
  flash: number;
  /** True while the playfield is hidden behind the streaks, before the reveal. */
  hidden: boolean;
  /** 0..1 camera shudder, scaled by the shake setting. */
  shudder: number;
}

export const WARP_REST: Readonly<WarpFrame> = { stretch: 0, zoom: 1, flash: 0, hidden: false, shudder: 0 };

function set(out: WarpFrame, stretch: number, zoom: number, flash: number, hidden: boolean, shudder: number) {
  out.stretch = stretch;
  out.zoom = zoom;
  out.flash = flash;
  out.hidden = hidden;
  out.shudder = shudder;
  return out;
}

/**
 * The warp sequence at `t` seconds since it started, written into `out` (reused
 * per frame so the render loop does not allocate); at rest outside [0, WARP_TOTAL).
 */
export function warpFrame(t: number, out: WarpFrame = { ...WARP_REST }): WarpFrame {
  if (!(t >= 0) || t >= WARP_TOTAL) return set(out, 0, 1, 0, false, 0);
  if (t < WARP_OUT) {
    // Dive: streaks and zoom ease in, the white-out ramps up over the last stretch.
    const k = t / WARP_OUT;
    const f = Math.max(0, (k - 0.55) / 0.45);
    return set(out, k * k, 1 - 0.65 * k * k, f * f, true, k);
  }
  // Arrive: the new system shows through the fading white-out as the camera settles.
  const v = 1 - (t - WARP_OUT) / (WARP_TOTAL - WARP_OUT);
  return set(out, v * v * 0.6, 1 + 1.2 * v * v * v, v * v, false, 0);
}

/**
 * Scales down warp motion/flash for reduced-motion displays while preserving
 * the timeline and hidden/reveal phases.
 */
export function toneDownWarpMotion(frame: WarpFrame, motion = 1): WarpFrame {
  const k = motion < 0 ? 0 : motion > 1 ? 1 : motion;
  frame.stretch *= 0.55 + 0.45 * k;
  frame.zoom = 1 + (frame.zoom - 1) * (0.5 + 0.5 * k);
  frame.flash *= 0.25 + 0.75 * k;
  frame.shudder *= k;
  return frame;
}

const STREAKS = 700;

/** Radial streak lines drawn in view space around the camera centre. */
export class WarpStreaks {
  readonly lines: THREE.LineSegments;
  /** Normalised view position (−1..1 on each axis) and length jitter per streak. */
  private seeds = new Float32Array(STREAKS * 3);
  private pos: THREE.BufferAttribute;

  constructor() {
    const r = makeRng(0x5ea7);
    const col = new Float32Array(STREAKS * 6);
    for (let i = 0; i < STREAKS; i++) {
      // Keep streaks off dead centre so they read as flying past, not out of a point.
      let x = 0;
      let z = 0;
      do {
        x = range(r, -1.2, 1.2);
        z = range(r, -1.2, 1.2);
      } while (x * x + z * z < 0.02);
      this.seeds[i * 3] = x;
      this.seeds[i * 3 + 1] = z;
      this.seeds[i * 3 + 2] = range(r, 0.4, 1);
      const b = range(r, 0.5, 1);
      // Dim tail toward the centre, bright blue-white head toward the edge.
      col.set([b * 0.2, b * 0.3, b * 0.5, b * 0.85, b * 0.92, b], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  /** Lays the streaks out around the camera for this frame; hidden when `stretch` is 0. */
  update(stretch: number, cx: number, cz: number, halfW: number, halfH: number): void {
    this.lines.visible = stretch > 0.001;
    if (!this.lines.visible) return;
    const a = this.pos.array as Float32Array;
    const s = this.seeds;
    for (let i = 0; i < STREAKS; i++) {
      const x = s[i * 3]!;
      const z = s[i * 3 + 1]!;
      const len = s[i * 3 + 2]!;
      // Streaks lengthen with stretch and with distance from the centre, like a dive.
      const inner = 1 + 0.15 * stretch;
      const outer = inner + stretch * len * (0.3 + Math.hypot(x, z)) * 1.4;
      a[i * 6] = cx + x * inner * halfW;
      a[i * 6 + 1] = -150;
      a[i * 6 + 2] = cz + z * inner * halfH;
      a[i * 6 + 3] = cx + x * outer * halfW;
      a[i * 6 + 4] = -150;
      a[i * 6 + 5] = cz + z * outer * halfH;
    }
    this.pos.needsUpdate = true;
    (this.lines.material as THREE.LineBasicMaterial).opacity = Math.min(1, stretch * 1.6);
  }
}
