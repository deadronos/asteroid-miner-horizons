// Gear menu: a tabbed modal shell. Each tab renders from its own module in
// ./menu/; this file owns only the modal, tab switching, the text-window
// overlay slot and Esc handling.

import type { SaveActions } from '../session';
import type { SettingsStore } from '../settings';
import type { GameState } from '../sim/types';
import { h } from './dom';
import { FOCUSABLE, nextFocusIndex } from './focus';
import { renderAudio } from './menu/AudioTab';
import type { MenuCtx } from './menu/context';
import { ControlsTab } from './menu/ControlsTab';
import { SavesTab } from './menu/SavesTab';
import { renderGameplay, renderGraphics, renderInterface } from './menu/SettingsTabs';
import { renderStats } from './menu/StatsTab';

type Tab = 'saves' | 'stats' | 'gameplay' | 'graphics' | 'interface' | 'controls' | 'audio';

const TABS: [Tab, string][] = [
  ['saves', 'Saves'],
  ['stats', 'Stats'],
  ['gameplay', 'Gameplay'],
  ['graphics', 'Graphics'],
  ['interface', 'Interface'],
  ['controls', 'Controls'],
  ['audio', 'Audio'],
];

/** Focusable controls inside `root`, in DOM order, skipping hidden/disabled nodes. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hidden && el.getClientRects().length > 0,
  );
}

/** The element to return focus to: whatever opened the menu, else the gear button. */
function openerOf(modal: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && active !== modal) return active;
  return document.querySelector<HTMLElement>('button.gear');
}

export const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.7 7.7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

export class Menu {
  readonly el: HTMLElement;
  private box: HTMLElement;
  private body = h('div', { class: 'tab-body' });
  private tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'saves';
  private overlay: HTMLElement | null = null;
  private render: Record<Tab, () => Node[]>;
  private controls: ControlsTab;
  private returnTo: HTMLElement | null = null;

  constructor(root: HTMLElement, saves: SaveActions, settings: SettingsStore, getState: () => GameState) {
    const ctx: MenuCtx = {
      settings,
      rerender: () => this.rerender(),
      close: () => this.toggle(false),
      showOverlay: (el) => this.showOverlay(el),
      closeOverlay: () => this.closeOverlay(),
    };
    const savesTab = new SavesTab(saves, ctx);
    this.controls = new ControlsTab(ctx);
    this.render = {
      saves: () => savesTab.render(),
      stats: () => renderStats(getState().profile),
      gameplay: () => renderGameplay(settings),
      graphics: () => renderGraphics(settings),
      interface: () => renderInterface(settings),
      controls: () => this.controls.render(),
      audio: () => renderAudio(settings),
    };

    const tabBar = h('div', { class: 'tabs' });
    for (const [id, label] of TABS) {
      const b = h('button', { class: 'tab', text: label, onclick: () => this.show(id) });
      this.tabs.set(id, b);
      tabBar.append(b);
    }
    const close = h('button', { class: 'icon', text: '✕', title: 'Close (Esc)', onclick: () => this.toggle(false) });
    close.setAttribute('aria-label', 'Close menu');
    const title = h('h2', { class: 'sr-only', text: 'Menu' });
    title.id = 'menu-title';
    this.box = h(
      'div',
      { class: 'hud box menu' },
      title,
      h('div', { class: 'menu-head' }, tabBar, close),
      this.body,
      savesTab.fileInput,
    );
    this.el = h('div', { class: 'modal hidden' }, this.box);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', title.id);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.toggle(false);
    });
    // Listen on the window: a tab switch or rerender can drop focus to <body>,
    // which must not let Tab escape into the page behind the dialog.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.open) return;
      const items = focusables(this.el);
      const next =
        items[nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)];
      e.preventDefault();
      next?.focus();
    });
    root.append(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    const open = force ?? !this.open;
    const wasOpen = this.open;
    if (open && !wasOpen) this.returnTo = openerOf(this.el);
    this.el.classList.toggle('hidden', !open);
    if (open) {
      this.show(this.tab);
      // Move focus into the dialog: the active tab button matches what is on screen.
      this.tabs.get(this.tab)?.focus();
    } else {
      this.closeOverlay();
      this.controls.cancel();
      if (wasOpen) this.restoreFocus();
    }
  }

  /** Returns focus to the opener, falling back to the gear button if it is gone. */
  private restoreFocus(): void {
    const target = this.returnTo?.isConnected ? this.returnTo : document.querySelector<HTMLElement>('button.gear');
    this.returnTo = null;
    target?.focus();
  }

  /** Opens the menu on the Saves tab. */
  openSaves(): void {
    this.toggle(true);
    this.show('saves');
    this.tabs.get('saves')?.focus();
  }

  /** Esc handling: close a text window first, then the menu. Returns true if it consumed the key. */
  escape(): boolean {
    if (this.overlay) {
      this.closeOverlay();
      return true;
    }
    if (this.open) {
      this.toggle(false);
      return true;
    }
    return false;
  }

  private show(tab: Tab): void {
    this.tab = tab;
    this.controls.cancel();
    for (const [id, b] of this.tabs) b.classList.toggle('active', id === tab);
    this.closeOverlay();
    this.body.replaceChildren(...this.render[tab]());
  }

  private rerender(): void {
    if (this.open) this.show(this.tab);
  }

  private showOverlay(el: HTMLElement): void {
    this.closeOverlay();
    this.overlay = el;
    this.box.append(el);
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
