// Cosmetic particle pool (sparks, debris dust, thruster exhaust, explosions).
// Purely visual, so it uses Math.random and never touches the sim.
// Live particles are kept packed in slots [0, live): updates and uploads touch
// only those, and the draw range stops at `live`, so idle frames cost nothing.

import * as THREE from 'three';

const CAP = 6000;

export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 2);
  private base = new Float32Array(CAP * 3);
  private life = new Float32Array(CAP);
  private maxLife = new Float32Array(CAP);
  private drag = new Float32Array(CAP);
  /** Number of live particles; they occupy slots [0, live). */
  private live = 0;
  /** Slot to overwrite next when the pool is full (oldest first, then onward). */
  private overflow = 0;
  /** Quality scaling for emission counts (0..1). */
  density = 1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 3,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    geo.setDrawRange(0, 0);
  }

  /** How many particles are alive (for tests and debugging). */
  get count(): number {
    return this.live;
  }

  emit(
    x: number,
    z: number,
    color: THREE.Color,
    n: number,
    speed: number,
    life: number,
    opts: { dir?: number; spread?: number; drag?: number } = {},
  ): void {
    const scaled = n * this.density;
    n = Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      let i: number;
      if (this.live < CAP) i = this.live++;
      else {
        i = this.overflow;
        this.overflow = (this.overflow + 1) % CAP;
      }
      const a =
        opts.dir != null ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 0.5) : Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = 12;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 2] = Math.cos(a) * sp;
      this.vel[i * 2 + 1] = Math.sin(a) * sp;
      const j = 0.75 + Math.random() * 0.5;
      this.base[i * 3] = color.r * j;
      this.base[i * 3 + 1] = color.g * j;
      this.base[i * 3 + 2] = color.b * j;
      this.maxLife[i] = this.life[i] = life * (0.5 + Math.random() * 0.5);
      this.drag[i] = opts.drag ?? 1.5;
    }
  }

  update(dt: number): void {
    const { pos, col, vel, base, life, maxLife, drag } = this;
    // Age, move and fade every live particle, sliding survivors down over the
    // dead so slots [0, live) stay packed (and roughly oldest first).
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      const l = (life[i]! -= dt);
      if (l <= 0) continue;
      if (w !== i) {
        pos[w * 3 + 1] = pos[i * 3 + 1]!;
        vel[w * 2] = vel[i * 2]!;
        vel[w * 2 + 1] = vel[i * 2 + 1]!;
        base[w * 3] = base[i * 3]!;
        base[w * 3 + 1] = base[i * 3 + 1]!;
        base[w * 3 + 2] = base[i * 3 + 2]!;
        life[w] = l;
        maxLife[w] = maxLife[i]!;
        drag[w] = drag[i]!;
      }
      const d = Math.exp(-drag[w]! * dt);
      vel[w * 2]! *= d;
      vel[w * 2 + 1]! *= d;
      pos[w * 3] = pos[i * 3]! + vel[w * 2]! * dt;
      pos[w * 3 + 2] = pos[i * 3 + 2]! + vel[w * 2 + 1]! * dt;
      const f = l / maxLife[w]!;
      const k = f * f;
      col[w * 3] = base[w * 3]! * k;
      col[w * 3 + 1] = base[w * 3 + 1]! * k;
      col[w * 3 + 2] = base[w * 3 + 2]! * k;
      w++;
    }
    this.live = w;
    if (this.overflow >= w) this.overflow = 0;

    const g = this.points.geometry;
    g.setDrawRange(0, w);
    // Upload only the packed range; an empty pool draws and uploads nothing.
    if (w === 0) return;
    for (const name of ['position', 'color'] as const) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, w * 3);
      attr.needsUpdate = true;
    }
  }
}
