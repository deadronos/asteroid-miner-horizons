// Turns the sim's fx outbox into particles, debris, floating pickup text and
// camera shake, and emits the per-frame particles (beam sparks, comet tails,
// thrusters). Owns the shake accumulator the camera reads.

import * as THREE from 'three';
import type { Vec2 } from '../core/vec';
import { HULLS } from '../data/hulls';
import { isAlive } from '../sim/ships';
import type { GameState } from '../sim/types';
import { Debris } from './debris';
import { FloatingText } from './floatingText';
import { Particles } from './particles';
import { ROCK_TINT } from './rocks';
import type { ShipView } from './shipView';
import { palette } from './activePalette';

/** A beam's hit point this frame, from `ShipView.update`. */
export type BeamHit = { x: number; z: number; ship: { id: number; thrusting: boolean } };

export class FxView {
  readonly particles = new Particles();
  readonly debris = new Debris();
  private floaters: FloatingText;
  /** Camera shake in CSS pixels before scaling; decays each frame. */
  shake = 0;

  constructor(
    container: HTMLElement,
    private ships: ShipView,
  ) {
    this.floaters = new FloatingText(container);
  }

  /** Particle and debris density, from the quality preset. */
  set density(d: number) {
    this.particles.density = d;
    this.debris.density = d;
  }

  /** Lets the shake settle; call once per frame before reading `shake`. */
  decayShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 25);
  }

  /**
   * Plays and clears `state.out.fx`, then emits this frame's continuous
   * particles. `onScreen` gates shake to events the player can see. Returns
   * true when a warp fx arrived.
   */
  consume(state: GameState, hits: BeamHit[], dt: number, onScreen: (p: Vec2) => boolean): boolean {
    const P = this.particles;
    const col = new THREE.Color();
    let warped = false;
    for (const fx of state.out.fx) {
      switch (fx.t) {
        case 'crack': {
          col.setHex(palette().resource[fx.kind]);
          P.emit(fx.pos.x, fx.pos.z, col, Math.round(fx.radius * 1.6), fx.radius * 3.5, 1.1);
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0x8a8070), Math.round(fx.radius), fx.radius * 1.5, 1.8, { drag: 0.8 });
          this.debris.burst(fx.pos.x, fx.pos.z, fx.radius, ROCK_TINT[fx.kind]);
          // Only cracks the player can see shake the camera; big rocks hit harder.
          if (onScreen(fx.pos)) this.shake = Math.min(14, this.shake + Math.min(7, 1 + fx.radius / 5));
          break;
        }
        case 'collect':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(palette().resource[fx.kind]), 4, 60, 0.35);
          this.floaters.add(fx.shipId, fx.kind, fx.amount, fx.pos);
          break;
        case 'dock':
          break;
        case 'impact':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffd0a0), 14, 120, 0.4);
          this.ships.flashNear(fx.pos);
          if (onScreen(fx.pos)) this.shake = Math.min(14, this.shake + 5);
          break;
        case 'explode':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffa040), 140, 220, 1.4);
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffffff), 40, 120, 0.6);
          this.shake = 16;
          break;
        case 'warp':
          warped = true;
          break;
        case 'hazard':
          if (fx.phase !== 'start') break;
          if (fx.kind === 'comet' && fx.pos) P.emit(fx.pos.x, fx.pos.z, col.setHex(0xa8dcff), 30, 160, 1);
          else if (fx.kind === 'flare') this.shake = Math.max(this.shake, 12);
          break;
      }
    }
    state.out.fx.length = 0;

    for (const h of hits) {
      if (Math.random() < dt * 55) {
        P.emit(h.x, h.z, col.setHex(0xfff2d8), 1.8, 125, 0.24, { drag: 3.2 });
        P.emit(h.x, h.z, col.setHex(0xff9f5d), 1.2, 90, 0.36, { drag: 2.6 });
      }
    }
    // Comets trail a pale tail opposite their velocity.
    for (const r of state.run.rocks) {
      if (!r.comet) continue;
      P.emit(r.pos.x, r.pos.z, col.setHex(0x9fd4ff), dt * 90, 60, 1.2, {
        dir: Math.atan2(-r.vel.z, -r.vel.x),
        spread: 0.35,
        drag: 1,
      });
    }
    for (const s of state.run.ships) {
      if (!s.thrusting || !isAlive(s)) continue;
      const back = s.angle + Math.PI;
      const size = HULLS[s.hullId].size;
      if (Math.random() < dt * 45) {
        P.emit(s.pos.x + Math.cos(back) * size, s.pos.z + Math.sin(back) * size, col.setHex(0xff7a30), 1, 70, 0.5, {
          dir: back,
          spread: 0.5,
          drag: 3,
        });
      }
    }
    return warped;
  }

  /** Advances particles and debris. */
  update(dt: number): void {
    this.particles.update(dt);
    this.debris.update(dt);
  }

  /** Moves floating pickup text; `anchor` gives a live ship's position (null once it is gone). */
  updateText(dt: number, toScreen: (p: Vec2) => { x: number; y: number }, anchor: (id: number) => Vec2 | null): void {
    this.floaters.update(dt, toScreen, anchor);
  }

  setVisible(on: boolean): void {
    this.particles.points.visible = this.debris.mesh.visible = on;
  }
}
