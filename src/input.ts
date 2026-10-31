// Keyboard + pointer input. Translates raw events into sim Commands and view
// changes. Picking is done in world space against sim data (no raycasting).
// Gamepad (#209): a standard-mapping pad is polled once per frame and runs the same actions and commands as the
// keys; while a menu or the title screen is open it moves focus instead.
// Touch (#194): a tap is the left click, a long-press the right click, and two
// fingers pinch-zoom and pan; mouse and pen keep the desktop behaviour.

import { interactTarget, padThrust, padZoom } from './core/gamepad';
import { type Point, pinchStep } from './core/gesture';
import { nextFocusIndex, FOCUSABLE } from './ui/focus';
import { GamepadHint } from './ui/GamepadHint';
import { PAD, PadReader } from './gamepad';
import { TUNING } from './data/tuning';
import { dist, type Vec2 } from './core/vec';
import { HULLS } from './data/hulls';
import type { Command } from './sim/commands';
import { outpostAt } from './sim/automation';
import { findShip, isAlive, selectedShip } from './sim/ships';
import type { GameState } from './sim/types';
import type { HoverTarget, Renderer } from './render/Renderer';
import type { Hud } from './ui/Hud';
import { actionFor, type KeyAction, type SettingsStore } from './settings';

/** How long a still finger must stay down to count as a long-press (the right click), in ms. */
const LONG_PRESS_MS = 450;
/** How far a press may wander and still be a click or tap, in pixels: mouse, then touch. */
const CLICK_SLOP = 6;
const TAP_SLOP = 10;
/** How far a pinch's midpoint must get from where it started before it also pans (dropping camera follow), in px. */
const PINCH_PAN_SLOP = 12;
/** How long a tap keeps the hover tooltip up for what was tapped, in ms. */
const TAP_TIP_MS = 2500;

