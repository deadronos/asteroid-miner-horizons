// Procedural planet surfaces: a kind per planet (rocky, banded gas giant, ice),
// a seeded noise texture for its surface and a fresnel atmosphere rim. Every
// look is a pure function of the generated system, so a seed replays the same
// planets. Cosmetic only: nothing here reads or writes sim state.

import * as THREE from 'three';
import { hash01, makeRng, next, type Rng } from '../core/rng';
import type { Planet, StarSystem } from '../sim/types';

export type PlanetKind = 'rocky' | 'gas' | 'ice';

/** Surface texture size; equirectangular, so twice as wide as tall. */
export const PLANET_TEX_W = 256;
export const PLANET_TEX_H = 128;

/** Orbits at or beyond this radius sit past the frost line and freeze over. */
const FROST_ORBIT = 1600;

/** Rim colour and strength per kind; gas giants tint the rim with their own colour. */
const ATMOSPHERE: Record<PlanetKind, { color: number | null; intensity: number; power: number }> = {
  rocky: { color: 0x7fb8ff, intensity: 0.8, power: 2.6 },
  gas: { color: null, intensity: 0.6, power: 2.2 },
  ice: { color: 0xc6ecff, intensity: 0.75, power: 3 },
};

/**
 * Big planets are gas giants (rings make a mid-sized one a giant too); the
 * rest are rocky inside the frost line and icy beyond it.
 */
export function planetKind(p: Planet): PlanetKind {
  if (p.radius >= 29 || (p.ringed && p.radius >= 24)) return 'gas';
  return p.orbitR >= FROST_ORBIT ? 'ice' : 'rocky';
}

/**
 * Seed for one planet's look. Built from fields `generateSystem` derives from
 * the run seed, so it needs no extra saved state and replays with the seed.
 */
export function planetSeed(sys: StarSystem, index: number): number {
  const p = sys.planets[index]!;
  let h = sys.number * 0x9e3779b1 + index;
  for (let i = 0; i < p.name.length; i++) h = Math.imul(h ^ p.name.charCodeAt(i), 0x01000193);
  h ^= Math.round(p.radius * 1000) ^ Math.round(p.orbitR * 1000);
  return Math.floor(hash01(h) * 0xffffffff);
}

