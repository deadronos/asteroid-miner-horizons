// Tumbling rock chunks thrown out when an asteroid cracks. One InstancedMesh
// ring buffer; purely visual, so it uses Math.random and never touches the sim.

import * as THREE from 'three';
import { rockGeometry } from './util';

const CAP = 240;

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private pos = new Float32Array(CAP * 2);
  private vel = new Float32Array(CAP * 2);
  private rot = new Float32Array(CAP * 3);
  private spin = new Float32Array(CAP * 3);
  private size = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private maxLife = new Float32Array(CAP);
  private cursor = 0;
  /** Quality scaling for emission counts (0..1). */
  density = 1;

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      rockGeometry(4242),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      CAP,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, c.set(0xffffff));
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
  }

  /** Throws chunks out from a cracked rock of `radius`, tinted `color`. */
  burst(x: number, z: number, radius: number, color: THREE.Color): void {
    const scaled = Math.min(18, 3 + radius / 3.5) * this.density;
    const n = Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % CAP;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.6;
      const sp = 30 + Math.random() * (40 + radius * 2.5);
      this.pos[i * 2] = x + Math.cos(a) * r;
      this.pos[i * 2 + 1] = z + Math.sin(a) * r;
      this.vel[i * 2] = Math.cos(a) * sp;
      this.vel[i * 2 + 1] = Math.sin(a) * sp;
      for (let j = 0; j < 3; j++) {
        this.rot[i * 3 + j] = Math.random() * 6.28;
        this.spin[i * 3 + j] = (Math.random() - 0.5) * 9;
      }
      this.size[i] = Math.max(1.2, radius * (0.07 + Math.random() * 0.1));
      this.maxLife[i] = this.life[i] = 0.8 + Math.random() * 0.8;
      this.mesh.setColorAt(i, c.copy(color).multiplyScalar(0.7 + Math.random() * 0.4));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const drag = Math.exp(-1.8 * dt);
    let any = false;
    for (let i = 0; i < CAP; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      const l = (this.life[i]! -= dt);
      if (l <= 0) {
        this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      this.vel[i * 2]! *= drag;
      this.vel[i * 2 + 1]! *= drag;
      this.pos[i * 2]! += this.vel[i * 2]! * dt;
      this.pos[i * 2 + 1]! += this.vel[i * 2 + 1]! * dt;
      for (let j = 0; j < 3; j++) this.rot[i * 3 + j]! += this.spin[i * 3 + j]! * dt;
      // Shrink away over the last third of the chunk's life.
      const f = Math.min(1, (l / this.maxLife[i]!) * 3);
      e.set(this.rot[i * 3]!, this.rot[i * 3 + 1]!, this.rot[i * 3 + 2]!);
      p.set(this.pos[i * 2]!, 6, this.pos[i * 2 + 1]!);
      s.setScalar(this.size[i]! * f);
      this.mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
