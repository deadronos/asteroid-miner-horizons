// Top-down Three.js renderer. The sim's { x, z } plane is the ground plane;
// an orthographic camera looks straight down (screen right = +x, up = −z).
// Composes the scene views; the camera rig (camera.ts) owns the view state
// (zoom, pan, follow) and FxView (fxView.ts) turns sim fx into particles.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { damp, type Vec2 } from '../core/vec';
import { HULLS } from '../data/hulls';
import { QUALITY, SHAKE_SCALE, type Settings } from '../settings';
import { findRock } from '../sim/generate';
import { findShip, isAlive, selectedShip } from '../sim/ships';
import type { GameState, Rock, Run, StarSystem } from '../sim/types';
import { autoQualitySettings } from './autoQuality';
import { contextAntialias, useComposer } from './aa';
import { Backdrop } from './backdrop';
import { CameraRig } from './camera';
import { type WarmKey, claimWarm, composerWarmKey, warmComposer } from './composerWarmup';
import { watchContextLoss } from './contextLoss';
import type { ViewRect } from './cull';
import { FxView } from './fxView';
import { HazardView } from './hazardView';
import { type Box, MapLabels } from './labels';
import { OutpostView } from './outpostView';
import { type InfoSnapshot, infoSnapshot } from './renderInfo';
import { RockView, syncRockTints } from './rocks';
import { ShipView } from './shipView';
import { SystemView } from './systemView';
import { additive, flat } from './util';
import { withVisible } from './warmup';
import { WARP_REST, WARP_TOTAL, type WarpFrame, WarpStreaks, toneDownWarpMotion, warpFrame } from './warpFx';
import { palette, setColourVision } from './activePalette';

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

