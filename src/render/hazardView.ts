// Comet warning overlay: a dashed, pulsing line along the incoming comet's
// predicted path. One line is built up front and re-posed each frame, and dash
// lengths follow world-units-per-pixel so it stays crisp at every zoom.

import * as THREE from 'three';
import { len } from '../core/vec';
import { TUNING } from '../data/tuning';
import type { Hazards } from '../sim/types';
import { palette } from './activePalette';

const DASH_PX = 14;
const GAP_PX = 9;

export class HazardView {
  readonly line: THREE.Line;
  private readonly mat: THREE.LineDashedMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(TUNING.cometEdge * 2, 0, 0),
    ]);
    this.mat = new THREE.LineDashedMaterial({
      color: 0x8fd0ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      dashSize: 1,
      gapSize: 1,
    });
    this.line = new THREE.Line(geo, this.mat);
    this.line.computeLineDistances();
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.position.y = 16;
  }

  /** Poses the line for the current comet warning, or hides it. `wpp` is world units per CSS pixel. */
  update(hz: Hazards, time: number, wpp: number): void {
    const c = hz.comet;
    this.line.visible = !!c;
    if (!c) return;
    const speed = len(c.vel) || 1;
    this.line.position.x = c.from.x;
    this.line.position.z = c.from.z;
    this.line.rotation.y = -Math.atan2(c.vel.z / speed, c.vel.x / speed);
    // Geometry is at real length, so dash sizes are world units.
    this.mat.color.setHex(palette().hazard);
    this.mat.dashSize = DASH_PX * wpp;
    this.mat.gapSize = GAP_PX * wpp;
    // Brighter and pulsing faster as the comet nears.
    const urgency = 1 - Math.min(1, c.timeLeft / TUNING.cometWarning);
    this.mat.opacity = 0.45 + 0.35 * urgency + 0.15 * Math.sin(time * (4 + 8 * urgency));
  }
}
