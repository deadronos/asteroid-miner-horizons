// Top-down Three.js renderer. The sim's { x, z } plane is the ground plane;
// an orthographic camera looks straight down (screen right = +x, up = −z).
// Owns the view state (zoom, pan, follow) and turns sim fx into particles.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clamp, damp, type Vec2 } from '../core/vec';
import { HULLS } from '../data/hulls';
import { RESOURCE_INFO } from '../data/resources';
import { QUALITY, SHAKE_SCALE, type Settings } from '../settings';
import { isAlive } from '../sim/ships';
import type { GameState, Rock, StarSystem } from '../sim/types';
import { Backdrop } from './backdrop';
import type { ViewRect } from './cull';
import { Debris } from './debris';
import { FloatingText } from './floatingText';
import { HazardView } from './hazardView';
import { Particles } from './particles';
import { ROCK_TINT, RockView } from './rocks';
import { ShipView } from './shipView';
import { SystemView } from './systemView';
import { additive, flat } from './util';

/**
 * Final composer pass: presents the sRGB-encoded buffer as-is (no second
 * encode). Values above 1 (boosted glow colours plus bloom) are pulled back
 * mostly hue-preserving, so a bright orange pickup stays orange rather than
 * clipping to yellow, while some white-hot clipping is kept for beams and the star.
 */
const PRESENT_SHADER = {
  uniforms: { tDiffuse: { value: null }, hueKeep: { value: 0.5 } },
  vertexShader: `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float hueKeep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float m = max(max(c.r, c.g), c.b);
  vec3 hue = c / max(1.0, m);
  gl_FragColor = vec4(mix(min(c, 1.0), hue, hueKeep), 1.0);
}`,
};

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
  private hazardView = new HazardView();
  private particles = new Particles();
  /** 0..1 star-glow boost, eased toward 1 while a solar flare is active. */
  private flareGlow = 0;
  private debris = new Debris();
  private floaters: FloatingText;
  private hoverRing: THREE.Mesh;
  private moveMarker: THREE.Mesh;
  private shake = 0;
  /** Bloom post-processing; created the first time a quality preset wants it. */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bloomOn = false;
  private readonly msaa: number;
  private warpFlash = 0;
  /** The camera's world rectangle this frame (shake included), reused for culling. */
  private readonly cullView: ViewRect = { x: 0, z: 0, halfW: 0, halfH: 0 };

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
    this.msaa = settings.antialias ? 4 : 0;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);
    this.floaters = new FloatingText(container);

    this.camera.up.set(0, 0, -1);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
    this.scene.add(
      this.backdrop.group,
      this.system.group,
      this.rocks.group,
      this.ships.group,
      this.hazardView.line,
      this.particles.points,
      this.debris.mesh,
    );

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
    this.bloomOn = q.bloom > 0;
    if (this.bloomOn) this.ensureComposer().bloom.strength = q.bloom;
    this.rocks.glow = this.ships.glow = this.bloomOn ? 1.8 : 1;
    this.resize();
    this.backdrop.configure(q.stars, s.nebula);
    this.particles.density = q.particles;
    this.debris.density = q.particles;
    this.shakeScale = SHAKE_SCALE[s.shake];
    this.alwaysBars = s.alwaysShowBars;
  }

  private ensureComposer(): { composer: EffectComposer; bloom: UnrealBloomPass } {
    if (!this.composer || !this.bloom) {
      // The scene leans on low-opacity layers (nebula, belts, haze) that were tuned
      // for blending in sRGB on the canvas. Render targets normally blend in linear
      // space, which lifts those layers into a grey-blue fog, so the composer's
      // buffers take the XR-target path: shaders write sRGB-encoded values into a
      // half-float buffer and blend exactly as on screen; PRESENT_SHADER shows
      // it with no second encode. MSAA on the target replaces the context's
      // antialiasing, which post-processing bypasses.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.msaa });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      this.composer = new EffectComposer(this.gl, target);
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2])
        Object.assign(t, { isXRRenderTarget: true });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Threshold keeps lit rocks and hulls crisp; only bright additive light glows.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.35, 0.96);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new ShaderPass(PRESENT_SHADER));
    }
    return { composer: this.composer, bloom: this.bloom };
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.gl.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.gl.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  private get aspect(): number {
    return this.container.clientWidth / Math.max(1, this.container.clientHeight);
  }

  /** The visible world rectangle (center + half extents), for audio falloff. */
  get view(): { center: Vec2; halfW: number; halfH: number } {
    return { center: this.center, halfW: this.halfH * this.aspect, halfH: this.halfH };
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
      this.flareGlow = 0;
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
    this.flareGlow += ((run.hazards.flare?.phase === 'active' ? 1 : 0) - this.flareGlow) * (1 - damp(4, dt));
    this.system.update(sys, run.time, this.flareGlow);
    const v = this.cullView;
    v.x = cx;
    v.z = cz;
    v.halfW = this.halfH * a;
    v.halfH = this.halfH;
    this.rocks.update(run.rocks, run.pickups, run.time, v);
    const wpp = this.wpp;
    const hits = this.ships.update(state, run.time, dt, wpp, this.alwaysBars);
    this.hazardView.update(run.hazards, run.time, wpp);

    this.consumeFx(state, hits, dt);
    this.particles.update(dt);
    this.debris.update(dt);
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
    if (this.bloomOn && this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
  }

  private onScreen(p: Vec2): boolean {
    return Math.abs(p.x - this.center.x) < this.halfH * this.aspect && Math.abs(p.z - this.center.z) < this.halfH;
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
          this.debris.burst(fx.pos.x, fx.pos.z, fx.radius, ROCK_TINT[fx.kind]);
          // Only cracks the player can see shake the camera; big rocks hit harder.
          if (this.onScreen(fx.pos)) this.shake = Math.min(14, this.shake + Math.min(7, 1 + fx.radius / 5));
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
          this.ships.flashNear(fx.pos);
          if (this.onScreen(fx.pos)) this.shake = Math.min(14, this.shake + 5);
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
        case 'hazard':
          if (fx.phase !== 'start') break;
          if (fx.kind === 'comet' && fx.pos) P.emit(fx.pos.x, fx.pos.z, col.setHex(0xa8dcff), 30, 160, 1);
          else if (fx.kind === 'flare') this.shake = Math.max(this.shake, 12);
          break;
      }
    }
    state.out.fx.length = 0;

    for (const h of hits) {
      if (Math.random() < dt * 40) P.emit(h.x, h.z, col.setHex(0xffc080), 1, 90, 0.35);
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
