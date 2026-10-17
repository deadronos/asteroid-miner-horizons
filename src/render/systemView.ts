// Static-ish scenery for one star system: star, heat zone, planets, moons,
// orbit lines, belt haze and the mining station. Rebuilt on warp.

import * as THREE from 'three';
import { TUNING } from '../data/tuning';
import type { StarSystem } from '../sim/types';
import { additive, circleLoop, flat, glowTexture } from './util';

export class SystemView {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private planets: { body: THREE.Mesh; moons: THREE.Mesh[]; ring: THREE.Mesh | null }[] = [];
  private station = new THREE.Group();
  private stationRing!: THREE.Mesh;
  private beacons: THREE.Mesh[] = [];
  private starGlow: THREE.Sprite[] = [];
  key = '';

  constructor() {
    this.light = new THREE.PointLight(0xffffff, 3.2, 0, 0);
    this.light.position.set(0, 220, 0);
  }

  build(sys: StarSystem): void {
    this.dispose();
    this.key = `${sys.name}#${sys.number}`;
    const g = this.group;
    this.light.color.setHex(sys.starColor).lerp(new THREE.Color(0xffffff), 0.55);
    g.add(this.light);

    // Star: hot core plus two additive glow sprites.
    const star = new THREE.Mesh(new THREE.SphereGeometry(sys.starRadius, 48, 24), new THREE.MeshBasicMaterial({ color: sys.starColor }));
    g.add(star);
    for (const [scale, op] of [
      [4.5, 0.85],
      [11, 0.25],
    ] as const) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture, color: sys.starColor, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      s.scale.setScalar(sys.starRadius * scale);
      s.position.y = 30;
      g.add(s);
      this.starGlow.push(s);
    }
    const heat = circleLoop(sys.heatRadius, 0xff5a3a, 0.35, 120);
    g.add(heat);

    // Belt haze: a faint band so the belts read even when zoomed out.
    for (const b of sys.belts) {
      const tint = b.mix.crystal > 0.2 ? 0x9a5cff : b.mix.ice > b.mix.ore ? 0x5ab8ff : 0xc08a4a;
      const band = new THREE.Mesh(flat(new THREE.RingGeometry(b.inner, b.outer, 160, 1)), additive(tint, 0.035));
      band.position.y = -20;
      g.add(band);
    }

    for (const p of sys.planets) {
      const orbit = circleLoop(p.orbitR, 0x35507a, 0.35);
      orbit.position.y = -10;
      g.add(orbit);
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(p.radius, 40, 20),
        new THREE.MeshLambertMaterial({ color: p.color }),
      );
      g.add(body);
      let ring: THREE.Mesh | null = null;
      if (p.ringed) {
        ring = new THREE.Mesh(
          flat(new THREE.RingGeometry(p.radius * 1.35, p.radius * 2, 64)),
          new THREE.MeshLambertMaterial({ color: 0xd8c8a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
        );
        ring.rotation.z = 0.25;
        g.add(ring);
      }
      const moons = p.moons.map((m) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(m.radius, 20, 10), new THREE.MeshLambertMaterial({ color: m.color }));
        g.add(mesh);
        return mesh;
      });
      this.planets.push({ body, moons, ring });
    }

    this.buildStation(sys);
  }

  private buildStation(sys: StarSystem): void {
    const st = this.station;
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
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), additive(0x59ffa0));
      beacon.position.set(Math.cos((i * Math.PI) / 2) * 42, 6, Math.sin((i * Math.PI) / 2) * 42);
      st.add(beacon);
      this.beacons.push(beacon);
    }
    const dock = circleLoop(TUNING.dockRadius, 0x59ffa0, 0.3, 64);
    st.add(dock);
    this.group.add(st);
  }

  update(sys: StarSystem, time: number): void {
    sys.planets.forEach((p, i) => {
      const v = this.planets[i];
      if (!v) return;
      const px = Math.cos(p.angle) * p.orbitR;
      const pz = Math.sin(p.angle) * p.orbitR;
      v.body.position.set(px, 0, pz);
      v.body.rotation.y = time * 0.1;
      v.ring?.position.set(px, 0, pz);
      p.moons.forEach((m, j) => {
        v.moons[j]!.position.set(px + Math.cos(m.angle) * m.orbitR, 0, pz + Math.sin(m.angle) * m.orbitR);
      });
    });
    this.stationRing.rotation.z = time * 0.25;
    this.beacons.forEach((b, i) => {
      (b.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.max(0, Math.sin(time * 3 + i * 1.6));
    });
    const flicker = 1 + Math.sin(time * 1.7) * 0.03 + Math.sin(time * 5.3) * 0.015;
    this.starGlow.forEach((s, i) => s.scale.setScalar(sys.starRadius * (i === 0 ? 4.5 : 11) * flicker));
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
    this.planets = [];
    this.beacons = [];
    this.starGlow = [];
    this.station = new THREE.Group();
  }
}
