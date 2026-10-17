// Asteroids and pickups drawn with InstancedMesh: a handful of draw calls no
// matter how many rocks exist. Rocks pick one of several shared shapes by id.

import * as THREE from 'three';
import { hash01 } from '../core/rng';
import { RESOURCE_INFO, type Resource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Pickup, Rock } from '../sim/types';
import { rockGeometry } from './util';

const VARIANTS = 6;
const ROCK_TINT: Record<Resource, THREE.Color> = {
  ore: new THREE.Color(0x9c7b5e),
  ice: new THREE.Color(0xc4ecf8),
  crystal: new THREE.Color(0xc48cff),
};
const HOT = new THREE.Color(0xff5a2a);

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();

class InstancePool {
  mesh: THREE.InstancedMesh;
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    capacity: number,
  ) {
    this.mesh = this.make(capacity);
  }

  private make(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, c.set(0xffffff)); // allocate instanceColor
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.parent.add(mesh);
    return mesh;
  }

  /** Ensures room for n instances, growing (×2) when needed. */
  reserve(n: number): void {
    if (n <= this.mesh.instanceMatrix.count) return;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = this.make(Math.max(n, this.mesh.instanceMatrix.count * 2));
  }

  commit(n: number): void {
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class RockView {
  readonly group = new THREE.Group();
  private rocks: InstancePool[] = [];
  private pickups: InstancePool;
  private buckets: Rock[][] = Array.from({ length: VARIANTS }, () => []);

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    for (let i = 0; i < VARIANTS; i++) this.rocks.push(new InstancePool(this.group, rockGeometry(1000 + i * 77), mat, 256));
    this.pickups = new InstancePool(
      this.group,
      new THREE.OctahedronGeometry(1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      256,
    );
  }

  update(rocks: readonly Rock[], pickups: readonly Pickup[], time: number): void {
    for (const b of this.buckets) b.length = 0;
    for (const r of rocks) this.buckets[r.id % VARIANTS]!.push(r);

    this.buckets.forEach((bucket, vi) => {
      const pool = this.rocks[vi]!;
      pool.reserve(bucket.length);
      bucket.forEach((r, i) => {
        const h = hash01(r.id);
        e.set(h * 6.28, time * (h - 0.5) * 0.9 + h * 10, hash01(r.id + 7) * 6.28);
        q.setFromEuler(e);
        p.set(r.pos.x, 0, r.pos.z);
        s.set(r.radius, r.radius * 0.8, r.radius);
        pool.mesh.setMatrixAt(i, m.compose(p, q, s));
        const dmg = 1 - Math.max(0, r.hp) / r.maxHp;
        c.copy(ROCK_TINT[r.kind]).multiplyScalar(0.85 + h * 0.3).lerp(HOT, dmg * 0.55);
        pool.mesh.setColorAt(i, c);
      });
      pool.commit(bucket.length);
    });

    const pp = this.pickups;
    pp.reserve(pickups.length);
    pickups.forEach((pk, i) => {
      const fade = Math.min(1, (TUNING.pickupLifetime - pk.age) / 5);
      const size = (3 + Math.min(4, Math.sqrt(pk.amount) * 1.4)) * (1 + Math.sin(time * 6 + pk.id) * 0.12) * fade;
      q.setFromEuler(e.set(0.6, time * 2.5 + pk.id, 0.4));
      p.set(pk.pos.x, 4, pk.pos.z);
      s.setScalar(Math.max(0.01, size));
      pp.mesh.setMatrixAt(i, m.compose(p, q, s));
      pp.mesh.setColorAt(i, c.setHex(RESOURCE_INFO[pk.kind].color));
    });
    pp.commit(pickups.length);
  }
}
