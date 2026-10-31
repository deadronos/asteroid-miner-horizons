// Run summary shown when the Horizon Gate opens. Keyboard and gamepad use the
// same focusable buttons as the other modals. Closing it acknowledges the
// summary; New Game+ starts the next run.

import { NG_PLUS_RULE } from '../../data/gate';
import { Panel, h } from '../dom';
import { FOCUSABLE, nextFocusIndex } from '../focus';
import { summaryRows } from '../gateView';
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
          text: 'This run reached the gate. The record below is what you finished with.',
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

  /** Tab and arrows cycle the dialog. Gamepad uses the same focusable buttons. */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    const tab = e.key === 'Tab';
    const arrows = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (!tab && !arrows) return;
    const items = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
    const backward = e.key === 'Tab' ? e.shiftKey : e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    const at = items.indexOf(document.activeElement as HTMLElement);
    const dest = items[nextFocusIndex(items.length, at, backward)];
    e.preventDefault();
    dest?.focus();
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
    if (open && !was) {
      const active = document.activeElement;
      this.returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
    }
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
