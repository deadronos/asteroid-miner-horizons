// DOM HUD composer: places the panels (top bar, fleet, contracts, selected
// ship, refinery, research, warp routes, first-steps goals) and owns the small overlays — event log, help, hover
// tooltip, warp flash, pause banner, toasts (achievements, offline summary) and FPS counter. All actions go out as sim
// Commands via `send`. The side panels sit in two flex columns that share the window height, and each can be
// collapsed (#161).

import { ACHIEVEMENTS } from '../data/achievements';
import type { SaveActions } from '../session';
import type { Command } from '../sim/commands';
import { type HudPanelId, type SettingsStore, keyLabel } from '../settings';
import type { GameState, LogEntry, Outpost, Rock } from '../sim/types';
import { type Panel, h, setText } from './dom';
import { hazardBanner } from './hazardBanner';
import { helpVisible, isCollapsed, toggledCollapse } from './hudLayout';
import { Menu } from './Menu';
import type { PanelCtx } from './panels/context';
import { createContractsPanel } from './panels/ContractsPanel';
import { createFleetPanel } from './panels/FleetPanel';
import { createGoalsPanel } from './panels/GoalsPanel';
import { createRefineryPanel } from './panels/RefineryPanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { createShipPanel } from './panels/ShipPanel';
import { createTopBar } from './panels/TopBar';
import { WarpPanel } from './panels/WarpPanel';
import { rockTooltip } from './rockTooltip';
import { placeTooltip } from './tooltipPlacement';

const MAX_LOG = 60;
/** How long a toast stays up, in ms. */
const TOAST_MS = 6000;

export interface HudActions {
  send: (cmd: Command) => void;
  saves: SaveActions;
}