export class Input {
  private held = new Set<string>();
  private drag: { x: number; y: number; button: number; moved: boolean; touch: boolean; long: boolean } | null = null;
  private mouse = { x: -1, y: -1, inside: false };
  /** Every pointer currently down on the canvas, by `pointerId`. */
  private pointers = new Map<number, Point>();
  /** Set when a second finger lands; the fingers left down do nothing until all are lifted. */
  private multi = false;
  /** The current pinch's net midpoint movement, until it passes the pan slop; null once the pinch pans. */
  private pinchDrift: Point | null = null;
  private longPress: ReturnType<typeof setTimeout> | undefined;
  /** While a tap's tooltip shows: when it hides, from `performance.now()`. 0 otherwise. */
  private tipUntil = 0;
  private readonly pad = new PadReader();
  private readonly padHint = new GamepadHint(document.body);
  /** Thrust from the pad this frame; zero while a menu is open. */
  private padVec: Vec2 = { x: 0, z: 0 };
  /** Last click-to-move destination, shown as a marker until reached. */
  moveMark: Vec2 | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly hud: Hud,
    private readonly getState: () => GameState,
    private readonly send: (c: Command) => void,
    private readonly settings: SettingsStore,
    private readonly onPause: () => void,
    private readonly blocked: () => boolean = () => false,
  ) {
    const canvas = renderer.canvas;
    window.addEventListener('keydown', (e) => {
      delete document.body.dataset.pad;
      this.onKey(e);
    });
    window.addEventListener('gamepadconnected', () => this.padHint.setShown(true));
    window.addEventListener('gamepaddisconnected', () => this.padHint.setShown(!!this.pad.read()));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const touch = e.pointerType === 'touch';
      if (touch) this.hideTapTip();
      if (this.pointers.size > 1) {
        // A second finger turns the gesture into a pinch: no tap, long-press or one-finger pan.
        this.multi = true;
        this.drag = null;
        this.pinchDrift = { x: 0, y: 0 };
        clearTimeout(this.longPress);
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, touch, long: false };
      if (touch) this.longPress = setTimeout(() => this.onLongPress(), LONG_PRESS_MS);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') this.mouse = { x: e.clientX, y: e.clientY, inside: true };
      const prev = this.pointers.get(e.pointerId);
      const next = { x: e.clientX, y: e.clientY };
      if (prev) this.pointers.set(e.pointerId, next);
      if (prev && this.pointers.size === 2) {
        const other = [...this.pointers].find(([id]) => id !== e.pointerId)![1];
        const step = pinchStep(prev, other, next, other);
        // Fingers report one at a time, so the midpoint jitters during a plain pinch; only net drift pans.
        const drift = this.pinchDrift;
        if (drift) {
          drift.x += step.dx;
          drift.y += step.dy;
          if (Math.hypot(drift.x, drift.y) > PINCH_PAN_SLOP) this.pinchDrift = null;
        } else renderer.panPixels(step.dx, step.dy);
        if (step.zoom !== 1) renderer.zoomAt(step.zoom, step.cx, step.cy);
        return;
      }
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < (d.touch ? TAP_SLOP : CLICK_SLOP)) return;
      // Right/middle drag always pans; left drag (or one finger) pans too once it moves.
      d.moved = true;
      clearTimeout(this.longPress);
      renderer.panPixels(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    const release = (e: PointerEvent, cancelled: boolean): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.multi = false;
      clearTimeout(this.longPress);
      const d = this.drag;
      this.drag = null;
      if (cancelled || !d || d.moved || d.long) return;
      if (d.touch) this.tap(e.clientX, e.clientY);
      else if (d.button === 0) this.click(e.clientX, e.clientY);
      else if (d.button === 2) this.click(e.clientX, e.clientY, true);
    };
    canvas.addEventListener('pointerup', (e) => release(e, false));
    canvas.addEventListener('pointercancel', (e) => release(e, true));
    // A lifted finger also leaves the canvas; only the mouse leaving ends the hover.
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.mouse.inside = false;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        renderer.zoomAt(Math.exp(e.deltaY * 0.0012 * this.settings.value.zoomSpeed), e.clientX, e.clientY);
      },
      { passive: false },
    );
    hud.touch.onAction = (action) => this.runAction(action);
  }

  private selected() {
    const s = this.getState();
    return selectedShip(s.run);
  }

  /** Selecting a ship re-centres the camera only if the player wants auto-follow. */
  private autoFollow(): void {
    if (this.settings.value.followByDefault) this.renderer.follow = true;
  }

  private onKey(e: KeyboardEvent): void {
    // The title screen owns the keyboard, except for Esc while a higher menu (Settings) is open.
    if (this.blocked() && !(e.code === 'Escape' && this.hud.menu.open)) return;
    // Typing into form fields (save text, selects) must not fly the ship.
    if (['SELECT', 'TEXTAREA', 'INPUT'].includes((e.target as HTMLElement)?.tagName) && e.code !== 'Escape') return;
    if (e.code === 'Escape') {
      if (this.hud.escape()) return;
      const sel = this.selected();
      if (sel) this.send({ t: 'stop', shipId: sel.id });
      this.moveMark = null;
      return;
    }
    if (this.hud.menu.open) return; // the menu owns the keyboard while open
    // Research owns Tab, arrows and Space so they move the dialog instead of the ship.
    if (this.hud.researchOpen) {
      if (!e.repeat && actionFor(this.settings.value.keys, e.code) === 'research') this.runAction('research');
      return;
    }
    const action = actionFor(this.settings.value.keys, e.code);
    if (action || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    if (action) {
      this.runAction(action, e.shiftKey);
      return;
    }
    if (/^Digit[1-9]$/.test(e.code)) {
      const ship = this.getState().run.ships[Number(e.code.slice(5)) - 1];
      if (ship) this.send({ t: 'select', shipId: ship.id });
      this.autoFollow();
    }
  }

  /** Runs a one-shot action: from its key, or from the touch strip's button. Thrust actions are held, not run. */
  runAction(action: KeyAction, reverse = false): void {
    const s = this.getState();
    switch (action) {
      case 'cycleShip': {
        const ships = s.run.ships;
        const i = ships.findIndex((x) => x.id === s.run.selectedId);
        const next = ships[(i + (reverse ? -1 : 1) + ships.length) % ships.length];
        if (next) this.send({ t: 'select', shipId: next.id });
        this.autoFollow();
        return;
      }
      case 'follow':
        this.renderer.follow = !this.renderer.follow;
        return;
      case 'map':
        this.renderer.toggleMap(s.run.system);
        return;
      case 'help':
        this.hud.toggleHelp();
        return;
      case 'research':
        this.hud.toggleResearch();
        return;
      case 'pause':
        this.onPause();
        return;
      case 'outpost': {
        if (!this.mouse.inside) return;
        const hit = this.pick(this.mouse.x, this.mouse.y);
        if (hit?.kind === 'rock') this.send({ t: 'deployOutpost', rockId: hit.rock.id });
        return;
      }
    }
  }

  /**
   * Thrust vector for the selected ship (screen up = −z): full thrust from the bound keys while any is held,
   * else the touch stick's analogue tilt.
   */
  thrust(): Vec2 {
    if (this.hud.menu.open) return { x: 0, z: 0 };
    const keys = this.settings.value.keys;
    const down = (a: KeyAction): boolean => keys[a].some((c) => c != null && this.held.has(c));
    const x = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    const z = (down('down') ? 1 : 0) - (down('up') ? 1 : 0);
    const l = Math.hypot(x, z);
    const touch = this.hud.touch.thrust;
    const out = l ? { x: x / l, z: z / l } : touch.x || touch.z ? touch : this.padVec;
    if (out.x || out.z) {
      this.moveMark = null;
      this.autoFollow();
    }
    return out;
  }

  /**
   * Polls the gamepad once per frame (also while paused, so menus work). In the game it runs the same actions as
   * the keys; with a menu, panel or the title screen open it moves focus, A presses and B/Start close.
   */
  pollGamepad(dt: number): void {
    const f = this.pad.read();
    this.padHint.setShown(!!f);
    this.padVec = { x: 0, z: 0 };
    if (!f) return;
    const overlay = [...document.querySelectorAll<HTMLElement>('.modal:not(.hidden), #boot:not([hidden])')].pop();
    if (overlay || this.blocked()) {
      if (overlay) this.padNavigate(overlay, f.edges);
      return;
    }
    const up = f.held[PAD.UP];
    const down = f.held[PAD.DOWN];
    const left = f.held[PAD.LEFT];
    const right = f.held[PAD.RIGHT];
    const stick = padThrust(f.lx, f.ly);
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dz = (down ? 1 : 0) - (up ? 1 : 0);
    this.padVec = dx || dz ? { x: dx / Math.hypot(dx, dz), z: dz / Math.hypot(dx, dz) } : stick;
    const zoom = padZoom(f.ry, dt) * padZoom((f.held[PAD.LB] ? 1 : 0) - (f.held[PAD.RB] ? 1 : 0), dt);
    if (zoom !== 1) {
      const r = this.renderer.canvas.getBoundingClientRect();
      this.renderer.zoomAt(zoom, r.left + r.width / 2, r.top + r.height / 2);
    }
    for (const b of f.edges) {
      switch (b) {
        case PAD.A:
          this.padInteract();
          break;
        case PAD.B: {
          const sel = this.selected();
          if (sel) this.send({ t: 'stop', shipId: sel.id });
          this.moveMark = null;
          break;
        }
        case PAD.X:
          this.runAction('cycleShip');
          break;
        case PAD.Y:
          this.hud.toggleWarp();
          break;
        case PAD.SELECT:
          this.runAction('map');
          break;
        case PAD.START:
          this.hud.menu.toggle();
          break;
      }
    }
  }

  /** A: unload when at the station, else mine the nearest asteroid in reach, else fly home. */
  private padInteract(): void {
    const s = this.getState();
    const ship = selectedShip(s.run);
    if (!ship || !isAlive(ship)) return;
    const target = interactTarget(ship.pos, s.run.system.station.pos, TUNING.dockRadius, s.run.rocks, 600);
    if (target?.kind === 'rock') this.send({ t: 'mine', shipId: ship.id, rockId: target.id });
    else this.send({ t: 'dock', shipId: ship.id });
    this.moveMark = null;
  }

  /** Pad control of an open overlay: D-pad steps focus (wrapping), A presses, B and Start close it. */
  private padNavigate(overlay: HTMLElement, edges: number[]): void {
    const items = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
    for (const b of edges) {
      document.body.dataset.pad = '1';
      const cur = items.indexOf(document.activeElement as HTMLElement);
      if (b === PAD.UP || b === PAD.DOWN || b === PAD.LEFT || b === PAD.RIGHT) {
        const prev = b === PAD.UP || b === PAD.LEFT;
        items[nextFocusIndex(items.length, cur, prev)]?.focus();
      } else if (b === PAD.A) {
        if (cur < 0) items[0]?.focus();
        else items[cur].click();
      } else if ((b === PAD.B || b === PAD.START) && !this.blocked()) this.hud.escape();
    }
  }

  /** Pans when the cursor rests near a screen edge (if enabled). Returns whether it panned. */
  edgePan(dt: number): boolean {
    if (!this.settings.value.edgePan || !this.mouse.inside || this.tipUntil || this.drag || this.hud.menu.open)
      return false;
    const r = this.renderer.canvas.getBoundingClientRect();
    const m = 14;
    const speed = 900 * dt;
    const dx = this.mouse.x < r.left + m ? 1 : this.mouse.x > r.right - m ? -1 : 0;
    const dy = this.mouse.y < r.top + m ? 1 : this.mouse.y > r.bottom - m ? -1 : 0;
    if (dx || dy) this.renderer.panPixels(dx * speed, dy * speed);
    return !!(dx || dy);
  }

  /** What's under a screen point: ships first, then the station, then rocks. */
  pick(clientX: number, clientY: number): HoverTarget {
    const s = this.getState();
    const w = this.renderer.screenToWorld(clientX, clientY);
    const wpp = this.renderer.wpp;
    for (const ship of s.run.ships) {
      if (isAlive(ship) && dist(ship.pos, w) < HULLS[ship.hullId].size * 1.6 + 6 * wpp)
        return { kind: 'ship', id: ship.id };
    }
    if (dist(s.run.system.station.pos, w) < 50 + 4 * wpp) return { kind: 'station' };
    let best: HoverTarget = null;
    let bestD = Infinity;
    for (const r of s.run.rocks) {
      const d = dist(r.pos, w) - r.radius;
      if (d < 6 * wpp && d < bestD) {
        bestD = d;
        best = { kind: 'rock', rock: r };
      }
    }
    return best;
  }

  /** A still finger held down: the right click at the press point, unless the finger moved or another landed. */
  private onLongPress(): void {
    const d = this.drag;
    if (!d || d.moved) return;
    d.long = true;
    navigator.vibrate?.(12);
    this.click(d.x, d.y, true);
  }

  /** A tap: deploys an armed outpost, else the left click, and shows the tooltip for what was tapped. */
  private tap(clientX: number, clientY: number): void {
    if (this.hud.touch.outpostArmed) {
      this.hud.touch.setArmed(false);
      const hit = this.pick(clientX, clientY);
      if (hit?.kind === 'rock') this.send({ t: 'deployOutpost', rockId: hit.rock.id });
      return;
    }
    this.click(clientX, clientY);
    this.mouse = { x: clientX, y: clientY, inside: true };
    this.tipUntil = performance.now() + TAP_TIP_MS;
  }

  private hideTapTip(): void {
    if (!this.tipUntil) return;
    this.tipUntil = 0;
    this.mouse.inside = false;
  }

  /** Left click: select / mine / dock / move. Right click: same but never changes selection. */
  private click(clientX: number, clientY: number, keepSelection = false): void {
    const sel = this.selected();
    const hit = this.pick(clientX, clientY);
    if (hit?.kind === 'ship' && !keepSelection) {
      this.send({ t: 'select', shipId: hit.id });
      this.autoFollow();
      return;
    }
    if (!sel || !isAlive(sel)) return;
    if (hit?.kind === 'rock') {
      this.send({ t: 'mine', shipId: sel.id, rockId: hit.rock.id });
      this.moveMark = null;
    } else if (hit?.kind === 'station') {
      this.send({ t: 'dock', shipId: sel.id });
      this.moveMark = null;
    } else {
      const to = this.renderer.screenToWorld(clientX, clientY);
      this.send({ t: 'move', shipId: sel.id, to });
      this.moveMark = to;
    }
  }

  /** Per-frame hover update (ring + tooltip). */
  updateHover(): void {
    if (this.tipUntil && performance.now() > this.tipUntil) this.hideTapTip();
    const sel = this.selected();
    if (this.moveMark && (!sel || sel.order?.kind !== 'move')) this.moveMark = null;
    if (!this.mouse.inside || this.drag?.moved) {
      this.renderer.hover = null;
      this.hud.showTooltip(0, 0, null, null);
      return;
    }
    const hit = this.pick(this.mouse.x, this.mouse.y);
    this.renderer.hover = hit;
    const s = this.getState();
    const label =
      hit?.kind === 'station'
        ? `${s.run.system.name} Station · click to dock & unload`
        : hit?.kind === 'ship'
          ? (findShip(s.run, hit.id)?.name ?? null)
          : null;
    const rock = hit?.kind === 'rock' ? hit.rock : null;
    this.hud.showTooltip(this.mouse.x, this.mouse.y, rock, label, rock ? outpostAt(s, rock.id) : undefined);
  }
}
