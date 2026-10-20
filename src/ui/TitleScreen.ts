// The boot title screen covers the canvas while the renderer warms up, freezes
// the sim through the manual-pause path, and hands control to the already-loaded
// session, a fresh run or the gear menu.

import { formatDuration } from '../core/format';
import type { SaveActions } from '../session';
import { slotStatus } from '../sim/save';
import type { GameState } from '../sim/types';
import type { SettingsStore } from '../settings';
import { nextFocusIndex } from './focus';

export interface TitleActions {
  openSettings(): void;
}

/** One-line save summary for the boot screen. */
export function titleSummary(state: GameState, slot: number): string {
  return `Slot ${slot + 1} · System ${state.run.system.number} · ${formatDuration(state.run.time, { seconds: true })}`;
}

/** A node that must be in the static boot markup; a missing one is a programmer error. */
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Boot screen is missing #${id}`);
  return el as T;
}

export class TitleScreen {
  private readonly el = byId<HTMLElement>('boot');
  private readonly summary = byId<HTMLElement>('boot-summary');
  private readonly continueBtn = byId<HTMLButtonElement>('boot-continue');
  private readonly newBtn = byId<HTMLButtonElement>('boot-new');
  private readonly settingsBtn = byId<HTMLButtonElement>('boot-settings');

  constructor(
    private readonly saves: SaveActions,
    private readonly settings: SettingsStore,
    actions: TitleActions,
  ) {
    const active = saves.active();
    const readable = slotStatus(active).kind === 'ok';
    this.summary.textContent = readable ? titleSummary(saves.current(), active) : 'Start a new mining run.';
    this.continueBtn.hidden = !readable;
    this.setPrimary(readable ? this.continueBtn : this.newBtn);

    this.continueBtn.addEventListener('click', () => this.dismiss());
    this.newBtn.addEventListener('click', () => {
      // The active slot may have changed under the title; only start a new game when it still holds a readable save.
      const slot = saves.active();
      if (slotStatus(slot).kind === 'ok') {
        if (
          !settings.value.confirmDestructive ||
          confirm(`Start a new game in slot ${slot + 1}? Its progress, including research, will be erased.`)
        )
          saves.newGame(slot);
      }
      this.dismiss();
    });
    this.settingsBtn.addEventListener('click', () => actions.openSettings());

    (readable ? this.continueBtn : this.newBtn).focus();
    this.el.addEventListener('keydown', (e) => {
      // The gear menu's trap (a window listener) runs first when it is open, so it owns Tab then.
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const buttons = [this.continueBtn, this.newBtn, this.settingsBtn].filter((b) => !b.hidden);
      if (buttons.length === 0) return;
      const next =
        buttons[
          nextFocusIndex(buttons.length, buttons.indexOf(document.activeElement as HTMLButtonElement), e.shiftKey)
        ];
      e.preventDefault();
      next.focus();
    });
  }

  /** Move the `.boot-primary` emphasis onto the visible default action. */
  private setPrimary(btn: HTMLButtonElement): void {
    for (const b of [this.continueBtn, this.newBtn]) b.classList.toggle('boot-primary', b === btn);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Hide the boot screen. Idempotent; the gear menu lives inside `#app`, so `#app` is never made inert. */
  dismiss(): void {
    this.el.hidden = true;
  }
}
