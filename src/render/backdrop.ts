// Parallax background: three starfield layers plus a per-system nebula.
// Each layer is shifted by a fraction of the camera position so far layers
// appear to move less than the playfield.

import * as THREE from 'three';
import { hash01, makeRng, next, range } from '../core/rng';
import { flat } from './util';

const LAYERS = [
  { follow: 0.92, count: 20000, size: 1, bright: 0.55 },
  { follow: 0.75, count: 14000, size: 1.6, bright: 0.75 },
  { follow: 0.5, count: 6000, size: 2.2, bright: 1 },
] as const;
const SPREAD = 9000;

export class Backdrop {
  readonly group = new THREE.Group();
  private layers: { pts: THREE.Points; follow: number }[] = [];
  private nebula: THREE.Mesh;

  constructor() {
    const r = makeRng(0xc0ffee);
    for (const L of LAYERS) {
      const pos = new Float32Array(L.count * 3);
      const col = new Float32Array(L.count * 3);
      for (let i = 0; i < L.count; i++) {
        pos[i * 3] = range(r, -SPREAD, SPREAD);
        pos[i * 3 + 1] = -200;
        pos[i * 3 + 2] = range(r, -SPREAD, SPREAD);
        const tint = next(r);
        const b = L.bright * (0.4 + next(r) * 0.6);
        col[i * 3] = b * (tint < 0.2 ? 1 : 0.8);
        col[i * 3 + 1] = b * 0.88;
        col[i * 3 + 2] = b * (tint > 0.8 ? 0.7 : 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size: L.size, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true }),
      );
      pts.frustumCulled = false;
      this.group.add(pts);
      this.layers.push({ pts, follow: L.follow });
    }
    this.nebula = new THREE.Mesh(
      flat(new THREE.PlaneGeometry(26000, 26000)),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.nebula.position.y = -300;
    this.nebula.frustumCulled = false;
    this.group.add(this.nebula);
  }

  /** Fraction of stars drawn (quality setting) and nebula visibility. */
  configure(starFraction: number, nebula: boolean): void {
    LAYERS.forEach((L, i) => this.layers[i]!.pts.geometry.setDrawRange(0, Math.round(L.count * starFraction)));
    this.nebula.visible = nebula;
  }

  /** Repaints the nebula for a system so each one looks different. */
  setSystem(seed: number): void {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const r = makeRng(seed);
    const hue = Math.floor(hash01(seed) * 360);
    for (let i = 0; i < 9; i++) {
      const x = range(r, 60, 452);
      const y = range(r, 60, 452);
      const rad = range(r, 60, 200);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const h = (hue + range(r, -50, 50) + 360) % 360;
      grad.addColorStop(0, `hsla(${h}, 60%, 35%, ${range(r, 0.025, 0.06)})`);
      grad.addColorStop(1, `hsla(${h}, 60%, 25%, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 512);
    }
    const mat = this.nebula.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = new THREE.CanvasTexture(c);
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.needsUpdate = true;
  }

  /** `halfH` is the current view half-height; stars thin out when zoomed far out. */
  update(camX: number, camZ: number, halfH: number): void {
    const fade = Math.min(1, Math.max(0.15, 700 / halfH));
    for (const l of this.layers) {
      l.pts.position.set(camX * l.follow, 0, camZ * l.follow);
      (l.pts.material as THREE.PointsMaterial).opacity = fade;
    }
    this.nebula.position.x = camX * 0.97;
    this.nebula.position.z = camZ * 0.97;
  }
}