/** A button on a `showNotice` banner. */
export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export class Hud {
  readonly root: HTMLElement;
  private getState: () => GameState;
  private panels: Panel[];
  private research: ResearchPanel;
  private routes: WarpPanel;
  private log = h('div', { class: 'hud' }) as HTMLElement;
  private tooltip = h('div', { class: 'tooltip' });
  /** Tooltip size, re-measured only when its text changes so hovering does not force a layout every frame. */
  private tipSize = { text: '', w: 0, h: 0 };
  private flash = h('div', { class: 'flash' });
  private help: HTMLElement;
  /** Collapsible panel containers and their toggle buttons. */
  private collapsibles: { id: HudPanelId; el: HTMLElement; btn: HTMLButtonElement }[] = [];
  private paused = h('div', { class: 'paused hidden' });
  private hazard = h('div', { class: 'hazard hidden' });
  private fps = h('div', { class: 'fps hidden' });
  private toasts = h('div', { class: 'toasts' });
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsWorst = 0;
  /** Set by showNotice; while true, setPaused no longer changes the banner. */
  private noticeShown = false;
  readonly menu: Menu;

  constructor(
    root: HTMLElement,
    getState: () => GameState,
    actions: HudActions,
    private readonly settings: SettingsStore,
  ) {
    this.root = root;
    this.getState = getState;
    const mk = (id: string, cls = 'hud', parent: HTMLElement = root): HTMLElement => {
      const e = h('div', { class: cls });
      e.id = id;
      parent.append(e);
      return e;
    };
    const left = h('div', { class: 'hud-col left' });
    const right = h('div', { class: 'hud-col right' });
    // A collapsible panel: a fixed toggle button over a body that the panel fills and that scrolls on its own.
    const fold = (id: HudPanelId, parent: HTMLElement): HTMLElement => {
      const el = mk(id, 'hud collapsible', parent);
      const btn = h('button', {
        class: 'collapse',
        onclick: () => {
          const prefs = toggledCollapse(id, settings.value.hudCollapsed, getState());
          settings.set({ hudCollapsed: prefs });
          this.applyCollapse();
        },
      });
      const body = h('div', { class: 'body' });
      el.append(btn, body);
      this.collapsibles.push({ id, el, btn });
      return body;
    };
    const topbar = mk('topbar');
    root.append(left, right);
    const ctx: PanelCtx = { getState, send: actions.send, settings };
    this.panels = [
      createTopBar(topbar, ctx, {
        toggleResearch: () => this.toggleResearch(),
        openWarp: () => this.toggleWarp(true),
        toggleMenu: () => this.menu.toggle(),
        toggleHelp: () => this.toggleHelp(),
        helpVisible: () => this.helpShown(),
      }),
      createFleetPanel(fold('fleet', left), ctx),
      createContractsPanel(fold('contracts', left), ctx),
      createShipPanel(fold('ship', right), ctx),
      createRefineryPanel(fold('refinery', right), ctx),
      createGoalsPanel(mk('goals', 'hud hidden'), ctx),
    ];
    this.log.id = 'log';
    left.append(this.log);
    this.research = new ResearchPanel(mk('research', 'modal hidden'), ctx);
    this.routes = new WarpPanel(mk('routes', 'modal hidden'), ctx);

    this.help = mk('help');

    this.menu = new Menu(root, actions.saves, settings, getState);
    root.append(this.tooltip, this.flash, this.paused, this.hazard, this.fps, this.toasts);
    settings.onChange(() => this.applySettings());
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings.value;
    this.root.style.setProperty('--hud-scale', String(s.hudScale));
    this.root.classList.toggle('compact', s.hudCompact);
    this.applyHelp();
    // Help text follows the current key bindings.
    const k = (a: keyof typeof s.keys): string => s.keys[a].filter(Boolean).map(keyLabel).join('/') || 'unbound';
    this.help.innerHTML = `
      <b>Flight</b> ${k('up')} ${k('left')} ${k('down')} ${k('right')} · click space to move<br>
      <b>Mine</b> click an asteroid (laser auto-chains fragments)<br>
      <b>Collect</b> fly near debris · <b>Unload</b> click the station<br>
      <b>Fleet</b> click a ship, ${k('cycleShip')} or 1–9 to select · Esc stops<br>
      <b>Automation</b> ${k('outpost')} over a large asteroid deploys an outpost · haulers collect from it<br>
      <b>View</b> wheel zoom · drag to pan · ${k('follow')} follow · ${k('map')} map<br>
      <b>Menus</b> ${k('research')} research · ${k('pause')} pause · ${k('help')} hide help · ⚙ saves & settings`;
    this.fps.classList.toggle('hidden', !s.showFps);
  }

  /** Shows or hides the help box for the help mode and lifetime play time. */
  private applyHelp(): void {
    const mode = this.settings.value.help;
    this.help.classList.toggle('hidden', !helpVisible(mode, this.getState().profile.stats.time));
    this.help.classList.toggle('auto', mode === 'auto');
  }

  /** Marks each side panel collapsed or open, and labels its button to match. */
  private applyCollapse(): void {
    const state = this.getState();
    for (const { id, el, btn } of this.collapsibles) {
      const folded = isCollapsed(id, this.settings.value.hudCollapsed, state);
      if (el.classList.contains('collapsed') === folded && btn.textContent) continue;
      el.classList.toggle('collapsed', folded);
      btn.textContent = folded ? '+' : '−';
      btn.title = folded ? 'Expand' : 'Collapse';
      btn.setAttribute('aria-label', `${folded ? 'Expand' : 'Collapse'} ${id}`);
      btn.setAttribute('aria-expanded', String(!folded));
    }
  }

  /** Whether the help box is on screen; CSS also hides auto help in narrow windows. */
  private helpShown(): boolean {
    return this.help.getClientRects().length > 0;
  }

  /** The `?` button and help key: hide the help box if shown, otherwise show it until hidden again. */
  toggleHelp(): void {
    this.settings.set({ help: this.helpShown() ? 'off' : 'on' });
  }

  /** Shows the pause banner with the reason (manual, menu, unfocused). */
  setPaused(reason: string | null): void {
    if (this.noticeShown) return;
    this.paused.classList.toggle('hidden', !reason);
    if (reason) setText(this.paused, reason);
  }

  /**
   * Shows `text` in the banner until `clearNotice`, replacing the pause reason. With actions, the banner also
   * gets a button for each; only the buttons take pointer events.
   */
  showNotice(text: string, actions: NoticeAction | NoticeAction[] = []): void {
    const list = Array.isArray(actions) ? actions : [actions];
    this.noticeShown = true;
    this.paused.classList.remove('hidden');
    this.paused.classList.add('gfx-reset');
    this.paused.classList.toggle('actionable', list.length > 0);
    if (list.length > 0) this.paused.setAttribute('role', 'alert');
    else this.paused.removeAttribute('role');
    if (list.length > 0)
      this.paused.replaceChildren(text, ...list.map((a) => h('button', { text: a.label, onclick: a.onClick })));
    else setText(this.paused, text);
    // The frame loop may have stopped, so a warp flash would otherwise stay frozen over the notice.
    this.flash.style.opacity = '0';
  }

  /** Takes down a `showNotice` banner, handing it back to the pause reason. */
  clearNotice(): void {
    if (!this.noticeShown) return;
    this.noticeShown = false;
    this.paused.classList.remove('gfx-reset', 'actionable');
    this.paused.removeAttribute('role');
    this.paused.replaceChildren();
    this.paused.classList.add('hidden');
  }

  /** Per-frame HUD work: the warp white-out (which needs every frame to look smooth) and the FPS counter. */
  frame(dt: number, warpFlash: number): void {
    const opacity = warpFlash.toFixed(3);
    if (this.flash.style.opacity !== opacity) this.flash.style.opacity = opacity;
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

  /** Client rectangles of the visible HUD panels and banners, which map labels keep clear of. */
  blockerRects(): { x: number; y: number; w: number; h: number }[] {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const e of this.root.querySelectorAll(
      ':scope > .hud, :scope > .hud-col > .hud, :scope > .paused, :scope > .hazard',
    )) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  /** Esc: close the topmost open overlay. Returns true if something closed. */
  escape(): boolean {
    if (this.menu.escape()) return true;
    if (this.research.open) {
      this.toggleResearch(false);
      return true;
    }
    if (this.routes.open) {
      this.toggleWarp(false);
      return true;
    }
    return false;
  }

  get warpOpen(): boolean {
    return this.routes.open;
  }

  toggleWarp(force?: boolean): void {
    this.routes.toggle(force);
  }

  get researchOpen(): boolean {
    return this.research.open;
  }

  toggleResearch(force?: boolean): void {
    this.research.toggle(force);
  }

  refresh(): void {
    const state = this.getState();
    for (const line of state.out.log.splice(0)) this.pushLog(line);
    this.applyHelp();
    for (const p of this.panels) p.refresh();
    this.applyCollapse();
    this.research.refresh();
    this.routes.refresh();
    const banner = hazardBanner(state.run);
    this.hazard.classList.toggle('hidden', !banner);
    this.hazard.classList.toggle('active', state.run.hazards.flare?.phase === 'active');
    if (banner) setText(this.hazard, banner);
  }

  private pushLog(entry: LogEntry): void {
    if (entry.achievement) {
      const a = ACHIEVEMENTS[entry.achievement];
      this.toast('Achievement unlocked', a.name, a.desc);
    }
    if (entry.toast) this.toast(entry.toast.kicker, entry.toast.title, entry.toast.detail);
    if (entry.level === 'info' && this.settings.value.logVerbosity === 'important') return;
    const row = h('div', { class: entry.level, text: entry.level === 'warn' ? `⚠ ${entry.text}` : entry.text });
    this.log.prepend(row);
    while (this.log.childElementCount > MAX_LOG) this.log.lastElementChild?.remove();
  }

  private toast(kicker: string, title: string, detail: string): void {
    const el = h(
      'div',
      { class: 'toast' },
      h('small', { text: kicker }),
      h('b', { text: title }),
      h('span', { class: 'dim', text: detail }),
    );
    this.toasts.append(el);
    setTimeout(() => el.remove(), TOAST_MS);
  }

  showTooltip(x: number, y: number, rock: Rock | null, label: string | null, outpost?: Outpost): void {
    if (!rock && !label) {
      this.tooltip.style.display = 'none';
      return;
    }
    const key = this.settings.value.keys.outpost.find(Boolean);
    const text = rock ? rockTooltip(rock, outpost, key ? keyLabel(key) : undefined) : label!;
    setText(this.tooltip, text);
    this.tooltip.style.display = 'block';
    const size = this.tipSize;
    if (size.text !== text) {
      size.text = text;
      size.w = this.tooltip.offsetWidth;
      size.h = this.tooltip.offsetHeight;
    }
    const pos = placeTooltip({
      x,
      y,
      tooltipW: size.w,
      tooltipH: size.h,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });
    this.tooltip.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
}
