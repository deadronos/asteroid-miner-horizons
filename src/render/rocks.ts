// Asteroids and pickups drawn with InstancedMesh: a handful of draw calls no
// matter how many rocks exist. Rocks pick a shape pool by kind, then by id.
// Damage reads at a glance: rocks shrink a little, glowing cracks spread
// across them (a per-instance shader attribute) and they shudder while hit.

import * as THREE from 'three';
import { hash01 } from '../core/rng';
import { RAW_RESOURCES, RESOURCE_INFO, type RawResource } from '../data/resources';
import type { RockTrait } from '../data/traits';
import { TUNING } from '../data/tuning';
import type { Pickup, Rock } from '../sim/types';
import { inView, type ViewRect } from './cull';
import { rockGeometry, type RockStyle } from './util';

/** Number of shared rock shape pools: two shapes for each of the three kinds. */
export const ROCK_POOLS = 6;
/** `aTrait` shader value per trait; also the fragment accent branch order. */
const TRAIT_INDEX: Record<RockTrait, number> = { volatile: 1, dense: 2, magnetic: 3 };
/** Shader value for a rock's trait: volatile 1, dense 2, magnetic 3, plain 0. */
export const traitIndex = (trait: RockTrait | undefined): number => (trait ? TRAIT_INDEX[trait] : 0);
const STYLE_OF: Record<RawResource, RockStyle> = { ore: 'rock', ice: 'gem', crystal: 'shard' };
/** Shape family a kind is drawn with: ore `rock`, ice `gem`, crystal `shard`. */
export const rockStyleOf = (kind: RawResource): RockStyle => STYLE_OF[kind];
/**
 * Which of the six shape pools a rock uses: each kind owns a two-pool block
 * (`ore` 0–1, `ice` 2–3, `crystal` 4–5) and `id` picks within it.
 */
export const rockShapeIndex = (kind: RawResource, id: number): number =>
  RAW_RESOURCES.indexOf(kind) * 2 + (((id % 2) + 2) % 2);

export const ROCK_TINT: Record<RawResource, THREE.Color> = {
  ore: new THREE.Color(0x9c7b5e),
  ice: new THREE.Color(0xc4ecf8),
  crystal: new THREE.Color(0xc48cff),
};
const HOT = new THREE.Color(0xff5a2a);
/**
 * Cull radii. The `rock` style is the largest at 1.22× a rock's radius (see
 * `rockGeometry`), so it drives this bound; shudder adds 3.5%. A pickup's
 * octahedron tops out near 8 units.
 */
const ROCK_BOUND = 1.3;
const PICKUP_BOUND = 10;

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();

class InstancePool {
  mesh: THREE.InstancedMesh;
  /** Per-instance (damage 0..1, crack seed, self-glow), only when `withDamage`. */
  damage: THREE.InstancedBufferAttribute | null = null;
  /** Per-instance trait index (see `traitIndex`), only when `withDamage`. */
  trait: THREE.InstancedBufferAttribute | null = null;
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    capacity: number,
    private readonly withDamage = false,
  ) {
    this.mesh = this.make(capacity);
  }

  private make(capacity: number): THREE.InstancedMesh {
    if (this.withDamage) {
      this.damage = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.damage.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute('aDamage', this.damage);
      this.trait = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      this.trait.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute('aTrait', this.trait);
    }
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
    if (this.damage) this.damage.needsUpdate = true;
    if (this.trait) this.trait.needsUpdate = true;
  }
}

/** Fragment `uKind` value per kind; also the order of `RAW_RESOURCES`. */
const KIND_INDEX: Record<RawResource, number> = { ore: 0, ice: 1, crystal: 2 };
/** Per-kind highlight: ore is a dull warm sheen, ice a tight pale one. */
const KIND_SURFACE: Record<RawResource, { shininess: number; specular: number; emissive?: number }> = {
  ore: { shininess: 8, specular: 0x6b4a2a },
  ice: { shininess: 70, specular: 0xcfeaff },
  crystal: { shininess: 45, specular: 0xb98cff, emissive: 0x1a0a33 },
};

/**
 * Patches a Phong material with the shared rock shader: emissive crack lines
 * (thin bands of 3D value noise in object space that widen and spread as
 * `aDamage.x` rises) plus a `uKind` branch that shades ore veins, an icy
 * fresnel rim, or crystal facets, and a tint keyed on the per-instance
 * `aTrait`. `uKind` is a uniform rather than a define so all three kinds share
 * one program.
 */
