// DOM HUD composer: places the panels (top bar, fleet, contracts, selected
// ship, refinery, research, warp routes, first-steps goals) and owns the small overlays — event log, help, hover
// tooltip, warp flash, pause banner, toasts (achievements, offline summary), FPS counter and the touch controls. All
// actions go out as sim Commands via `send`. The side panels sit in two flex columns that share the window height,
// and each can be collapsed (#161); on a narrow (phone) screen they start folded and open one at a time (#194).

import { ACHIEVEMENTS } from '../data/achievements';
import type { SaveActions } from '../session';
import type { Command } from '../sim/commands';
import { type HudPanelId, type SettingsStore, keyLabel } from '../settings';
import type { GameState, LogEntry, Outpost, Rock } from '../sim/types';
import { type Panel, h, setText } from './dom';
import { closeConfirm, confirmOpen } from './confirm';
import type { InputMode } from './goals';
import { hazardBanner } from './hazardBanner';
import { PALETTES } from '../data/palette';
import { applyPaletteVars } from './paletteVars';
import { helpVisible, isCollapsed, toggledCollapse, touchControlsShown } from './hudLayout';
import { closeTopModal } from './modalKey';
import { Menu } from './Menu';
import type { PanelCtx } from './panels/context';
import { createContractsPanel } from './panels/ContractsPanel';
import { createFleetPanel } from './panels/FleetPanel';
import { createGoalsPanel } from './panels/GoalsPanel';
import { createRefineryPanel } from './panels/RefineryPanel';
import { GateDialog } from './panels/GateDialog';
import { ResearchPanel } from './panels/ResearchPanel';
import { createShipPanel } from './panels/ShipPanel';
import { createTopBar } from './panels/TopBar';
import { WarpPanel } from './panels/WarpPanel';
import { rockTooltip } from './rockTooltip';
import { placeTooltip } from './tooltipPlacement';
import { TouchControls } from './TouchControls';

const MAX_LOG = 60;
/** How long a toast stays up, in ms. */
const TOAST_MS = 6000;
/** A phone-sized screen, in either orientation; style.css uses the same query for the phone layout. */
const NARROW_QUERY = '(max-width: 640px), (max-height: 500px)';
/** Width below which CSS hides `#help.auto`; cached here so `helpShown()` never forces layout. */
const AUTO_HELP_HIDDEN_QUERY = '(max-width: 1199px)';

