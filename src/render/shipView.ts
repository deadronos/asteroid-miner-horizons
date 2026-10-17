// Per-ship visuals: hull silhouette, engine flame, shield bubble, selection
// ring, status bars and the mining beam. Overlay elements (rings, bars, beam
// width) are scaled by world-units-per-pixel so they stay crisp at any zoom.

import * as THREE from 'three';
import type { Vec2 } from '../core/vec';
import { HULLS, type HullId } from '../data/hulls';
import { walletTotal } from '../data/resources';
import { isAlive, shipStats } from '../sim/ships';
import type { GameState, Ship } from '../sim/types';
import { additive, flat, glowTexture } from './util';

const HULL_SHAPES: Record<HullId, [number, number][]> = {
  prospector: [
    [16, 0],
    [2, 4],
    [-6, 11],
    [-11, 9],
    [-7, 0],
    [-11, -9],
    [-6, -11],
    [2, -4],
  ],
  excavator: [
    [20, 0],
    [10, 8],
    [-4, 16],
    [-16, 13],
    [-12, 0],
    [-16, -13],
    [-4, -16],
    [10, -8],
  ],
  drone: [
    [10, 0],
    [-2, 7],
    [-8, 0],
    [-2, -7],
  ],
  harvester: [
    [13, 0],
    [6, 9],
    [-8, 9],
    [-12, 0],
    [-8, -9],
    [6, -9],
  ],
};

function hullGeometry(id: HullId): THREE.BufferGeometry {
  const shape = new THREE.Shape(HULL_SHAPES[id].map(([x, y]) => new THREE.Vector2(x, y)));
  // Extrude a little so the star light gives the hull some shading.
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 4,
    bevelEnabled: true,
    bevelThickness: 1.5,
    bevelSize: 1.2,
    bevelSegments: 1,
  });
  geo.rotateX(Math.PI / 2); // shape XY → ground XZ, extruded downward (hulls are symmetric in Y)
  return geo;
}

interface Visual {
  hullId: HullId;
  root: THREE.Group;
  body: THREE.Group;
  flame: THREE.Mesh;
  shield: THREE.Mesh;
  select: THREE.Mesh;
  hpBar: THREE.Mesh;
  cargoBar: THREE.Mesh;
  barBg: THREE.Mesh;
  beam: THREE.Mesh;
  beamGlow: THREE.Mesh;
  tip: THREE.Sprite;
  shieldPrev: number;
  hitFlash: number;
}

const unitPlane = flat(new THREE.PlaneGeometry(1, 1));
const barPlane = flat(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0));

export class ShipView {
  readonly group = new THREE.Group();
  private visuals = new Map<number, Visual>();
  private geos = new Map<HullId, THREE.BufferGeometry>();

  private geo(id: HullId): THREE.BufferGeometry {
    let g = this.geos.get(id);
    if (!g) this.geos.set(id, (g = hullGeometry(id)));
    return g;
  }