function patchRock(mat: THREE.MeshPhongMaterial, kind: RawResource): void {
  const kindIndex = KIND_INDEX[kind];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = crackTime;
    shader.uniforms.uGlow = selfGlow;
    shader.uniforms.uKind = { value: kindIndex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aDamage;
attribute float aTrait;
varying vec3 vDamage;
varying vec3 vObj;
varying float vTrait;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vDamage = aDamage;
vObj = position;
vTrait = aTrait;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uGlow;
uniform float uKind;
varying vec3 vDamage;
varying vec3 vObj;
varying float vTrait;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (uKind < 0.5) {
  // Ore: ridged object-space noise reads as warm metal veins.
  float r1 = 1.0 - abs(2.0 * vnoise(vObj * 2.4) - 1.0);
  float r2 = 1.0 - abs(2.0 * vnoise(vObj * 5.1 + 11.0) - 1.0);
  float vein = smoothstep(0.55, 0.95, r1 * 0.65 + r2 * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.66, 0.28), vein * 0.55);
  totalEmissiveRadiance += vec3(1.0, 0.55, 0.2) * vein * 0.1;
} else if (uKind < 1.5) {
  // Ice: a fresnel rim fakes the pale glow of a translucent block.
  float rim = pow(max(0.0, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))), 3.0);
  totalEmissiveRadiance += vec3(0.55, 0.88, 1.0) * rim * (0.4 + 0.35 * uGlow);
} else {
  // Crystal: hash the flat facet normal so whole facets light as units, gated
  // by an object-space mask and pulsed slowly.
  float facet = hash3(floor(normal * 9.0));
  float mask = smoothstep(0.42, 0.86, vnoise(vObj * 4.2));
  float pulse = 0.75 + 0.25 * sin(uTime * 1.6 + facet * 6.283185);
  totalEmissiveRadiance += vec3(0.58, 0.3, 1.0) * facet * mask * pulse * (0.3 + 0.5 * uGlow);
}
// Trait accent: a steady tint so traited rocks read at a glance from any angle.
if (vTrait > 2.5) {
  totalEmissiveRadiance += vec3(0.35, 0.82, 1.0) * 0.2;
} else if (vTrait > 1.5) {
  totalEmissiveRadiance += vec3(0.56, 0.65, 0.72) * 0.2;
} else if (vTrait > 0.5) {
  totalEmissiveRadiance += vec3(1.0, 0.42, 0.23) * 0.2;
}
totalEmissiveRadiance += diffuseColor.rgb * vDamage.z * uGlow * (0.85 + 0.15 * sin(uTime * 2.0 + vDamage.y * 20.0));
if (vDamage.x > 0.001) {
  vec3 q = vObj * 2.6 + vDamage.y * 17.0;
  float n = vnoise(q) * 0.65 + vnoise(q * 2.3) * 0.35;
  float w = 0.012 + 0.05 * vDamage.x;
  float line = 1.0 - smoothstep(0.0, w, abs(n - 0.5));
  // Cracks start in a few places and spread over the rock as damage grows.
  float reach = smoothstep(vDamage.x * 1.25, vDamage.x * 1.25 - 0.15, vnoise(vObj * 1.3 + vDamage.y * 5.0));
  float glow = line * reach * (0.7 + 0.3 * sin(uTime * 9.0 + vDamage.y * 30.0));
  totalEmissiveRadiance += vec3(1.0, 0.45, 0.12) * glow * (1.2 + 1.8 * vDamage.x);
}`,
      );
  };
}

const crackTime = { value: 0 };
const selfGlow = { value: 0.22 };

/**
 * One material per raw kind, all three sharing the `patchRock` shader (uniform
 * `uKind`, not a define, so there is still a single program).
 */
export function rockMaterial(kind: RawResource): THREE.MeshPhongMaterial {
  const surface = KIND_SURFACE[kind];
  const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true });
  mat.specular = new THREE.Color(surface.specular);
  mat.shininess = surface.shininess;
  if (surface.emissive !== undefined) mat.emissive = new THREE.Color(surface.emissive);
  patchRock(mat, kind);
  return mat;
}

export class RockView {
  readonly group = new THREE.Group();
  private rocks: InstancePool[] = [];
  private pickups: InstancePool;
  private buckets: Rock[][] = Array.from({ length: ROCK_POOLS }, () => []);
  /**
   * HDR boost for things that should bloom (crystals, pickups). 1 without
   * bloom, so colours stay exactly as authored when there's no post-processing.
   */
  set glow(k: number) {
    this.glowK = k;
    selfGlow.value = 0.22 * k;
  }
  private glowK = 1;
  /** Cosmetic hit tracking: last seen hp and when the rock last lost some. */
  private lastHp = new Map<number, number>();
  private hitAt = new Map<number, number>();

  constructor() {
    // Two shape pools per kind (`ore` 0–1, `ice` 2–3, `crystal` 4–5), each pair
    // sharing its kind's material. `update` buckets by `rockShapeIndex`.
    const mats = RAW_RESOURCES.map(rockMaterial);
    for (let i = 0; i < ROCK_POOLS; i++) {
      const kind = RAW_RESOURCES[Math.floor(i / 2)]!;
      this.rocks.push(
        new InstancePool(
          this.group,
          rockGeometry(1000 + i * 77, rockStyleOf(kind)),
          mats[Math.floor(i / 2)]!,
          256,
          true,
        ),
      );
    }
    this.pickups = new InstancePool(
      this.group,
      new THREE.OctahedronGeometry(1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      256,
    );
  }

  /**
   * Writes instances for the rocks and pickups inside `view` only; everything
   * else is skipped, so a zoomed-in camera composes and uploads a handful of
   * matrices instead of the whole belt.
   */
  update(rocks: readonly Rock[], pickups: readonly Pickup[], time: number, view: ViewRect): void {
    crackTime.value = time;
    for (const b of this.buckets) b.length = 0;
    for (const r of rocks) {
      // Hit tracking runs for every rock, so one that drifts into view after
      // being mined off-screen doesn't shudder as if it had just been hit.
      const prev = this.lastHp.get(r.id);
      if (prev != null && r.hp < prev - 1e-6) this.hitAt.set(r.id, time);
      this.lastHp.set(r.id, r.hp);
      if (inView(view, r.pos.x, r.pos.z, r.radius * ROCK_BOUND)) this.buckets[rockShapeIndex(r.kind, r.id)]!.push(r);
    }
    // Forget rocks that no longer exist (cracked or despawned).
    if (this.lastHp.size > rocks.length + 64) {
      const live = new Set(rocks.map((r) => r.id));
      for (const id of this.lastHp.keys()) if (!live.has(id)) this.lastHp.delete(id);
      for (const id of this.hitAt.keys()) if (!live.has(id)) this.hitAt.delete(id);
    }

    this.buckets.forEach((bucket, vi) => {
      const pool = this.rocks[vi]!;
      pool.reserve(bucket.length);
      bucket.forEach((r, i) => {
        const h = hash01(r.id);
        e.set(h * 6.28, time * (h - 0.5) * 0.9 + h * 10, hash01(r.id + 7) * 6.28);
        q.setFromEuler(e);
        const dmg = 1 - Math.max(0, r.hp) / r.maxHp;
        const since = time - (this.hitAt.get(r.id) ?? -1);
        const shudder = since < 0.15 ? Math.sin(time * 70 + r.id) * 0.035 : 0;
        const k = r.radius * (1 - 0.12 * dmg) * (1 + shudder);
        p.set(r.pos.x, 0, r.pos.z);
        s.set(k, k * 0.8, k);
        pool.mesh.setMatrixAt(i, m.compose(p, q, s));
        c.copy(ROCK_TINT[r.kind])
          .multiplyScalar(0.85 + h * 0.3)
          .lerp(HOT, dmg * 0.35);
        pool.mesh.setColorAt(i, c);
        pool.damage!.setXYZ(i, dmg, h, r.kind === 'crystal' ? 1 : 0);
        pool.trait!.setX(i, traitIndex(r.trait));
      });
      pool.commit(bucket.length);
    });

    const pp = this.pickups;
    pp.reserve(pickups.length);
    let n = 0;
    for (const pk of pickups) {
      if (!inView(view, pk.pos.x, pk.pos.z, PICKUP_BOUND)) continue;
      const fade = Math.min(1, (TUNING.pickupLifetime - pk.age) / 5);
      const size = (3 + Math.min(4, Math.sqrt(pk.amount) * 1.4)) * (1 + Math.sin(time * 6 + pk.id) * 0.12) * fade;
      q.setFromEuler(e.set(0.6, time * 2.5 + pk.id, 0.4));
      p.set(pk.pos.x, 4, pk.pos.z);
      s.setScalar(Math.max(0.01, size));
      pp.mesh.setMatrixAt(n, m.compose(p, q, s));
      pp.mesh.setColorAt(n, c.setHex(RESOURCE_INFO[pk.kind].color).multiplyScalar(this.glowK));
      n++;
    }
    pp.commit(n);
  }
}