/** A live media query, or null where `matchMedia` is missing; `onChange` runs on every change. */
function watchMedia(query: string, onChange: () => void): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null;
  const mq = window.matchMedia(query);
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
  return mq;
}

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
  private gate: GateDialog;
  private routes: WarpPanel;
  private log = h('div', { class: 'hud' }) as HTMLElement;
  private tooltip = h('div', { class: 'tooltip' });
  /** Tooltip size, re-measured only when its text changes so hovering does not force a layout every frame. */
  private tipSize = { text: '', w: 0, h: 0 };
  private flash = h('div', { class: 'flash' });
  private help: HTMLElement;
  /** Collapsible panel containers, toggle buttons and panels. */
  private collapsibles: { id: HudPanelId; el: HTMLElement; btn: HTMLButtonElement; panel: Panel }[] = [];
  /** Panels currently folded away; their `refresh()` is skipped once their heading has been built. */
  private collapsedPanels = new Set<Panel>();
  private paused = h('div', { class: 'paused hidden' });
  private hazard = h('div', { class: 'hazard hidden' });
  private fps = h('div', { class: 'fps hidden' });
  private toasts = h('div', { class: 'toasts' });
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsWorst = 0;
  /** Set by showNotice; while true, setPaused no longer changes the banner. */
  private noticeShown = false;
  /** Cached visibility of `#help`, updated in `applyHelp()` and on media-query changes. */
  private isHelpVisible = false;
  /** True while a standard-mapping gamepad is connected, so panels adapt copy. */
  private gamepad = false;
  readonly menu: Menu;
  readonly touch: TouchControls;
  private narrowMq: MediaQueryList | null;
  private coarseMq: MediaQueryList | null;
  private autoHelpHiddenMq: MediaQueryList | null;

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
    const stack = h('div', { class: 'hud-stack' });
    // A collapsible panel: a fixed toggle button over a body that the panel fills and that scrolls on its own.
    const fold = (id: HudPanelId, parent: HTMLElement, build: (body: HTMLElement) => Panel): Panel => {
      const el = mk(id, 'hud collapsible', parent);
      const btn = h('button', {
        class: 'collapse',
        onclick: () => {
          const prefs = toggledCollapse(id, settings.value.hudCollapsed, getState(), this.narrow);
          settings.set({ hudCollapsed: prefs });
          this.applyCollapse(true);
        },
      });
      const body = h('div', { class: 'body' });
      el.append(btn, body);
      const panel = build(body);
      this.collapsibles.push({ id, el, btn, panel });
      return panel;
    };
    const topbar = mk('topbar');
    root.append(left, right, stack);
    const ctx: PanelCtx = { getState, send: actions.send, settings, inputMode: () => this.inputMode() };
    this.paused.setAttribute('role', 'status');
    this.paused.setAttribute('aria-live', 'polite');
    this.hazard.setAttribute('role', 'alert');
    this.hazard.setAttribute('aria-live', 'assertive');
    this.toasts.setAttribute('role', 'status');
    this.toasts.setAttribute('aria-live', 'polite');
    stack.append(this.paused, this.hazard, this.toasts);
    this.panels = [
      createTopBar(topbar, ctx, {
        toggleResearch: () => this.toggleResearch(),
        openWarp: () => this.toggleWarp(true),
        toggleMenu: () => this.menu.toggle(),
        toggleHelp: () => this.toggleHelp(),
        helpVisible: () => this.helpShown(),
      }),
      fold('fleet', left, (body) => createFleetPanel(body, ctx)),
      fold('contracts', left, (body) => createContractsPanel(body, ctx)),
      fold('ship', right, (body) => createShipPanel(body, ctx)),
      fold('refinery', right, (body) => createRefineryPanel(body, ctx)),
      createGoalsPanel(mk('goals', 'hud hidden', stack), ctx),
    ];
    this.log.id = 'log';
    this.log.setAttribute('role', 'status');
    this.log.setAttribute('aria-live', 'polite');
    left.append(this.log);
    this.research = new ResearchPanel(mk('research', 'modal hidden'), ctx);
    this.gate = new GateDialog(mk('gate', 'modal hidden'), ctx);
    this.routes = new WarpPanel(mk('routes', 'modal hidden'), ctx);

    this.help = mk('help');

    this.touch = new TouchControls(root);
    this.menu = new Menu(root, actions.saves, settings, getState);
    root.append(this.tooltip, this.flash, this.fps);
    // The side columns start below the top bar, which wraps onto more lines on a phone.
    if (typeof ResizeObserver === 'function')
      new ResizeObserver(() =>
        root.style.setProperty('--topbar-bottom', `${Math.ceil(topbar.getBoundingClientRect().bottom)}px`),
      ).observe(topbar);
    this.narrowMq = watchMedia(NARROW_QUERY, () => this.applySettings());
    this.coarseMq = watchMedia('(pointer: coarse)', () => this.applySettings());
    this.autoHelpHiddenMq = watchMedia(AUTO_HELP_HIDDEN_QUERY, () => this.applyHelp());
    settings.onChange(() => this.applySettings());
    this.applySettings();
  }

  /** Whether the screen is phone-sized, so the side panels start folded and open one at a time. */
  get narrow(): boolean {
    return !!this.narrowMq?.matches;
  }

  private applySettings(): void {
    const s = this.settings.value;
    this.root.style.setProperty('--hud-scale', String(s.hudScale));
    this.root.classList.toggle('compact', s.hudCompact);
    applyPaletteVars(this.root, PALETTES[s.colourVision]);
    const touch = touchControlsShown(s.touchControls, !!this.coarseMq?.matches);
    this.touch.setShown(touch);
    this.root.classList.toggle('touch', touch);
    this.applyHelp();
    this.applyCollapse();
    // Help text follows the current key bindings, or describes the touch controls while they show.
    const k = (a: keyof typeof s.keys): string => s.keys[a].filter(Boolean).map(keyLabel).join('/') || 'unbound';
    this.help.innerHTML = touch
      ? `
      <b>Flight</b> thrust stick · tap space to move<br>
      <b>Mine</b> tap an asteroid · <b>Unload</b> tap the station<br>
      <b>Fleet</b> tap a ship or Ship ▸ to select · long-press orders without selecting<br>
      <b>Automation</b> Outpost, then tap a large asteroid<br>
      <b>View</b> pinch zoom · drag to pan · Follow · Map · Ping<br>
      <b>Menus</b> Research and the Horizon Gate · Pause · ? hides help · ⚙ saves & settings`
      : `
      <b>Flight</b> ${k('up')} ${k('left')} ${k('down')} ${k('right')} · click space to move<br>
      <b>Mine</b> click an asteroid (laser auto-chains fragments)<br>
      <b>Collect</b> fly near debris · <b>Unload</b> click the station<br>
      <b>Fleet</b> click a ship, ${k('cycleShip')} or 1–9 to select · Esc stops<br>
      <b>Automation</b> ${k('outpost')} over a large asteroid deploys an outpost · haulers collect from it<br>
      <b>Sensors</b> ${k('ping')} ping · reveals nearby rich deposits and derelicts<br>
      <b>View</b> wheel zoom · drag to pan · ${k('follow')} follow · ${k('map')} map<br>
      <b>Menus</b> ${k('research')} research and the Horizon Gate · ${k('pause')} pause · ${k('help')} hide help · ⚙ saves & settings`;
    this.fps.classList.toggle('hidden', !s.showFps);
  }

  /** Shows or hides the help box for the help mode and lifetime play time. */
  private applyHelp(): void {
    const mode = this.settings.value.help;
    const shown = helpVisible(mode, this.getState().profile.stats.time);
    this.help.classList.toggle('hidden', !shown);
    this.help.classList.toggle('auto', mode === 'auto');
    this.isHelpVisible = shown && !(mode === 'auto' && !!this.autoHelpHiddenMq?.matches);
  }

  /** Marks each side panel collapsed or open, and labels its button to match. */
  private applyCollapse(refreshExpanded = false): void {
    const state = this.getState();
    for (const { id, el, btn, panel } of this.collapsibles) {
      const folded = isCollapsed(id, this.settings.value.hudCollapsed, state, this.narrow);
      if (folded) this.collapsedPanels.add(panel);
      else this.collapsedPanels.delete(panel);
      const changed = el.classList.contains('collapsed') !== folded;
      if (!changed && btn.textContent) continue;
      el.classList.toggle('collapsed', folded);
      btn.textContent = folded ? '+' : '−';
      btn.title = folded ? 'Expand' : 'Collapse';
      btn.setAttribute('aria-label', `${folded ? 'Expand' : 'Collapse'} ${id}`);
      btn.setAttribute('aria-expanded', String(!folded));
      if (refreshExpanded && changed && !folded && panel.built) panel.refresh();
    }
  }

  /** Whether the help box is on screen; CSS also hides auto help in narrow windows. */
  private helpShown(): boolean {
    return this.isHelpVisible;
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
    const urgent = list.length > 0;
    this.paused.classList.toggle('actionable', urgent);
    this.paused.setAttribute('role', urgent ? 'alert' : 'status');
    this.paused.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    if (urgent)
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
    this.paused.setAttribute('role', 'status');
    this.paused.setAttribute('aria-live', 'polite');
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
      ':scope > .hud, :scope > .hud-col > .hud, :scope > .hud-stack > .hud, :scope > .hud-stack > .paused, :scope > .hud-stack > .hazard, :scope > .touch-ctl > *',
    )) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  /** Updates whether a gamepad is connected so panels can adapt input-specific hints. */
  setGamepad(on: boolean): void {
    this.gamepad = on;
  }

  /** Active input mode: gamepad when connected, else touch when on-screen controls show, else pointer. */
  inputMode(): InputMode {
    if (this.gamepad) return 'gamepad';
    if (this.touch.shown) return 'touch';
    return 'pointer';
  }

  /** Esc: close the topmost open overlay. Returns true if something closed. */
  escape(): boolean {
    if (closeConfirm()) return true;
    if (this.menu.escape()) return true;
    // The gate, Research and the warp picker can stack in any order, so close whichever is on top;
    // the gate's own dismiss is its "Keep playing" button.
    return closeTopModal([
      { el: this.gate.el, close: () => this.gate.dismiss() },
      { el: this.research.el, close: () => this.research.toggle(false) },
      { el: this.routes.el, close: () => this.routes.toggle(false) },
    ]);
  }

  /** Whether any modal dialog (confirmation, menu, gate, research, or warp picker) is currently open. */
  hasModalOpen(): boolean {
    return confirmOpen() || this.menu.open || this.gate.open || this.routes.open || this.research.open;
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

  get gateOpen(): boolean {
    return this.gate.open;
  }

  toggleResearch(force?: boolean): void {
    this.research.toggle(force);
  }

  refresh(): void {
    const state = this.getState();
    for (const line of state.out.log.splice(0)) this.pushLog(line);
    this.applyHelp();
    this.applyCollapse();
    for (const p of this.panels) {
      if (!p.built || !this.collapsedPanels.has(p)) p.refresh();
      else p.refreshHeader();
    }
    this.research.refresh();
    this.gate.refresh();
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