/** Lattice value in [0, 1) at integer point (x, y, z) for one noise seed. */
function lattice(seed: number, x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Trilinear value noise in [0, 1). Inlined: it runs ~250k times per planet. */
function valueNoise(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const fz = smooth(z - z0);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const a = mix(lattice(seed, x0, y0, z0), lattice(seed, x1, y0, z0), fx);
  const b = mix(lattice(seed, x0, y1, z0), lattice(seed, x1, y1, z0), fx);
  const c = mix(lattice(seed, x0, y0, z1), lattice(seed, x1, y0, z1), fx);
  const d = mix(lattice(seed, x0, y1, z1), lattice(seed, x1, y1, z1), fx);
  return mix(mix(a, b, fy), mix(c, d, fy), fz);
}

/**
 * Fractal noise sampled on the unit sphere, so the texture has no seam and no
 * pinch at the poles. `freq` is the base lattice frequency; result in [0, 1).
 */
function fbm(r: Rng, freq: number, octaves: number): (x: number, y: number, z: number) => number {
  const seeds = Array.from({ length: octaves }, () => Math.floor(next(r) * 0xffffffff) | 0);
  return (x, y, z) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = freq;
    for (const s of seeds) {
      sum += valueNoise(s, x * f, y * f, z * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * One planet's surface texture, painted a few rows at a time so a warp never
 * stalls on it (a full surface costs tens of milliseconds). Until `done`, the
 * texture shows the planet's flat colour. `color` sets the hue and `kind` the
 * pattern; rows run pole to pole, and the pattern is symmetric, so either pole
 * may come first.
 */
export class PlanetSurface {
  readonly pixels: Uint8Array;
  /** GPU copy of `pixels`, uploaded once when painting finishes; the owner disposes it. */
  readonly texture: THREE.DataTexture;
  private row = 0;
  private base: [number, number, number];
  private noise: (x: number, y: number, z: number) => number;
  private detail: (x: number, y: number, z: number) => number;
  private bands: number;
  private phase: number;

  constructor(
    private kind: PlanetKind,
    color: number,
    seed: number,
    private w = PLANET_TEX_W,
    private h = PLANET_TEX_H,
  ) {
    const r = makeRng(seed);
    this.base = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
    this.noise = fbm(r, 1.6, 5);
    this.detail = fbm(r, 7, 3);
    this.bands = 5 + Math.floor(next(r) * 5);
    this.phase = next(r) * Math.PI * 2;
    this.pixels = new Uint8Array(w * h * 4);
    const flat = this.base.map((c) => Math.round(c * 255));
    for (let i = 0; i < this.pixels.length; i += 4) this.pixels.set([flat[0]!, flat[1]!, flat[2]!, 255], i);
    const tex = new THREE.DataTexture(this.pixels, w, h);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  get done(): boolean {
    return this.row >= this.h;
  }

  /**
   * Paints up to `rows` more rows and returns how many it painted; uploads the
   * texture on the call that finishes it.
   */
  paint(rows: number): number {
    const start = this.row;
    const end = Math.min(this.h, start + rows);
    for (; this.row < end; this.row++) this.paintRow(this.row);
    if (end > start && this.done) this.texture.needsUpdate = true;
    return end - start;
  }

  private paintRow(y: number): void {
    const { w, h, base, kind, pixels } = this;
    const t = y / (h - 1);
    // 0 at the equator, 1 at the poles.
    const polar = Math.abs(t - 0.5) * 2;
    const lat = (t - 0.5) * Math.PI;
    const py = Math.sin(lat);
    const ring = Math.cos(lat);
    const rgb: [number, number, number] = [0, 0, 0];
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = Math.cos(lon) * ring;
      const pz = Math.sin(lon) * ring;
      const n = this.noise(px, py, pz);
      const d = this.detail(px, py, pz);
      if (kind === 'gas') {
        // Latitude bands, warped sideways by noise so they swirl.
        const warp = (n - 0.5) * 0.07 + (d - 0.5) * 0.015;
        const band = 0.5 + 0.5 * Math.sin((t + warp) * Math.PI * this.bands + this.phase);
        const shade = mix(0.55, 1.15, band) + (d - 0.5) * 0.12;
        const pale = band * 0.3;
        for (let c = 0; c < 3; c++) rgb[c] = mix(base[c]! * shade, 1, pale);
      } else if (kind === 'ice') {
        // Pale, near-white shell; ridged noise cuts darker cracks, caps brighten.
        const ridge = 1 - Math.abs(n * 2 - 1);
        const crack = clamp01((ridge - 0.86) * 8) * 0.55;
        const cap = clamp01((polar - 0.72) * 4);
        const frost = mix(0.62, 0.9, d) + cap * 0.25;
        for (let c = 0; c < 3; c++) rgb[c] = mix(mix(base[c]!, 0.92, frost), base[c]! * 0.45, crack);
      } else {
        // Two-tone terrain: low basins dark, highlands lighter, fine grit on top.
        const land = clamp01((n - 0.47) * 10);
        const shade = mix(0.42 + n * 0.3, 0.85 + n * 0.35, land) * (0.85 + d * 0.3);
        const cap = clamp01((polar - 0.85) * 6) * 0.6;
        for (let c = 0; c < 3; c++) rgb[c] = mix(base[c]! * shade, 0.9, cap);
      }
      const i = (y * w + x) * 4;
      pixels[i] = Math.round(clamp01(rgb[0]) * 255);
      pixels[i + 1] = Math.round(clamp01(rgb[1]) * 255);
      pixels[i + 2] = Math.round(clamp01(rgb[2]) * 255);
      pixels[i + 3] = 255;
    }
  }
}

/** A fully painted surface's RGBA pixels, in one go (tests and tools). */
export function planetPixels(
  kind: PlanetKind,
  color: number,
  seed: number,
  w = PLANET_TEX_W,
  h = PLANET_TEX_H,
): Uint8Array {
  const s = new PlanetSurface(kind, color, seed, w, h);
  s.paint(h);
  return s.pixels;
}

/** Rim colour and strength for one planet. */
export function atmosphereOf(
  kind: PlanetKind,
  color: number,
): { color: THREE.Color; intensity: number; power: number } {
  const a = ATMOSPHERE[kind];
  const c = a.color == null ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35) : new THREE.Color(a.color);
  return { color: c, intensity: a.intensity, power: a.power };
}

/** Outer radius of the atmosphere halo, as a multiple of the planet radius. */
export const HALO_SCALE = 1.2;
/** The limb glow sits just above the surface so it never z-fights it. */
export const RIM_SCALE = 1.01;

/**
 * Additive atmosphere shell, in two layers drawn on spheres around the planet:
 * - `rim` (front faces, `RIM_SCALE`): fresnel brightening toward the limb,
 *   clear where the surface faces the camera.
 * - `halo` (back faces, `HALO_SCALE`): the glow outside the disc, brightest at
 *   the limb and fading to nothing at the shell's edge, so there is no hard ring.
 *   The planet's depth hides the half of the shell behind it.
 */
export function atmosphereMaterial(kind: PlanetKind, color: number, layer: 'rim' | 'halo'): THREE.ShaderMaterial {
  const a = atmosphereOf(kind, color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: a.color },
      uIntensity: { value: a.intensity },
      uPower: { value: a.power },
      // |n·v| of the halo's back faces where they meet the planet's silhouette.
      uEdge: { value: Math.sqrt(1 - 1 / (HALO_SCALE * HALO_SCALE)) },
    },
    defines: layer === 'halo' ? { HALO: '' } : {},
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      uniform float uEdge;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float nv = dot(normalize(vNormal), vView);
        #ifdef HALO
          float f = pow(clamp(-nv / uEdge, 0.0, 1.0), 1.6);
        #else
          float f = pow(1.0 - clamp(nv, 0.0, 1.0), uPower);
        #endif
        gl_FragColor = vec4(uColor * f * uIntensity, 1.0);
      }`,
    side: layer === 'halo' ? THREE.BackSide : THREE.FrontSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
