// The top-down orthographic camera and its view state: zoom easing, following
// the selected ship, pan, the system-map toggle and screen ↔ world mapping.
// Screen right = +x, screen up = −z.

import * as THREE from 'three';
import { clamp, damp, type Vec2 } from '../core/vec';
import type { StarSystem } from '../sim/types';
import type { ViewRect } from './cull';

export const ZOOM_MIN = 90;
export const ZOOM_MAX = 3200;

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  /** View state. `follow` keeps the camera on the selected ship. */
  center: Vec2 = { x: 0, z: 0 };
  halfH = 420;
  targetHalfH = 420;
  follow = true;
  /** False until the first follow after a system change, so the camera snaps instead of gliding. */
  private snapped = false;
  /** Zoom to go back to when the system map is toggled off. */
  private mapReturn = 420;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
  ) {
    this.camera.up.set(0, 0, -1);
  }

  get aspect(): number {
    return this.container.clientWidth / Math.max(1, this.container.clientHeight);
  }

  /** The visible world rectangle (center + half extents), for audio falloff. */
  get view(): { center: Vec2; halfW: number; halfH: number } {
    return { center: this.center, halfW: this.halfH * this.aspect, halfH: this.halfH };
  }

  /** World units per CSS pixel at the current zoom. */
  get wpp(): number {
    return (this.halfH * 2) / Math.max(1, this.container.clientHeight);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = ((clientY - r.top) / r.height) * 2 - 1;
    return { x: this.center.x + nx * this.halfH * this.aspect, z: this.center.z + ny * this.halfH };
  }

  /** World point → CSS pixels relative to the scene container. */
  worldToScreen(p: Vec2): { x: number; y: number } {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return {
      x: ((p.x - this.center.x) / (this.halfH * this.aspect) + 1) * 0.5 * w,
      y: ((p.z - this.center.z) / this.halfH + 1) * 0.5 * h,
    };
  }

  /** True when `p` is inside the (unshaken) view. */
  onScreen(p: Vec2): boolean {
    return Math.abs(p.x - this.center.x) < this.halfH * this.aspect && Math.abs(p.z - this.center.z) < this.halfH;
  }

  /** Zooms by `factor`, keeping the world point under the cursor fixed (unless following). */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const next = clamp(this.targetHalfH * factor, ZOOM_MIN, ZOOM_MAX);
    if (!this.follow) {
      const p = this.screenToWorld(clientX, clientY);
      const k = next / this.halfH;
      this.center = { x: p.x + (this.center.x - p.x) * k, z: p.z + (this.center.z - p.z) * k };
      this.halfH = next;
    }
    this.targetHalfH = next;
  }

  panPixels(dx: number, dy: number): void {
    this.follow = false;
    this.center.x -= dx * this.wpp;
    this.center.z -= dy * this.wpp;
  }

  /** Toggle between a whole-system overview and the previous zoom. */
  toggleMap(sys: StarSystem): void {
    const fit = clamp(
      Math.max(...sys.planets.map((p) => p.orbitR), ...sys.belts.map((b) => b.outer)) * 1.08,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    if (Math.abs(this.targetHalfH - fit) > 1) {
      this.mapReturn = this.targetHalfH;
      this.follow = false;
      this.center = { x: 0, z: 0 };
      this.targetHalfH = fit;
    } else {
      this.targetHalfH = this.mapReturn;
      this.follow = true;
    }
  }

  /** The next follow snaps to its target instead of gliding (after a system change). */
  resetSnap(): void {
    this.snapped = false;
  }

  /** Eases the zoom toward its target and, while following, the center toward `focus`. */
  ease(dt: number, focus: Vec2 | null): void {
    this.halfH += (this.targetHalfH - this.halfH) * (1 - damp(12, dt));
    if (this.follow && focus) {
      const k = this.snapped ? 1 - damp(6, dt) : 1;
      this.center.x += (focus.x - this.center.x) * k;
      this.center.z += (focus.z - this.center.z) * k;
      this.snapped = true;
    }
  }

  /**
   * Places the camera at the center offset by (`sx`, `sz`) shake, with the view
   * scaled by `zoom` (the warp's zoom; the player's zoom target is untouched),
   * and writes the resulting world rectangle into `out`.
   */
  place(sx: number, sz: number, zoom: number, out: ViewRect): ViewRect {
    const cx = this.center.x + sx;
    const cz = this.center.z + sz;
    const a = this.aspect;
    const vh = this.halfH * zoom;
    const cam = this.camera;
    cam.left = -vh * a;
    cam.right = vh * a;
    cam.top = vh;
    cam.bottom = -vh;
    cam.position.set(cx, 1000, cz);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    out.x = cx;
    out.z = cz;
    out.halfW = vh * a;
    out.halfH = vh;
    return out;
  }
}
