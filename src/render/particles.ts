// Cosmetic particle pool (sparks, debris dust, thruster exhaust, explosions).
// Purely visual, so it uses Math.random and never touches the sim.

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
  private cursor = 0;
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
    for (let i = 0; i < CAP; i++) this.pos[i * 3 + 1] = -9999;
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
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % CAP;
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
    for (let i = 0; i < CAP; i++) {
      if (this.life[i]! <= 0) continue;
      const l = (this.life[i]! -= dt);
      if (l <= 0) {
        this.pos[i * 3 + 1] = -9999;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      const d = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 2]! *= d;
      this.vel[i * 2 + 1]! *= d;
      this.pos[i * 3]! += this.vel[i * 2]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 2 + 1]! * dt;
      const f = l / this.maxLife[i]!;
      const k = f * f;
      this.col[i * 3] = this.base[i * 3]! * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1]! * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2]! * k;
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }
}
