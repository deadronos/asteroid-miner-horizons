// DOM HUD composer: places the panels (top bar, fleet, contracts, selected
// ship, refinery, research) and owns the small overlays — event log, help, hover
// tooltip, warp flash, pause banner and FPS counter. All actions go out as sim
// Commands via `send`.

import { RESOURCE_INFO } from '../data/resources';
import type { SaveActions } from '../session';
import type { Command } from '../sim/commands';
import { keyLabel, type SettingsStore } from '../settings';
import type { GameState, LogEntry, Rock } from '../sim/types';
import { type Panel, h, setText } from './dom';
import { hazardBanner } from './hazardBanner';
import { Menu } from './Menu';
import type { PanelCtx } from './panels/context';
import { createContractsPanel } from './panels/ContractsPanel';
import { createFleetPanel } from './panels/FleetPanel';
import { createRefineryPanel } from './panels/RefineryPanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { createShipPanel } from './panels/ShipPanel';
import { createTopBar } from './panels/TopBar';

const MAX_LOG = 60;

export interface HudActions {
  send: (cmd: Command) => void;
  saves: SaveActions;
}

export class Hud {
  readonly root: HTMLElement;
  private getState: () => GameState;
  private panels: Panel[];
  private research: ResearchPanel;
  private log = h('div', { class: 'hud' }) as HTMLElement;
  private tooltip = h('div', { class: 'tooltip' });
  private flash = h('div', { class: 'flash' });
  private help: HTMLElement;
  private paused = h('div', { class: 'paused hidden' });
  private hazard = h('div', { class: 'hazard hidden' });
  private fps = h('div', { class: 'fps hidden' });
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsWorst = 0;
  readonly menu: Menu;

  constructor(
    root: HTMLElement,
    getState: () => GameState,
    actions: HudActions,
    private readonly settings: SettingsStore,
  ) {
    this.root = root;
    this.getState = getState;
    const mk = (id: string, cls = 'hud'): HTMLElement => {
      const e = h('div', { class: cls });
      e.id = id;
      root.append(e);
      return e;
    };
    const ctx: PanelCtx = { getState, send: actions.send, settings };
    this.panels = [
      createTopBar(mk('topbar'), ctx, {
        toggleResearch: () => this.toggleResearch(),
        toggleMenu: () => this.menu.toggle(),
      }),
      createFleetPanel(mk('fleet'), ctx),
      createContractsPanel(mk('contracts'), ctx),
      createShipPanel(mk('ship'), ctx),
      createRefineryPanel(mk('refinery'), ctx),
    ];
    this.log.id = 'log';
    root.append(this.log);
    this.research = new ResearchPanel(mk('research', 'modal hidden'), ctx);

    this.help = mk('help');

    this.menu = new Menu(root, actions.saves, settings);
    root.append(this.tooltip, this.flash, this.paused, this.hazard, this.fps);
    settings.onChange(() => this.applySettings());
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings.value;
    this.root.style.setProperty('--hud-scale', String(s.hudScale));
    this.help.classList.toggle('hidden', !s.showHelp);
    // Help text follows the current key bindings.
    const k = (a: keyof typeof s.keys): string => s.keys[a].filter(Boolean).map(keyLabel).join('/') || 'unbound';
    this.help.innerHTML = `
      <b>Flight</b> ${k('up')} ${k('left')} ${k('down')} ${k('right')} · click space to move<br>
      <b>Mine</b> click an asteroid (laser auto-chains fragments)<br>
      <b>Collect</b> fly near debris · <b>Unload</b> click the station<br>
      <b>Fleet</b> click a ship, ${k('cycleShip')} or 1–9 to select · Esc stops<br>
      <b>View</b> wheel zoom · drag to pan · ${k('follow')} follow · ${k('map')} map<br>
      <b>Menus</b> ${k('research')} research · ${k('pause')} pause · ${k('help')} hide help · ⚙ saves & settings`;
    this.fps.classList.toggle('hidden', !s.showFps);
  }

  /** Shows the pause banner with the reason (manual, menu, unfocused). */
  setPaused(reason: string | null): void {
    this.paused.classList.toggle('hidden', !reason);
    if (reason) setText(this.paused, reason);
  }

  /** Called every rendered frame to update the FPS counter. */
  frame(dt: number): void {
    if (!this.settings.value.showFps) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    this.fpsWorst = Math.max(this.fpsWorst, dt);
    if (this.fpsTime >= 0.5) {
      setText(
        this.fps,
        `${Math.round(this.fpsFrames / this.fpsTime)} fps · worst ${(this.fpsWorst * 1000).toFixed(0)} ms`,
      );
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.fpsWorst = 0;
    }
  }

  /** Esc: close the topmost open overlay. Returns true if something closed. */
  escape(): boolean {
    if (this.menu.escape()) return true;
    if (this.research.open) {
      this.toggleResearch(false);
      return true;
    }
    return false;
  }

  get researchOpen(): boolean {
    return this.research.open;
  }

  toggleResearch(force?: boolean): void {
    this.research.toggle(force);
  }

  refresh(warpFlash: number): void {
    const state = this.getState();
    for (const line of state.out.log.splice(0)) this.pushLog(line);
    for (const p of this.panels) p.refresh();
    this.research.refresh();
    const banner = hazardBanner(state.run);
    this.hazard.classList.toggle('hidden', !banner);
    this.hazard.classList.toggle('active', state.run.hazards.flare?.phase === 'active');
    if (banner) setText(this.hazard, banner);
    this.flash.style.opacity = warpFlash.toFixed(3);
  }

  private pushLog(entry: LogEntry): void {
    if (entry.level === 'info' && this.settings.value.logVerbosity === 'important') return;
    const row = h('div', { class: entry.level, text: entry.level === 'warn' ? `⚠ ${entry.text}` : entry.text });
    this.log.prepend(row);
    while (this.log.childElementCount > MAX_LOG) this.log.lastElementChild?.remove();
  }

  showTooltip(x: number, y: number, rock: Rock | null, label: string | null): void {
    if (!rock && !label) {
      this.tooltip.style.display = 'none';
      return;
    }
    const text = rock
      ? `${['Large', 'Medium', 'Small'][rock.size]} ${RESOURCE_INFO[rock.kind].name.toLowerCase()} asteroid · ${rock.units} units · ${Math.max(0, Math.ceil((rock.hp / rock.maxHp) * 100))}%`
      : label!;
    setText(this.tooltip, text);
    this.tooltip.style.display = 'block';
    this.tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  }
}
