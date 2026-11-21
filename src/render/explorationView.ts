// Revealed-anomaly visuals: a tilted damaged hull with a slow distress beacon for unclaimed derelicts and an
// outline ring on rich deposit rocks, plus the text labels that pair them with the scanner glyph. Hidden anomalies
// draw nothing; claimed wrecks vanish.

import * as THREE from 'three';
import { ANOMALY_INFO, type AnomalyKind } from '../data/exploration';
import { anomalies, isClaimed } from '../sim/exploration';
import type { Run } from '../sim/types';
import { palette } from './activePalette';

/** A thin ground-plane ring around a rich rock (authored in XY, laid onto XZ). */
const richRingGeometry = (): THREE.BufferGeometry => new THREE.RingGeometry(0.92, 1, 32).rotateX(-Math.PI / 2);

/** A broken, asymmetric hull silhouette extruded to unit radius so it scales cleanly with `wpp`. */
function derelictHullGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape([
    new THREE.Vector2(1.0, 0.08),
    new THREE.Vector2(0.35, 0.32),
    new THREE.Vector2(0.05, 0.85),
    new THREE.Vector2(-0.55, 0.72),
    new THREE.Vector2(-0.85, 0.25),
    new THREE.Vector2(-0.45, 0.02),
    new THREE.Vector2(-0.9, -0.32),
    new THREE.Vector2(-0.3, -0.78),
    new THREE.Vector2(0.25, -0.42),
    new THREE.Vector2(0.65, -0.22),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 1,
  });
  geo.rotateX(Math.PI / 2);
  geo.center();
  return geo;
}

interface DerelictVisual {
  root: THREE.Group;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
}

/** A world-space label for an anomaly or rich rock. Objects are reused between calls. */
export interface WorldLabel {
  kind: AnomalyKind;
  text: string;
  x: number;
  z: number;
}

/**
 * Fills `out` with the labels for this frame and returns the count: one per rich rock, then one per revealed,
 * unclaimed derelict. Hidden and claimed anomalies are never included. Reuses entries past the count.
 */
export function collectWorldLabels(run: Run, out: WorldLabel[]): number {
  let n = 0;
  const push = (kind: AnomalyKind, text: string, x: number, z: number): void => {
    const l = (out[n] ??= { kind, text, x, z });
    l.kind = kind;
    l.text = text;
    l.x = x;
    l.z = z;
    n++;
  };
  for (const r of run.rocks) {
    if (!r.rich) continue;
    push('rich', `${ANOMALY_INFO.rich.glyph} ${ANOMALY_INFO.rich.label}`, r.pos.x, r.pos.z);
  }
  const list = anomalies(run);
  for (const id of run.exploration.revealed) {
    if (isClaimed(run, id)) continue;
    const a = list[id];
    if (!a || a.id !== id || a.kind !== 'derelict') continue;
    push('derelict', `${ANOMALY_INFO.derelict.glyph} ${ANOMALY_INFO.derelict.label}`, a.pos.x, a.pos.z);
  }
  return n;
}

/** One damaged hull + distress beacon per derelict, plus one ring outline per rich rock; pooled and only moved. */
export class ExplorationView {
  readonly group = new THREE.Group();
  private readonly derelicts: DerelictVisual[] = [];
  private readonly richRings: THREE.Mesh[] = [];
  private readonly derelictGeo = derelictHullGeometry();
  private readonly derelictMat = new THREE.MeshLambertMaterial({
    color: 0x62778f,
    emissive: 0x9fe8ff,
    emissiveIntensity: 0.28,
    flatShading: true,
  });
  private readonly beaconGeo = new THREE.SphereGeometry(0.18, 10, 8);
  private readonly richGeo = richRingGeometry();
  private readonly richMat = new THREE.MeshBasicMaterial({
    color: 0xffc04d,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** Shows revealed, unclaimed derelicts and rich rock outlines for `run`; no per-frame allocation. */
  update(run: Run, wpp = 1, time = 0, reducedMotion = false): void {
    for (const m of this.derelicts) m.root.visible = false;
    for (const m of this.richRings) m.visible = false;
    const fleet = palette().fleet;
    this.derelictMat.emissive.setHex(fleet);
    this.richMat.color.setHex(palette().warn);

    const list = anomalies(run);
    const derelictScale = Math.max(12, 12 * wpp);
    let d = 0;
    for (const id of run.exploration.revealed) {
      if (isClaimed(run, id)) continue;
      const a = list[id];
      if (!a || a.id !== id || a.kind !== 'derelict') continue;
      const v = this.derelict(d++);
      v.root.position.set(a.pos.x, 16, a.pos.z);
      v.root.scale.setScalar(derelictScale);
      v.root.rotation.y = a.id * 1.7 + (reducedMotion ? 0 : time * 0.12);
      v.beaconMat.color.setHex(fleet);
      if (reducedMotion) {
        v.beaconMat.opacity = 0.75;
        v.beacon.scale.setScalar(1);
      } else {
        const blink = 0.5 + 0.5 * Math.sin(time * 2.6 + a.id * 1.3);
        v.beaconMat.opacity = 0.2 + 0.8 * blink * blink;
        v.beacon.scale.setScalar(0.85 + 0.45 * blink);
      }
      v.root.visible = true;
    }

    let r = 0;
    for (const rock of run.rocks) {
      if (!rock.rich) continue;
      const mesh = this.rich(r++);
      mesh.position.set(rock.pos.x, 8, rock.pos.z);
      mesh.scale.setScalar(Math.max(rock.radius * 1.3 + 2 * wpp, 22 * wpp));
      mesh.visible = true;
    }
  }

  private derelict(i: number): DerelictVisual {
    let v = this.derelicts[i];
    if (!v) {
      const root = new THREE.Group();
      const hull = new THREE.Mesh(this.derelictGeo, this.derelictMat);
      hull.rotation.set(0.32, 0.6, -0.24);
      hull.frustumCulled = false;
      hull.renderOrder = 8;
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beacon = new THREE.Mesh(this.beaconGeo, beaconMat);
      beacon.position.set(0.15, 0.38, 0.1);
      beacon.frustumCulled = false;
      beacon.renderOrder = 9;
      root.add(hull, beacon);
      v = { root, beacon, beaconMat };
      this.derelicts[i] = v;
      this.group.add(root);
    }
    return v;
  }

  private rich(i: number): THREE.Mesh {
    let mesh = this.richRings[i];
    if (!mesh) {
      mesh = new THREE.Mesh(this.richGeo, this.richMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.richRings[i] = mesh;
      this.group.add(mesh);
    }
    return mesh;
  }
}