export type HoverTarget = { kind: 'rock'; rock: Rock } | { kind: 'station' } | { kind: 'ship'; id: number } | null;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: CameraRig;
  private backdrop = new Backdrop();
  private system = new SystemView();
  private rocks = new RockView();
  private ships = new ShipView();
  private hazardView = new HazardView();
  private outpostView = new OutpostView();
  /** The run being drawn this frame, read by the hoisted callbacks below so `render` allocates no closures. */
  private curRun: Run | null = null;
  private readonly rockOf = (id: number): Rock | undefined => (this.curRun ? findRock(this.curRun, id) : undefined);
  private readonly anchorOf = (id: number): Vec2 | null => {
    const s = this.curRun ? findShip(this.curRun, id) : undefined;
    return s && isAlive(s) ? s.pos : null;
  };
  private readonly toScreen = (p: Vec2): { x: number; y: number } => this.cam.worldToScreen(p);
  private readonly onScreen = (p: Vec2): boolean => this.cam.onScreen(p);
  private fx: FxView;
  /** 0..1 star-glow boost, eased toward 1 while a solar flare is active. */
  private flareGlow = 0;
  private labels: MapLabels;
  /** Client rectangles map labels must not cover; main.ts points this at the HUD panels. */
  labelBlockers: () => Box[] = () => [];
  /** Called once when the WebGL context is lost; main.ts points this at the session save and reload. */
  onContextLost: () => void = () => {};
  private hoverRing: THREE.Mesh;
  private moveMarker: THREE.Mesh;
  /** Bloom post-processing; created the first time a quality preset wants it. */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bloomOn = false;
  /** Whether this frame renders through the composer; set by applySettings. */
  private viaComposer = false;
  /** Composer looks whose programs are already compiled; see warmComposer. */
  private warmed = new Set<WarmKey>();
  /** Whether the WebGL context was created with `antialias`; fixed for its lifetime. */
  private readonly contextAA: boolean;
  private readonly msaa: number;
  /** Seconds since the last warp; the transition plays while it is below WARP_TOTAL. */
  private warpT = WARP_TOTAL;
  private readonly warp: WarpFrame = { ...WARP_REST };
  private streaks = new WarpStreaks();
  /** Set when a new system is built; the next frame compiles its shaders while the warp plays. */
  private warmup = false;
  /** Set when a resize or settings change cleared or restyled the canvas; the next render clears it. */
  private dirty = true;
  /** The camera's world rectangle this frame (shake included), reused for culling. */
  private readonly cullView: ViewRect = { x: 0, z: 0, halfW: 0, halfH: 0 };

  hover: HoverTarget = null;
  private shakeScale = 1;
  private alwaysBars = false;
  private reducedMotion = false;
  private lowQuality = false;

  /**
   * `antialias` is fixed for the WebGL context's lifetime; it applies on reload. The context gets it only when
   * the startup preset has no bloom. Otherwise the composer's MSAA target carries it, and a later switch to a
   * no-bloom preset renders through that target until reload.
   */
  constructor(
    private container: HTMLElement,
    settings: Settings,
  ) {
    const initialQuality = settings.quality === 'auto' ? 'high' : settings.quality;
    this.contextAA = contextAntialias(settings.antialias, QUALITY[initialQuality].bloom);
    this.gl = new THREE.WebGLRenderer({ antialias: this.contextAA, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x03060d);
    // Counters span the whole frame: every composer pass adds to them, and render() resets them once.
    this.gl.info.autoReset = false;
    this.msaa = settings.antialias ? 4 : 0;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);
    watchContextLoss(this.canvas, () => this.onContextLost());
    this.cam = new CameraRig(container, this.canvas);
    this.labels = new MapLabels(container, () => this.labelBlockers());
    this.fx = new FxView(container, this.ships);

    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
    this.scene.add(
      this.backdrop.group,
      this.system.group,
      this.rocks.group,
      this.outpostView.group,
      this.ships.group,
      this.hazardView.line,
      this.fx.particles.points,
      this.fx.debris.mesh,
      this.streaks.lines,
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

  applySettings(s: Settings, autoLevel = 0): void {
    if (setColourVision(s.colourVision)) {
      syncRockTints();
      this.dirty = true;
    }
    const automatic = s.quality === 'auto' ? autoQualitySettings(autoLevel) : null;
    const quality = automatic ? automatic.quality : s.quality === 'auto' ? 'high' : s.quality;
    const q = QUALITY[quality];
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap) * s.renderScale * (automatic?.scale ?? 1));
    this.bloomOn = q.bloom > 0;
    this.viaComposer = useComposer(this.bloomOn, this.msaa > 0, this.contextAA);
    // Bloom off but still via the composer (runtime fallback, until reload): close to the canvas look, not identical.
    // The half-float buffer does not clamp per blend and PRESENT keeps hue above 1. The disabled bloom pass keeps
    // its targets allocated, which is deliberate for a state that lasts only until reload.
    if (this.viaComposer) {
      const { bloom } = this.ensureComposer();
      bloom.enabled = this.bloomOn;
      if (this.bloomOn) bloom.strength = q.bloom;
    }
    this.rocks.glow = this.ships.glow = this.bloomOn ? 1.8 : 1;
    this.resize();
    // Warm-up is an off-screen render rather than compileAsync, because program keys depend on the target's
    // colour space. It runs after resize() so the targets have their real size. The scene is hidden so the
    // render builds only the pass programs; the scene's own programs are warmed by warmShaders (#118).
    const warmKey = composerWarmKey(this.viaComposer, this.bloomOn);
    if (warmKey && this.composer && !this.gl.getContext().isContextLost() && claimWarm(warmKey, this.warmed)) {
      const sceneVisible = this.scene.visible;
      this.scene.visible = false;
      try {
        warmComposer(this.composer);
      } finally {
        this.scene.visible = sceneVisible;
      }
    }
    this.backdrop.configure(q.stars, s.nebula);
    this.fx.density = q.particles;
    this.shakeScale = SHAKE_SCALE[s.shake];
    this.alwaysBars = s.alwaysShowBars;
    this.lowQuality = quality === 'low';
    this.syncMapPulse();
  }

  /** Applies the OS reduced-motion preference without changing saved settings. */
  setReducedMotion(on: boolean): void {
    if (this.reducedMotion === on) return;
    this.reducedMotion = on;
    this.dirty = true;
    this.syncMapPulse();
  }

  /** Map blips pulse only when motion is welcome and the quality preset is not Low. */
  private syncMapPulse(): void {
    this.labels.setPulse(!this.reducedMotion && !this.lowQuality);
  }

  private ensureComposer(): { composer: EffectComposer; bloom: UnrealBloomPass } {
    if (!this.composer || !this.bloom) {
      // The scene leans on low-opacity layers (nebula, belts, haze) that were tuned
      // for blending in sRGB on the canvas. Render targets normally blend in linear
      // space, which lifts those layers into a grey-blue fog, so the composer's
      // buffers take the XR-target path: shaders write sRGB-encoded values into a
      // half-float buffer and blend exactly as on screen; PRESENT_SHADER shows
      // it with no second encode. The context is created without antialias whenever
      // the startup preset has bloom, because this target's MSAA carries it.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.msaa });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      this.composer = new EffectComposer(this.gl, target);
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2])
        Object.assign(t, { isXRRenderTarget: true });
      this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
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
    this.dirty = true;
    if (this.composer) {
      this.composer.setPixelRatio(this.gl.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  /** Keeps the camera on the selected ship; panning or the system map turns it off. */
  get follow(): boolean {
    return this.cam.follow;
  }

  set follow(on: boolean) {
    this.cam.follow = on;
  }

  /** The visible world rectangle (center + half extents), for audio falloff. */
  get view(): { center: Vec2; halfW: number; halfH: number } {
    return this.cam.view;
  }

  /** World units per CSS pixel at the current zoom. */
  get wpp(): number {
    return this.cam.wpp;
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    return this.cam.screenToWorld(clientX, clientY);
  }

  /** World point → CSS pixels relative to the scene container. */
  worldToScreen(p: Vec2): { x: number; y: number } {
    return this.cam.worldToScreen(p);
  }

  /** Zooms by `factor`, keeping the world point under the cursor fixed (unless following). */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    this.cam.zoomAt(factor, clientX, clientY);
  }

  panPixels(dx: number, dy: number): void {
    this.cam.panPixels(dx, dy);
  }

  /** Toggle between a whole-system overview and the previous zoom. */
  toggleMap(sys: StarSystem): void {
    this.cam.toggleMap(sys);
  }

  render(state: GameState, dt: number, moveMark: Vec2 | null): void {
    this.gl.info.reset();
    const { run } = state;
    const sys = run.system;
    if (this.system.sync(sys)) {
      this.warmup = true;
      this.flareGlow = 0;
      this.backdrop.setSystem(state.profile.seed + sys.number);
      this.cam.resetSnap();
    }

    // The warp sequence runs on frame time, so it never holds up the sim or input.
    // It starts on the frame the warp fx arrives, before the new system is drawn.
    this.warpT = Math.min(WARP_TOTAL, this.warpT + dt);
    for (const fx of state.out.fx) if (fx.t === 'warp') this.warpT = 0;
    const w = warpFrame(this.warpT, this.warp);
    const motionK = this.reducedMotion ? 0.45 : 1;
    if (motionK < 1) toneDownWarpMotion(w, motionK);

    // Camera: smooth zoom, follow the selected ship, then shake.
    const sel = selectedShip(run);
    this.cam.ease(dt, sel ? (isAlive(sel) ? sel.pos : sys.station.pos) : null);
    this.fx.decayShake(dt);
    const amp = (this.fx.shake + w.shudder * 8) * (this.reducedMotion ? 0 : this.shakeScale) * this.wpp;
    const sx = (Math.random() - 0.5) * amp;
    const sz = (Math.random() - 0.5) * amp;
    const v = this.cam.place(sx, sz, w.zoom, this.cullView);

    this.backdrop.update(v.x, v.z, v.halfH, 1 - w.stretch);
    this.streaks.update(w.stretch, v.x, v.z, v.halfW, v.halfH);
    this.flareGlow += ((run.hazards.flare?.phase === 'active' ? 1 : 0) - this.flareGlow) * (1 - damp(4, dt));
    this.system.update(sys, run.time, this.flareGlow);
    this.rocks.update(run.rocks, run.pickups, run.time, v);
    this.curRun = run;
    this.outpostView.update(run.automation.outposts, this.rockOf, run.time);
    const wpp = this.wpp;
    const hits = this.ships.update(state, run.time, dt, wpp, this.alwaysBars, motionK);
    this.hazardView.update(run.hazards, run.time, wpp);

    if (this.fx.consume(state, hits, dt, this.onScreen)) this.follow = true;
    this.fx.update(dt);
    this.updateMarkers(state, moveMark, wpp);
    this.setPlayfieldVisible(!w.hidden);
    this.labels.update(run, w.hidden ? 0 : this.cam.halfH, this.wpp, dt, this.toScreen);
    this.fx.updateText(dt, this.toScreen, this.anchorOf);

    if (this.warmup) {
      this.warmup = false;
      this.warmShaders();
    }

    if (this.viaComposer && this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.cam.camera);
    this.dirty = false;
  }

  /**
   * Compiles the scene's programs before the playfield is shown, so the first visible frame of a new
   * system does not stall. Materials are found by a full traverse, but lights are gathered only from
   * visible objects, and the warp hides system.group, which holds the star's PointLight. Forcing that group
   * visible gives the programs the same light-count key as the real render. compileAsync's promise is only
   * polled; `.catch` keeps it from ever rejecting unhandled.
   */
  private warmShaders(): void {
    withVisible([this.system.group], () => {
      void this.gl.compileAsync(this.scene, this.cam.camera).catch(() => {});
    });
  }

  /**
   * Draw counters for the last whole frame (every pass, bloom composer included, since autoReset
   * is off and render() resets once per frame), plus live memory and program totals.
   */
  get info(): InfoSnapshot {
    return infoSnapshot(this.gl.info);
  }

  /**
   * Whether the view is still animating on its own (warp, camera glide, shake, a pending shader warm-up)
   * or the canvas needs redrawing after a resize, so a paused frame loop must render this frame.
   */
  get busy(): boolean {
    return this.dirty || this.warpT < WARP_TOTAL || this.warmup || this.cam.moving || this.fx.shake > 0;
  }

  /** 0..1 white-out intensity during the warp transition, for the HUD overlay. */
  get flash(): number {
    return this.warp.flash;
  }

  /**
   * Hides everything but the starfield while the warp streaks play. Runs after the
   * per-frame updates, since the hazard line and markers set their own visibility.
   */
  private setPlayfieldVisible(on: boolean): void {
    this.system.group.visible = this.rocks.group.visible = this.ships.group.visible = on;
    this.outpostView.group.visible = on;
    this.fx.setVisible(on);
    if (!on) this.hazardView.line.visible = this.hoverRing.visible = this.moveMarker.visible = false;
  }

  private updateMarkers(state: GameState, moveMark: Vec2 | null, wpp: number): void {
    const t = state.run.time;
    const h = this.hover;
    let target: { pos: Vec2; r: number; color: number } | null = null;
    if (h?.kind === 'rock')
      target = { pos: h.rock.pos, r: h.rock.radius + 6 * wpp, color: palette().resource[h.rock.kind] };
    else if (h?.kind === 'station') target = { pos: state.run.system.station.pos, r: 60, color: palette().ok };
    else if (h?.kind === 'ship') {
      const s = findShip(state.run, h.id);
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
      (this.moveMarker.material as THREE.MeshBasicMaterial).color.setHex(palette().ok);
      this.moveMarker.position.set(moveMark.x, 2, moveMark.z);
      this.moveMarker.scale.setScalar(10 * wpp * (1 + Math.sin(t * 8) * 0.15));
    }
  }
}
