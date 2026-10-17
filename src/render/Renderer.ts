// Top-down Three.js renderer. The sim's { x, z } plane is the ground plane;
// an orthographic camera looks straight down (screen right = +x, up = −z).
// Owns the view state (zoom, pan, follow) and turns sim fx into particles.

import * as THREE from 'three';
import { clamp, damp, type Vec2 } from '../core/vec';
import { HULLS } from '../data/hulls';
import { RESOURCE_INFO } from '../data/resources';
import { QUALITY, SHAKE_SCALE, type Settings } from '../settings';
import { isAlive } from '../sim/ships';
import type { GameState, Rock, StarSystem } from '../sim/types';
import { Backdrop } from './backdrop';
import { FloatingText } from './floatingText';
import { Particles } from './particles';
import { RockView } from './rocks';
import { ShipView } from './shipView';
import { SystemView } from './systemView';
import { additive, flat } from './util';

export const ZOOM_MIN = 90;
export const ZOOM_MAX = 3200;

export type HoverTarget = { kind: 'rock'; rock: Rock } | { kind: 'station' } | { kind: 'ship'; id: number } | null;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private backdrop = new Backdrop();
  private system = new SystemView();
  private rocks = new RockView();
  private ships = new ShipView();
  private particles = new Particles();
  private floaters: FloatingText;
  private hoverRing: THREE.Mesh;
  private moveMarker: THREE.Mesh;
  private shake = 0;
  private warpFlash = 0;

  /** View state. `follow` keeps the camera on the selected ship. */
  center: Vec2 = { x: 0, z: 0 };
  halfH = 420;
  targetHalfH = 420;
  follow = true;
  hover: HoverTarget = null;
  private snapped = false;
  private shakeScale = 1;
  private alwaysBars = false;

  /** `antialias` is fixed for the WebGL context's lifetime; it applies on reload. */
  constructor(
    private container: HTMLElement,
    settings: Settings,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: settings.antialias, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x03060d);
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);
    this.floaters = new FloatingText(container);

    this.camera.up.set(0, 0, -1);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
    this.scene.add(this.backdrop.group, this.system.group, this.rocks.group, this.ships.group, this.particles.points);

    this.hoverRing = new THREE.Mesh(flat(new THREE.RingGeometry(0.9, 1, 48)), additive(0xffffff, 0.6));
    this.hoverRing.visible = false;
    this.moveMarker = new THREE.Mesh(flat(new THREE.RingGeometry(0.7, 1, 32)), additive(0x59ffa0, 0.8));
    this.moveMarker.visible = false;
    this.scene.add(this.hoverRing, this.moveMarker);

    new ResizeObserver(() => this.resize()).observe(container);
    this.follow = settings.followByDefault;
    this.applySettings(settings);
  }

  applySettings(s: Settings): void {
    const q = QUALITY[s.quality];
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.resize();
    this.backdrop.configure(q.stars, s.nebula);
    this.particles.density = q.particles;
    this.shakeScale = SHAKE_SCALE[s.shake];
    this.alwaysBars = s.alwaysShowBars;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  private get aspect(): number {
    return this.container.clientWidth / Math.max(1, this.container.clientHeight);
  }

  /** World units per CSS pixel at the current zoom. */
  get wpp(): number {
    return (this.halfH * 2) / Math.max(1, this.container.clientHeight);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = ((clientY - r.top) / r.height) * 2 - 1;
    return { x: this.center.x + nx * this.halfH * this.aspect, z: this.center.z + ny * this.halfH };
  }

  /** World point → CSS pixels relative to the scene container. */
  worldToScreen(p: Vec2): { x: number; y: number } {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return {
      x: ((p.x - this.center.x) / (this.halfH * this.aspect) + 1) * 0.5 * w,
      y: ((p.z - this.center.z) / this.halfH + 1) * 0.5 * h,
    };
  }

  /** Zooms by `factor`, keeping the world point under the cursor fixed (unless following). */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const next = clamp(this.targetHalfH * factor, ZOOM_MIN, ZOOM_MAX);
    if (!this.follow) {
      const p = this.screenToWorld(clientX, clientY);
      const k = next / this.halfH;
      this.center = { x: p.x + (this.center.x - p.x) * k, z: p.z + (this.center.z - p.z) * k };
      this.halfH = next;
    }
    this.targetHalfH = next;
  }

  panPixels(dx: number, dy: number): void {
    this.follow = false;
    this.center.x -= dx * this.wpp;
    this.center.z -= dy * this.wpp;
  }

  /** Toggle between a whole-system overview and the previous zoom. */
  private mapReturn = 420;
  toggleMap(sys: StarSystem): void {
    const fit = clamp(
      Math.max(...sys.planets.map((p) => p.orbitR), ...sys.belts.map((b) => b.outer)) * 1.08,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    if (Math.abs(this.targetHalfH - fit) > 1) {
      this.mapReturn = this.targetHalfH;
      this.follow = false;
      this.center = { x: 0, z: 0 };
      this.targetHalfH = fit;
    } else {
      this.targetHalfH = this.mapReturn;
      this.follow = true;
    }
  }

  render(state: GameState, dt: number, moveMark: Vec2 | null): void {
    const { run } = state;
    const sys = run.system;
    const key = `${sys.name}#${sys.number}`;
    if (this.system.key !== key) {
      this.system.build(sys);
      this.backdrop.setSystem(state.profile.seed + sys.number);
      this.snapped = false;
    }

    // Camera: smooth zoom, follow the selected ship.
    this.halfH += (this.targetHalfH - this.halfH) * (1 - damp(12, dt));
    const sel = run.ships.find((s) => s.id === run.selectedId);
    if (this.follow && sel) {
      const focus = isAlive(sel) ? sel.pos : sys.station.pos;
      const k = this.snapped ? 1 - damp(6, dt) : 1;
      this.center.x += (focus.x - this.center.x) * k;
      this.center.z += (focus.z - this.center.z) * k;
      this.snapped = true;
    }
    this.shake = Math.max(0, this.shake - dt * 25);
    const amp = this.shake * this.shakeScale * this.wpp;
    const sx = (Math.random() - 0.5) * amp;
    const sz = (Math.random() - 0.5) * amp;
    const cx = this.center.x + sx;
    const cz = this.center.z + sz;
    const a = this.aspect;
    this.camera.left = -this.halfH * a;
    this.camera.right = this.halfH * a;
    this.camera.top = this.halfH;
    this.camera.bottom = -this.halfH;
    this.camera.position.set(cx, 1000, cz);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();

    this.backdrop.update(cx, cz, this.halfH);
    this.system.update(sys, run.time);
    this.rocks.update(run.rocks, run.pickups, run.time);
    const wpp = this.wpp;
    const hits = this.ships.update(state, run.time, dt, wpp, this.alwaysBars);

    this.consumeFx(state, hits, dt);
    this.particles.update(dt);
    this.updateMarkers(state, moveMark, wpp);
    this.floaters.update(
      dt,
      (p) => this.worldToScreen(p),
      (id) => {
        const s = run.ships.find((x) => x.id === id);
        return s && isAlive(s) ? s.pos : null;
      },
    );

    this.warpFlash = Math.max(0, this.warpFlash - dt * 1.2);
    this.gl.render(this.scene, this.camera);
  }

  /** 0..1 white-out intensity after a warp, for the HUD overlay. */
  get flash(): number {
    return this.warpFlash;
  }

  private consumeFx(
    state: GameState,
    hits: { x: number; z: number; ship: { id: number; thrusting: boolean } }[],
    dt: number,
  ): void {
    const P = this.particles;
    const col = new THREE.Color();
    for (const fx of state.out.fx) {
      switch (fx.t) {
        case 'crack': {
          col.setHex(RESOURCE_INFO[fx.kind].color);
          P.emit(fx.pos.x, fx.pos.z, col, Math.round(fx.radius * 1.6), fx.radius * 3.5, 1.1);
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0x8a8070), Math.round(fx.radius), fx.radius * 1.5, 1.8, { drag: 0.8 });
          if (fx.radius > 25) this.shake = Math.min(14, this.shake + 6);
          break;
        }
        case 'collect':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(RESOURCE_INFO[fx.kind].color), 4, 60, 0.35);
          this.floaters.add(fx.shipId, fx.kind, fx.amount, fx.pos);
          break;
        case 'dock':
          break;
        case 'impact':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffd0a0), 14, 120, 0.4);
          this.shake = Math.min(14, this.shake + 5);
          break;
        case 'explode':
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffa040), 140, 220, 1.4);
          P.emit(fx.pos.x, fx.pos.z, col.setHex(0xffffff), 40, 120, 0.6);
          this.shake = 16;
          break;
        case 'warp':
          this.warpFlash = 1;
          this.follow = true;
          break;
      }
    }
    state.out.fx.length = 0;

    for (const h of hits) {
      if (Math.random() < dt * 40) P.emit(h.x, h.z, col.setHex(0xffc080), 1, 90, 0.35);
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
  }

  private updateMarkers(state: GameState, moveMark: Vec2 | null, wpp: number): void {
    const t = state.run.time;
    const h = this.hover;
    let target: { pos: Vec2; r: number; color: number } | null = null;
    if (h?.kind === 'rock')
      target = { pos: h.rock.pos, r: h.rock.radius + 6 * wpp, color: RESOURCE_INFO[h.rock.kind].color };
    else if (h?.kind === 'station') target = { pos: state.run.system.station.pos, r: 60, color: 0x59ffa0 };
    else if (h?.kind === 'ship') {
      const s = state.run.ships.find((x) => x.id === h.id);
      if (s) target = { pos: s.pos, r: HULLS[s.hullId].size * 2.4 + 6 * wpp, color: 0xffffff };
    }
    this.hoverRing.visible = !!target;
    if (target) {
      this.hoverRing.position.set(target.pos.x, 24, target.pos.z);
      this.hoverRing.scale.setScalar(target.r * (1 + Math.sin(t * 6) * 0.04));
      const ringMat = this.hoverRing.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(target.color);
      // Keep ring thickness ~2px: inner radius is 0.9 → thickness 0.1·r.
      ringMat.opacity = 0.75;
    }

    this.moveMarker.visible = !!moveMark;
    if (moveMark) {
      this.moveMarker.position.set(moveMark.x, 2, moveMark.z);
      this.moveMarker.scale.setScalar(10 * wpp * (1 + Math.sin(t * 8) * 0.15));
    }
  }
}