  private build(ship: Ship): Visual {
    const h = HULLS[ship.hullId];
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(
      new THREE.Mesh(
        this.geo(ship.hullId),
        new THREE.MeshLambertMaterial({
          color: h.color,
          emissive: h.color,
          emissiveIntensity: 0.25,
          flatShading: true,
        }),
      ),
    );
    const flameShape = new THREE.Shape([new THREE.Vector2(0, 4), new THREE.Vector2(-14, 0), new THREE.Vector2(0, -4)]);
    const flame = new THREE.Mesh(flat(new THREE.ShapeGeometry(flameShape)), additive(0xff8a3a, 0.9));
    flame.position.set(-h.size * 0.6, 1, 0);
    body.add(flame);
    root.add(body);

    const shield = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 40)), additive(0x4db8ff, 0.2, null));
    shield.scale.setScalar(h.size * 1.9);
    root.add(shield);
    const select = new THREE.Mesh(flat(new THREE.RingGeometry(0.92, 1, 48)), additive(0x59ffa0, 0.9));
    root.add(select);

    const barBg = new THREE.Mesh(
      barPlane,
      new THREE.MeshBasicMaterial({ color: 0x0b1424, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    const hpBar = new THREE.Mesh(barPlane, new THREE.MeshBasicMaterial({ color: 0x59ffa0, depthWrite: false }));
    const cargoBar = new THREE.Mesh(barPlane, new THREE.MeshBasicMaterial({ color: 0xffa040, depthWrite: false }));
    for (const b of [barBg, hpBar, cargoBar]) {
      b.renderOrder = 20;
      root.add(b);
    }

    const beam = new THREE.Mesh(unitPlane, additive(0xff6a4a, 0.95));
    const beamGlow = new THREE.Mesh(unitPlane, additive(0xff3a2a, 0.35));
    const tip = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffb070,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    for (const o of [beam, beamGlow, tip]) {
      o.visible = false;
      o.renderOrder = 15;
      this.group.add(o);
    }
    this.group.add(root);
    return {
      hullId: ship.hullId,
      root,
      body,
      flame,
      shield,
      select,
      hpBar,
      cargoBar,
      barBg,
      beam,
      beamGlow,
      tip,
      shieldPrev: ship.shield,
      hitFlash: 0,
    };
  }

  private remove(id: number, v: Visual): void {
    this.group.remove(v.root, v.beam, v.beamGlow, v.tip);
    this.visuals.delete(id);
  }

  /** Flashes the shield bubble of the ship closest to an impact point. */
  flashNear(pos: Vec2): void {
    let best: Visual | null = null;
    let bestD = 60;
    for (const v of this.visuals.values()) {
      const d = Math.hypot(v.root.position.x - pos.x, v.root.position.z - pos.z);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    if (best) best.hitFlash = 1;
  }

  /** Returns hit points for beams this frame so the caller can spawn sparks. */
  update(
    state: GameState,
    time: number,
    dt: number,
    wpp: number,
    alwaysBars: boolean,
  ): { x: number; z: number; ship: Ship }[] {
    const { run, profile } = state;
    const seen = new Set<number>();
    const hits: { x: number; z: number; ship: Ship }[] = [];
    const rockById = new Map(run.rocks.map((r) => [r.id, r]));

    for (const ship of run.ships) {
      seen.add(ship.id);
      let v = this.visuals.get(ship.id);
      if (v && v.hullId !== ship.hullId) {
        this.remove(ship.id, v);
        v = undefined;
      }
      if (!v) {
        v = this.build(ship);
        this.visuals.set(ship.id, v);
      }
      const alive = isAlive(ship);
      v.root.visible = alive;
      if (!alive) {
        v.beam.visible = v.beamGlow.visible = v.tip.visible = false;
        continue;
      }
      const st = shipStats(ship, profile);
      const h = HULLS[ship.hullId];
      v.root.position.set(ship.pos.x, 20, ship.pos.z);
      v.body.rotation.y = -ship.angle;

      const flick = 0.75 + Math.random() * 0.5;
      v.flame.visible = ship.thrusting;
      v.flame.scale.set(flick, 1, 0.8 + Math.random() * 0.3);

      if (ship.shield < v.shieldPrev - 0.5) v.hitFlash = 1;
      v.shieldPrev = ship.shield;
      v.hitFlash = Math.max(0, v.hitFlash - dt * 3);
      const sf = st.maxShield > 0 ? ship.shield / st.maxShield : 0;
      // Hulls without a shield still flash a bubble on impact.
      v.shield.visible = sf > 0.02 || v.hitFlash > 0;
      (v.shield.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.1 * sf + 0.4 * v.hitFlash;

      const selected = ship.id === run.selectedId;
      v.select.visible = selected;
      const ringR = Math.max(h.size * 1.9 + 4 * wpp, 14 * wpp);
      v.select.scale.setScalar(ringR * (1 + Math.sin(time * 4) * 0.03));
      (v.select.material as THREE.MeshBasicMaterial).color.setHex(h.role === 'flagship' ? 0x59ffa0 : 0x59c2ff);

      // Status bars: hull on top, cargo below; ~34 px wide regardless of zoom.
      const bw = 34 * wpp;
      const bh = 3 * wpp;
      const by = ringR + 8 * wpp;
      const hullF = Math.max(0, ship.hull / st.maxHull);
      const cargoF = Math.min(1, walletTotal(ship.cargo) / st.cargoCap);
      v.barBg.position.set(-bw / 2 - wpp, 1, -by + (bh + wpp) / 2);
      v.barBg.scale.set(bw + 2 * wpp, 1, bh * 2 + 3 * wpp);
      v.hpBar.position.set(-bw / 2, 2, -by);
      v.hpBar.scale.set(bw * hullF, 1, bh);
      (v.hpBar.material as THREE.MeshBasicMaterial).color.setHex(
        hullF > 0.5 ? 0x59ffa0 : hullF > 0.25 ? 0xffc04d : 0xff5d5d,
      );
      v.cargoBar.position.set(-bw / 2, 2, -by + bh + wpp);
      v.cargoBar.scale.set(Math.max(0.0001, bw * cargoF), 1, bh);
      const showBars = alwaysBars || selected || hullF < 0.999 || cargoF > 0.01;
      v.barBg.visible = v.hpBar.visible = v.cargoBar.visible = showBars;

      // Mining beam: a pulsing core quad + wide glow quad from ship to rock.
      const rock = ship.beamOn && ship.beamTargetId != null ? rockById.get(ship.beamTargetId) : undefined;
      if (rock) {
        const dx = rock.pos.x - ship.pos.x;
        const dz = rock.pos.z - ship.pos.z;
        const d = Math.hypot(dx, dz);
        const tx = rock.pos.x - (dx / d) * rock.radius * 0.6;
        const tz = rock.pos.z - (dz / d) * rock.radius * 0.6;
        const L = Math.hypot(tx - ship.pos.x, tz - ship.pos.z);
        const mx = (ship.pos.x + tx) / 2;
        const mz = (ship.pos.z + tz) / 2;
        const ang = -Math.atan2(dz, dx);
        const pulse = 1 + Math.sin(time * 40 + ship.id) * 0.25;
        v.beam.position.set(mx, 18, mz);
        v.beam.rotation.y = ang;
        v.beam.scale.set(L, 1, Math.max(1.5, 2.2 * wpp) * pulse);
        v.beamGlow.position.set(mx, 17, mz);
        v.beamGlow.rotation.y = ang;
        v.beamGlow.scale.set(L, 1, Math.max(5, 8 * wpp) * pulse);
        v.tip.position.set(tx, 22, tz);
        v.tip.scale.setScalar(Math.max(18, 26 * wpp) * (0.8 + Math.random() * 0.4));
        v.beam.visible = v.beamGlow.visible = v.tip.visible = true;
        hits.push({ x: tx, z: tz, ship });
      } else {
        v.beam.visible = v.beamGlow.visible = v.tip.visible = false;
      }
    }
    for (const [id, v] of this.visuals) if (!seen.has(id)) this.remove(id, v);
    return hits;
  }
}
