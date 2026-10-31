// Run summary shown when the Horizon Gate opens. Keyboard and gamepad use the
// same focusable buttons as the other modals. Closing it acknowledges the
// summary; New Game+ starts the next run.

import { NG_PLUS_RULE } from '../../data/gate';
import { Panel, h } from '../dom';
import { FOCUSABLE } from '../focus';
import { summaryRows } from '../gateView';
import { previousFocus, trapModalTab } from '../modalKey';
import type { PanelCtx } from './context';

export class GateDialog {
  private panel: Panel;
  /** True after the player closes it, until the summary itself goes away. */
  private locallyClosed = false;
  private returnTo: HTMLElement | null = null;

  constructor(
    readonly el: HTMLElement,
    private readonly ctx: PanelCtx,
  ) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'gate-title');
    const st = ctx.getState;
    this.panel = new Panel(
      el,
      () => {
        const summary = st().profile.gate.summary;
        return summary ? `${summary.warps}|${summary.time}|${summary.doctrines.fleet}` : 'closed';
      },
      (bind) => {
        const title = h('h2', { text: 'Horizon Gate open' });
        title.id = 'gate-title';
        const lead = h('p', {
          text: 'This run reached the gate. Warps, Horizon Data and doctrines are this run. Time, rocks, units, contracts and refined are career totals, which include earlier runs.',
        });
        const list = h('dl');
        const rule = h('p', { class: 'dim', text: NG_PLUS_RULE });
        const again = h('button', {
          text: 'New Game+',
          onclick: () => {
            this.locallyClosed = true;
            this.toggle(false);
            ctx.send({ t: 'newGamePlus' });
          },
        });
        again.type = 'button';
        again.setAttribute('aria-label', `New Game+. ${NG_PLUS_RULE}`);
        const keep = h('button', {
          text: 'Keep playing',
          onclick: () => {
            this.locallyClosed = true;
            this.toggle(false);
            ctx.send({ t: 'dismissGate' });
          },
        });
        keep.type = 'button';
        bind(() => {
          const summary = st().profile.gate.summary;
          const rows = summary ? summaryRows(summary) : [];
          list.replaceChildren(...rows.flatMap((row) => [h('dt', { text: row.label }), h('dd', { text: row.value })]));
        });
        const box = h(
          'div',
          { class: 'hud box' },
          title,
          lead,
          list,
          rule,
          h('div', { class: 'row end' }, again, keep),
        );
        return [box];
      },
    );
    el.addEventListener('click', (e) => {
      if (e.target === el) this.dismiss();
    });
    window.addEventListener('keydown', this.onKey);
  }

  /** Tab and arrows cycle the dialog when it is the topmost modal. Gamepad uses the same buttons. */
  private onKey = (e: KeyboardEvent): void => {
    trapModalTab(this.el, e);
  };

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Esc or the backdrop: same as Keep playing. */
  dismiss(): void {
    if (!this.open) return;
    this.locallyClosed = true;
    this.toggle(false);
    this.ctx.send({ t: 'dismissGate' });
  }

  toggle(force?: boolean): void {
    const open = force ?? !this.open;
    const was = this.open;
    if (open && !was) this.returnTo = previousFocus(document.activeElement);
    this.el.classList.toggle('hidden', !open);
    if (open) {
      this.panel.refresh();
      const first = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => n.getClientRects().length > 0);
      first?.focus();
    } else if (was) {
      const target = this.returnTo?.isConnected ? this.returnTo : null;
      this.returnTo = null;
      target?.focus();
    }
  }

  /** Opens while a summary is waiting, and stays closed after the player dismisses it. */
  refresh(): void {
    const gate = this.ctx.getState().profile.gate;
    if (!gate.summary) this.locallyClosed = false;
    const show = gate.summary != null && !gate.acknowledged && !this.locallyClosed;
    if (show && !this.open) this.toggle(true);
    else if (!show && this.open && gate.acknowledged) this.toggle(false);
    if (this.open) this.panel.refresh();
  }
}
