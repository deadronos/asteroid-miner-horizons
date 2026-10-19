// Outpost markers: a slowly turning dashed ring around each host rock, tinted
// by resource kind, plus an arc that fills as its storage does. A fixed pool
// of `outpostMax` markers is built up front and re-posed each frame.

import * as THREE from 'three';
import { RESOURCE_INFO, walletTotal } from '../data/resources';
import { TUNING } from '../data/tuning';
import type { Outpost, Rock } from '../sim/types';
import { additive, flat } from './util';

const FILL_SEGMENTS = 48;

interface Marker {
  root: THREE.Group;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  /** Storage fraction the fill geometry was last built for, so it is only rebuilt on change. */
  shown: number;
}

export class OutpostView {
  readonly group = new THREE.Group();
  private readonly markers: Marker[] = [];

  constructor() {
    const ringGeo = flat(new THREE.RingGeometry(1.12, 1.2, 6));
    for (let i = 0; i < TUNING.outpostMax; i++) {
      const ring = new THREE.Mesh(ringGeo, additive(0xffffff, 0.55));
      const fill = new THREE.Mesh(new THREE.BufferGeometry(), additive(0xffffff, 0.85));
      const root = new THREE.Group();
      root.add(ring, fill);
      root.visible = false;
      this.group.add(root);
      this.markers.push({ root, ring, fill, shown: -1 });
    }
  }

  /** Poses one marker per outpost on its rock; `rockById` holds the run's live rocks. */
  update(outposts: Outpost[], rockById: (id: number) => Rock | undefined, time: number): void {
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i]!;
      const o = outposts[i];
      const rock = o ? rockById(o.rockId) : undefined;
      m.root.visible = !!rock;
      if (!o || !rock) continue;
      const color = RESOURCE_INFO[o.kind].color;
      (m.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      (m.fill.material as THREE.MeshBasicMaterial).color.setHex(color);
      m.root.position.set(rock.pos.x, 20, rock.pos.z);
      m.root.scale.setScalar(rock.radius);
      m.ring.rotation.y = time * 0.3;
      const f = Math.round((walletTotal(o.stored) / TUNING.outpostCapacity) * FILL_SEGMENTS) / FILL_SEGMENTS;
      if (f !== m.shown) {
        m.fill.geometry.dispose();
        m.fill.geometry = flat(
          new THREE.RingGeometry(1.25, 1.38, FILL_SEGMENTS, 1, Math.PI / 2 - f * Math.PI * 2, f * Math.PI * 2),
        );
        m.shown = f;
      }
    }
  }
}
