// Keyboard + pointer input. Translates raw events into sim Commands and view
// changes. Picking is done in world space against sim data (no raycasting).

import { dist, type Vec2 } from './core/vec';
import { HULLS } from './data/hulls';
import type { Command } from './sim/commands';
import { outpostAt } from './sim/automation';
import { findShip, isAlive, selectedShip } from './sim/ships';
import type { GameState } from './sim/types';
import type { HoverTarget, Renderer } from './render/Renderer';
import type { Hud } from './ui/Hud';
import { actionFor, type KeyAction, type SettingsStore } from './settings';

export class Input {
  private held = new Set<string>();
  private drag: { x: number; y: number; button: number; moved: boolean } | null = null;
  private mouse = { x: -1, y: -1, inside: false };
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
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY, inside: true };
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      // Right/middle drag always pans; left drag pans too once it moves.
      d.moved = true;
      renderer.panPixels(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && d.button === 0) this.click(e.clientX, e.clientY);
      if (d && !d.moved && d.button === 2) this.click(e.clientX, e.clientY, true);
    });
    canvas.addEventListener('pointerleave', () => (this.mouse.inside = false));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        renderer.zoomAt(Math.exp(e.deltaY * 0.0012 * this.settings.value.zoomSpeed), e.clientX, e.clientY);
      },
      { passive: false },
    );
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
    if (this.blocked()) return;
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
    const action = actionFor(this.settings.value.keys, e.code);
    if (action || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    const s = this.getState();
    switch (action) {
      case 'cycleShip': {
        const ships = s.run.ships;
        const i = ships.findIndex((x) => x.id === s.run.selectedId);
        const next = ships[(i + (e.shiftKey ? -1 : 1) + ships.length) % ships.length];
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
        this.settings.set({ showHelp: !this.settings.value.showHelp });
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
    if (/^Digit[1-9]$/.test(e.code)) {
      const ship = s.run.ships[Number(e.code.slice(5)) - 1];
      if (ship) this.send({ t: 'select', shipId: ship.id });
      this.autoFollow();
    }
  }

  /** Thrust vector for the selected ship from the bound keys (screen up = −z). */
  thrust(): Vec2 {
    if (this.hud.menu.open) return { x: 0, z: 0 };
    const keys = this.settings.value.keys;
    const down = (a: KeyAction): boolean => keys[a].some((c) => c != null && this.held.has(c));
    const x = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    const z = (down('down') ? 1 : 0) - (down('up') ? 1 : 0);
    if (x || z) {
      this.moveMark = null;
      this.autoFollow();
    }
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  /** Pans when the cursor rests near a screen edge (if enabled). Returns whether it panned. */
  edgePan(dt: number): boolean {
    if (!this.settings.value.edgePan || !this.mouse.inside || this.drag || this.hud.menu.open) return false;
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
