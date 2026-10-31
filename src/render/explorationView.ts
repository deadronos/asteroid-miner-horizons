// Revealed-anomaly visuals: a wireframe wreck for unclaimed derelicts and an outline ring on rich deposit rocks,
// plus the text labels that pair them with the scanner glyph. Hidden anomalies draw nothing; claimed wrecks vanish.

import * as THREE from 'three';
import { ANOMALY_INFO, type AnomalyKind } from '../data/exploration';
import { anomalies, isClaimed } from '../sim/exploration';
import type { Run } from '../sim/types';
import { palette } from './activePalette';

/** A thin ground-plane ring around a rich rock (authored in XY, laid onto XZ). */
const richRingGeometry = (): THREE.BufferGeometry => new THREE.RingGeometry(0.94, 1, 32).rotateX(-Math.PI / 2);

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

/** One wireframe wreck plus one ring outline per anomaly/rich rock; meshes are pooled and only moved. */
export class ExplorationView {
  readonly group = new THREE.Group();
  private readonly derelicts: THREE.Mesh[] = [];
  private readonly richRings: THREE.Mesh[] = [];
  private readonly derelictGeo = new THREE.OctahedronGeometry(1, 0);
  private readonly derelictMat = new THREE.MeshBasicMaterial({
    color: 0x9fe8ff,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  private readonly richGeo = richRingGeometry();
  private readonly richMat = new THREE.MeshBasicMaterial({
    color: 0xffc04d,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** Shows revealed, unclaimed derelicts and rich rock outlines for `run`; no per-frame allocation. */
  update(run: Run): void {
    for (const m of this.derelicts) m.visible = false;
    for (const m of this.richRings) m.visible = false;
    this.derelictMat.color.setHex(palette().fleet);
    this.richMat.color.setHex(palette().warn);

    const list = anomalies(run);
    let d = 0;
    for (const id of run.exploration.revealed) {
      if (isClaimed(run, id)) continue;
      const a = list[id];
      if (!a || a.id !== id || a.kind !== 'derelict') continue;
      const mesh = this.derelict(d++);
      mesh.position.set(a.pos.x, 16, a.pos.z);
      mesh.scale.setScalar(12);
      mesh.visible = true;
    }

    let r = 0;
    for (const rock of run.rocks) {
      if (!rock.rich) continue;
      const mesh = this.rich(r++);
      mesh.position.set(rock.pos.x, 8, rock.pos.z);
      mesh.scale.setScalar(rock.radius * 1.3);
      mesh.visible = true;
    }
  }

  private derelict(i: number): THREE.Mesh {
    let mesh = this.derelicts[i];
    if (!mesh) {
      mesh = new THREE.Mesh(this.derelictGeo, this.derelictMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.derelicts[i] = mesh;
      this.group.add(mesh);
    }
    return mesh;
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
