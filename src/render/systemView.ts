// Static-ish scenery for one star system: star, heat zone, planets, moons,
// orbit lines, belt haze and the mining station. Rebuilt whenever the run gets a
// new system: warp, load or new game.

import * as THREE from 'three';
import { makeRng, next } from '../core/rng';
import type { RawResource } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { StarSystem } from '../sim/types';
import { palette, paletteGeneration } from './activePalette';
import { planetPos } from './labels';
import { HALO_SCALE, PlanetSurface, RIM_SCALE, atmosphereMaterial, planetKind, planetSeed } from './planetLook';
import { additive, circleLoop, flat, glowTexture } from './util';

/** Radians the planets' spin axes lean toward the camera. */
const PLANET_TILT = 0.35;
/** Milliseconds per frame spent painting planet surfaces (a row costs ~0.2 ms). */
const PAINT_BUDGET_MS = 3;

/** Ring geometry with radial UVs (u = 0 at inner edge, 1 at outer edge) for 1D banded ring textures. */
function planetRingGeometry(inner: number, outer: number, segments = 64): THREE.BufferGeometry {
  const geo = flat(new THREE.RingGeometry(inner, outer, segments));
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const span = Math.max(1e-5, outer - inner);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    uv.setXY(i, (r - inner) / span, 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Procedural concentric radial-band texture for a ringed planet, seeded deterministically. */
export function planetRingTexture(seed: number, color: number): THREE.CanvasTexture {
  const w = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 1;
  const g = c.getContext('2d')!;
  const r = makeRng(seed ^ 0x51a7);
  const gap1 = 0.32 + next(r) * 0.24;
  const gap2 = 0.68 + next(r) * 0.16;
  const f1 = 10 + next(r) * 14;
  const f2 = 26 + next(r) * 24;
  const p1 = next(r) * Math.PI * 2;
  const p2 = next(r) * Math.PI * 2;
  // Warm sandy-ice base blended gently with the planet's own colour.
  const br = Math.round(((color >> 16) & 255) * 0.35 + 216 * 0.65);
  const bg = Math.round(((color >> 8) & 255) * 0.35 + 200 * 0.65);
  const bb = Math.round((color & 255) * 0.35 + 160 * 0.65);
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const edge = Math.min(1, t / 0.08, (1 - t) / 0.1);
    const band = 0.55 + 0.28 * Math.sin(t * f1 + p1) + 0.17 * Math.sin(t * f2 + p2);
    const d1 = Math.abs(t - gap1);
    const d2 = Math.abs(t - gap2);
    const gap = (d1 < 0.045 ? (d1 / 0.045) ** 2 : 1) * (d2 < 0.025 ? (d2 / 0.025) ** 2 : 1);
    const alpha = Math.max(0, Math.min(1, edge * band * gap * 0.9));
    const shade = 0.78 + 0.28 * band;
    const cr = Math.min(255, Math.round(br * shade));
    const cg = Math.min(255, Math.round(bg * shade));
    const cb = Math.min(255, Math.round(bb * shade));
    g.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
    g.fillRect(x, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export class SystemView {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private planets: { body: THREE.Mesh; moons: THREE.Mesh[]; ring: THREE.Mesh | null }[] = [];
  /** Planet surfaces; their textures are not reached by the material traversal in `dispose`. */
  private surfaces: PlanetSurface[] = [];
  /** Procedural ring textures owned by this view; disposed on rebuild. */
  private ringTextures: THREE.Texture[] = [];
  private station = new THREE.Group();
  private stationRing!: THREE.Mesh;
  private beacons: THREE.Mesh[] = [];
  private dockRing: THREE.LineLoop | null = null;
  private heatRing: THREE.LineLoop | null = null;
  private beltBands: { mesh: THREE.Mesh; kind: RawResource }[] = [];
  private starGlow: THREE.Sprite[] = [];
  private glowOpacity: number[] = [];
  /** The system this view was built from; compared by identity, since names repeat across games. */
  private shown: StarSystem | null = null;
  private paletteGen = -1;

  constructor() {
    this.light = new THREE.PointLight(0xffffff, 3.2, 0, 0);
    this.light.position.set(0, 220, 0);
  }

  /** Rebuilds for `sys` unless it is the system already shown; true when it rebuilt. */
  sync(sys: StarSystem): boolean {
    if (sys === this.shown) return false;
    this.build(sys);
    return true;
  }

  private build(sys: StarSystem): void {
    this.dispose();
    this.shown = sys;
    const g = this.group;
    this.light.color.setHex(sys.starColor).lerp(new THREE.Color(0xffffff), 0.55);
    g.add(this.light);

    // Star: hot core plus two additive glow sprites.
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(sys.starRadius, 48, 24),
      new THREE.MeshBasicMaterial({ color: sys.starColor }),
    );
    g.add(star);
    for (const [scale, op] of [
      [4.5, 0.85],
      [11, 0.25],
    ] as const) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: sys.starColor,
          transparent: true,
          opacity: op,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      s.scale.setScalar(sys.starRadius * scale);
      s.position.y = 30;
      g.add(s);
      this.starGlow.push(s);
      this.glowOpacity.push(op);
    }
    const pal = palette();
    const heat = circleLoop(sys.heatRadius, pal.bad, 0.35, 120);
    this.heatRing = heat;
    g.add(heat);

    // Belt haze: a faint band so the belts read even when zoomed out.
    for (const b of sys.belts) {
      const kind: RawResource = b.mix.crystal > 0.2 ? 'crystal' : b.mix.ice > b.mix.ore ? 'ice' : 'ore';
      const band = new THREE.Mesh(
        flat(new THREE.RingGeometry(b.inner, b.outer, 160, 1)),
        additive(pal.resource[kind], 0.035),
      );
      band.position.y = -20;
      g.add(band);
      this.beltBands.push({ mesh: band, kind });
    }

    sys.planets.forEach((p, i) => {
      const orbit = circleLoop(p.orbitR, 0x35507a, 0.35);
      orbit.position.y = -10;
      g.add(orbit);
      const kind = planetKind(p);
      const seed = planetSeed(sys, i);
      const surface = new PlanetSurface(kind, p.color, seed);
      this.surfaces.push(surface);
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(p.radius, 48, 24),
        new THREE.MeshLambertMaterial({ map: surface.texture }),
      );
      // Lay the spin axis toward the top-down camera's up, tipped a little so a
      // pole shows: bands and terrain then roll across the visible disc.
      body.rotation.x = Math.PI / 2 - PLANET_TILT;
      for (const [layer, scale] of [
        ['rim', RIM_SCALE],
        ['halo', HALO_SCALE],
      ] as const) {
        body.add(
          new THREE.Mesh(new THREE.SphereGeometry(p.radius * scale, 48, 24), atmosphereMaterial(kind, p.color, layer)),
        );
      }
      g.add(body);
      let ring: THREE.Mesh | null = null;
      if (p.ringed) {
        const ringTex = planetRingTexture(seed, p.color);
        this.ringTextures.push(ringTex);
        ring = new THREE.Mesh(
          planetRingGeometry(p.radius * 1.35, p.radius * 2, 64),
          new THREE.MeshLambertMaterial({
            map: ringTex,
            transparent: true,
            opacity: 0.78,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.z = 0.25;
        g.add(ring);
      }
      const moons = p.moons.map((m) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(m.radius, 20, 10),
          new THREE.MeshLambertMaterial({ color: m.color }),
        );
        g.add(mesh);
        return mesh;
      });
      this.planets.push({ body, moons, ring });
    });

    this.buildStation(sys);
    this.syncPalette();
  }

  private buildStation(sys: StarSystem): void {
    const st = this.station;
    const ok = palette().ok;
    st.position.set(sys.station.pos.x, 0, sys.station.pos.z);
    const metal = new THREE.MeshLambertMaterial({ color: 0x9fb2c8, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a5a70, flatShading: true });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 14, 8), metal);
    st.add(hub);
    this.stationRing = new THREE.Mesh(new THREE.TorusGeometry(42, 5, 6, 24), dark);
    this.stationRing.rotation.x = Math.PI / 2;
    st.add(this.stationRing);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(70, 4, 6), metal);
      arm.rotation.set(Math.PI / 2, 0, (i * Math.PI) / 4);
      this.stationRing.add(arm);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), additive(ok));
      beacon.position.set(Math.cos((i * Math.PI) / 2) * 42, 6, Math.sin((i * Math.PI) / 2) * 42);
      st.add(beacon);
      this.beacons.push(beacon);
    }
    const dock = circleLoop(TUNING.dockRadius, ok, 0.3, 64);
    this.dockRing = dock;
    st.add(dock);
    this.group.add(st);
  }

  /** Re-colours palette-driven scenery materials in place when colour vision changes. */
  private syncPalette(): void {
    const p = palette();
    this.paletteGen = paletteGeneration();
    if (this.heatRing) (this.heatRing.material as THREE.LineBasicMaterial).color.setHex(p.bad);
    if (this.dockRing) (this.dockRing.material as THREE.LineBasicMaterial).color.setHex(p.ok);
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).color.setHex(p.ok);
    for (const b of this.beltBands) (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(p.resource[b.kind]);
  }

  /**
   * `boost` (0..1) brightens and swells the star glow during an active solar flare;
   * `warning` (0..1) pulses the star glow and heat-zone ring as a telegraph before the flare hits.
   */
  update(sys: StarSystem, time: number, boost = 0, warning = 0, reducedMotion = false): void {
    if (this.paletteGen !== paletteGeneration()) this.syncPalette();
    // Planets show their flat colour until their surface finishes painting.
    const until = performance.now() + PAINT_BUDGET_MS;
    for (const s of this.surfaces) {
      while (!s.done && performance.now() < until) s.paint(2);
    }
    sys.planets.forEach((p, i) => {
      const v = this.planets[i];
      if (!v) return;
      const { x: px, z: pz } = planetPos(p);
      v.body.position.set(px, 0, pz);
      v.body.rotation.y = time * 0.1;
      v.ring?.position.set(px, 0, pz);
      p.moons.forEach((m, j) => {
        v.moons[j]?.position.set(px + Math.cos(m.angle) * m.orbitR, 0, pz + Math.sin(m.angle) * m.orbitR);
      });
    });
    this.stationRing.rotation.z = time * 0.25;
    this.beacons.forEach((b, i) => {
      (b.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.max(0, Math.sin(time * 3 + i * 1.6));
    });
    const flicker = 1 + Math.sin(time * 1.7) * 0.03 + Math.sin(time * 5.3) * 0.015;
    const warnPulse = reducedMotion ? 0.65 : 0.5 + 0.5 * Math.sin(time * 7);
    const starBoost = Math.max(boost, warning * (0.25 + 0.35 * warnPulse));
    this.starGlow.forEach((s, i) => {
      s.scale.setScalar(sys.starRadius * (i === 0 ? 4.5 : 11) * flicker * (1 + 0.6 * starBoost));
      s.material.opacity = Math.min(1, this.glowOpacity[i]! + 0.3 * starBoost);
    });
    if (this.heatRing) {
      const alert = Math.max(boost, warning * (0.4 + 0.6 * warnPulse));
      (this.heatRing.material as THREE.LineBasicMaterial).opacity = Math.min(1, 0.35 + 0.55 * alert);
      this.heatRing.scale.setScalar(reducedMotion ? 1 : 1 + 0.015 * warning * warnPulse + 0.02 * boost);
    }
  }

  private dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.group.clear();
    this.surfaces.forEach((s) => s.texture.dispose());
    this.surfaces = [];
    this.ringTextures.forEach((t) => t.dispose());
    this.ringTextures = [];
    this.planets = [];
    this.beacons = [];
    this.dockRing = null;
    this.heatRing = null;
    this.beltBands = [];
    this.starGlow = [];
    this.glowOpacity = [];
    this.station = new THREE.Group();
  }
}
