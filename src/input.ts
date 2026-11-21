// Keyboard, pointer and gamepad input coordinator. Translates raw events into
// sim Commands and view changes; picking is done in world space against sim
// data (no raycasting). Canvas gestures live in `pointerGestures.ts` and
// gamepad overlay navigation lives in `padNav.ts`.

import { interactTarget, padThrust, padZoom } from './core/gamepad';
import { dist, type Vec2 } from './core/vec';
import { HULLS } from './data/hulls';
import { TUNING } from './data/tuning';
import { PAD, PadReader, padCommand } from './gamepad';
import { activeOverlay, padNavigate } from './padNav';
import { PointerGestures } from './pointerGestures';
import type { HoverTarget, Renderer } from './render/Renderer';
import { actionFor, type KeyAction, type SettingsStore } from './settings';
import { outpostAt } from './sim/automation';
import type { Command } from './sim/commands';
import { findShip, isAlive, isFlagship, selectedShip } from './sim/ships';
import type { GameState } from './sim/types';
import { confirmOpen } from './ui/confirm';
import { GamepadHint } from './ui/GamepadHint';
import type { Hud } from './ui/Hud';

export { activeOverlay, padNavigate, stepRange } from './padNav';

export class Input {
  private held = new Set<string>();
  private readonly pointer: PointerGestures;
  private readonly pad = new PadReader();
  private readonly padHint: GamepadHint;
  /** Thrust from the pad this frame; zero while a menu is open. */
  private padVec: Vec2 = { x: 0, z: 0 };
  /** Last click-to-move destination, shown as a marker until reached. */
  moveMark: Vec2 | null = null;

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    delete document.body.dataset.pad;
    this.onKey(e);
  };

  private readonly onWindowKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onWindowBlur = (): void => {
    this.held.clear();
  };

  private readonly onGamepadConnected = (): void => {
    this.padHint.setShown(true);
    this.hud.setGamepad?.(true);
  };

  private readonly onGamepadDisconnected = (): void => {
    const on = !!this.pad.read();
    this.padHint.setShown(on);
    this.hud.setGamepad?.(on);
  };

  constructor(
    private readonly renderer: Renderer,
    private readonly hud: Hud,
    private readonly getState: () => GameState,
    private readonly send: (c: Command) => void,
    private readonly settings: SettingsStore,
    private readonly onPause: () => void,
    private readonly blocked: () => boolean = () => false,
  ) {
    this.padHint = new GamepadHint(hud.root ?? document.body);
    this.pointer = new PointerGestures(renderer.canvas, {
      onPan: (dx, dy) => renderer.panPixels(dx, dy),
      onZoom: (factor, cx, cy) => renderer.zoomAt(factor, cx, cy),
      onClick: (x, y, keepSelection) => this.click(x, y, keepSelection),
      onTap: (x, y) => this.tap(x, y),
      zoomSpeed: () => this.settings.value.zoomSpeed,
    });
    window.addEventListener('keydown', this.onWindowKeyDown);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    hud.touch.onAction = (action) => this.runAction(action);
  }

  /** Removes all registered window and canvas listeners and clears active gesture timers. */
  dispose(): void {
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.pointer.dispose();
    this.held.clear();
    this.hud.touch.onAction = () => {};
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
    // The title screen owns the keyboard, except for Esc while a higher menu (Settings, Confirm) is open.
    if (this.blocked() && !(e.code === 'Escape' && (this.hud.menu.open || confirmOpen()))) return;
    // Typing into form fields (save text, selects) must not fly the ship.
    if (['SELECT', 'TEXTAREA', 'INPUT'].includes((e.target as HTMLElement)?.tagName) && e.code !== 'Escape') return;
    if (e.code === 'Escape') {
      if (this.hud.escape()) return;
      const sel = this.selected();
      if (sel) this.send({ t: 'stop', shipId: sel.id });
      this.moveMark = null;
      return;
    }
    if (this.hud.hasModalOpen()) {
      // Research owns Tab/arrows/Space, but its own toggle key still closes it when no other modal is above it.
      if (
        this.hud.researchOpen &&
        !confirmOpen() &&
        !this.hud.menu.open &&
        !this.hud.gateOpen &&
        !this.hud.warpOpen &&
        !e.repeat &&
        actionFor(this.settings.value.keys, e.code) === 'research'
      ) {
        this.runAction('research');
      }
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
        if (!this.pointer.mouse.inside) return;
        const hit = this.pick(this.pointer.mouse.x, this.pointer.mouse.y);
        if (hit?.kind === 'rock') this.send({ t: 'deployOutpost', rockId: hit.rock.id });
        return;
      }
      case 'ping':
        this.send({ t: 'ping' });
        return;
    }
  }

  /**
   * Thrust vector for the selected ship (screen up = −z): full thrust from the bound keys while any is held,
   * else the touch stick's analogue tilt.
   */
  thrust(): Vec2 {
    if (this.hud.hasModalOpen()) return { x: 0, z: 0 };
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
    this.hud.setGamepad?.(!!f);
    this.padVec = { x: 0, z: 0 };
    if (!f) return;
    const overlay = activeOverlay();
    if (overlay || this.blocked()) {
      if (overlay) {
        const canClose = !this.blocked() || this.hud.menu.open || overlay.classList.contains('modal');
        padNavigate(overlay, f.edges, canClose, () => this.hud.escape());
      }
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
      const command = padCommand(b);
      if (command) {
        this.send(command);
        continue;
      }
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
        case PAD.LT:
          this.runAction('research');
          break;
        case PAD.R3:
          this.padDeployOutpost();
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

  /** R3: deploy an outpost on the nearest eligible large asteroid to the flagship. */
  private padDeployOutpost(): void {
    const s = this.getState();
    const fs = s.run.ships.find(isFlagship);
    if (!fs || !isAlive(fs)) return;
    let bestId: number | null = null;
    let bestD = Infinity;
    for (const r of s.run.rocks) {
      if (r.size !== 0 || r.comet || outpostAt(s, r.id)) continue;
      const d = dist(fs.pos, r.pos) - r.radius;
      if (d < bestD) {
        bestD = d;
        bestId = r.id;
      }
    }
    if (bestId !== null) this.send({ t: 'deployOutpost', rockId: bestId });
  }

  /** Pans when the cursor rests near a screen edge (if enabled). Returns whether it panned. */
  edgePan(dt: number): boolean {
    if (
      !this.settings.value.edgePan ||
      !this.pointer.mouse.inside ||
      this.pointer.hasTapTip ||
      this.pointer.isDragging ||
      this.hud.hasModalOpen()
    )
      return false;
    const r = this.renderer.canvas.getBoundingClientRect();
    const m = 14;
    const speed = 900 * dt;
    const dx = this.pointer.mouse.x < r.left + m ? 1 : this.pointer.mouse.x > r.right - m ? -1 : 0;
    const dy = this.pointer.mouse.y < r.top + m ? 1 : this.pointer.mouse.y > r.bottom - m ? -1 : 0;
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

  /** A tap: deploys an armed outpost, else the left click, and shows the tooltip for what was tapped. */
  private tap(clientX: number, clientY: number): void {
    if (this.hud.touch.outpostArmed) {
      this.hud.touch.setArmed(false);
      const hit = this.pick(clientX, clientY);
      if (hit?.kind === 'rock') this.send({ t: 'deployOutpost', rockId: hit.rock.id });
      return;
    }
    this.click(clientX, clientY);
    this.pointer.showTapTip(clientX, clientY);
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
    this.pointer.expireTapTip();
    const sel = this.selected();
    if (this.moveMark && (!sel || sel.order?.kind !== 'move')) this.moveMark = null;
    if (!this.pointer.mouse.inside || this.pointer.isMovedDrag) {
      this.renderer.hover = null;
      this.hud.showTooltip(0, 0, null, null);
      return;
    }
    const hit = this.pick(this.pointer.mouse.x, this.pointer.mouse.y);
    this.renderer.hover = hit;
    const s = this.getState();
    const label =
      hit?.kind === 'station'
        ? `${s.run.system.name} Station · ${this.hud.touch.shown ? 'tap' : 'click'} to dock & unload`
        : hit?.kind === 'ship'
          ? (findShip(s.run, hit.id)?.name ?? null)
          : null;
    const rock = hit?.kind === 'rock' ? hit.rock : null;
    this.hud.showTooltip(
      this.pointer.mouse.x,
      this.pointer.mouse.y,
      rock,
      label,
      rock ? outpostAt(s, rock.id) : undefined,
    );
  }
}
