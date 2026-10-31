// Horizon Research (prestige) modal: doctrine pairs, then the perk list.

import { DOCTRINE_PAIR_IDS, DOCTRINE_PAIRS } from '../../data/doctrines';
import { PERKS, PERK_IDS } from '../../data/perks';
import { dataGain, perkCost } from '../../sim/economy';
import { doctrinePanel } from '../doctrines';
import { gatePanel } from '../gateView';
import { Panel, bar, h, setDisabled, setText, slotRow } from '../dom';
import { FOCUSABLE } from '../focus';
import { previousFocus, trapModalTab } from '../modalKey';
import type { PanelCtx } from './context';

export class ResearchPanel {
  private panel: Panel;
  /** The control that opened the dialog, focused again when it closes. */
  private returnTo: HTMLElement | null = null;

  constructor(
    readonly el: HTMLElement,
    ctx: PanelCtx,
  ) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Horizon Research');
    const st = ctx.getState;
    this.panel = new Panel(
      el,
      () => `${st().profile.warps}`,
      (bind) => {
        const box = h('div', { class: 'hud box' });
        const head = h('h2', { text: 'Horizon Research' });
        const intro = h('p', { class: 'dim' });
        const gateStatus = h('p');
        const gateNext = h('p', { class: 'dim' });
        const gateBar = bar('gate');
        gateBar.el.setAttribute('role', 'img');
        const gateSummary = h('dl');
        const gateRule = h('p', { class: 'dim' });
        const deliver = h('button', { onclick: () => ctx.send({ t: 'fundGate' }) });
        deliver.type = 'button';
        const newGame = h('button', { onclick: () => ctx.send({ t: 'newGamePlus' }) });
        newGame.type = 'button';
        const hint = h('p', { class: 'dim' });
        bind(() => {
          const s = st();
          setText(
            intro,
            `Warping to a fresh system resets your bank, ships and components but keeps research. You have ✦ ${s.profile.data} Horizon Data (${s.profile.dataEarned} earned over ${s.profile.warps} warps). Warping now earns +${dataGain(s)} HD.`,
          );
          setText(hint, doctrinePanel(s.profile, s.run.time).hint);
          const view = gatePanel(s);
          setText(gateStatus, view.status);
          setText(gateNext, view.next);
          gateBar.set(view.fraction, view.bar);
          gateBar.el.setAttribute('aria-label', view.bar);
          setText(deliver, view.deliverLabel);
          deliver.setAttribute('aria-label', `${view.deliverLabel}. ${view.next}`);
          setDisabled(deliver, view.deliverBlocked != null, view.deliverBlocked ?? '');
          gateSummary.replaceChildren(
            ...(view.summary ?? []).flatMap((row) => [h('dt', { text: row.label }), h('dd', { text: row.value })]),
          );
          gateSummary.hidden = view.summary == null;
          setText(gateRule, view.summary ? view.rule : '');
          gateRule.hidden = view.summary == null;
          newGame.hidden = view.summary == null;
          setText(newGame, 'New Game+');
          newGame.setAttribute('aria-label', `New Game+. ${view.rule}`);
        });
        const doctrines = DOCTRINE_PAIR_IDS.map((pid) => {
          const def = DOCTRINE_PAIRS[pid];
          const rows = def.sides.map((side) => {
            const trade = h('small');
            const btn = h('button', {
              onclick: () => ctx.send({ t: 'chooseDoctrine', pair: pid, side: side.id }),
            });
            btn.type = 'button';
            const row = slotRow(side.name, trade, btn);
            bind(() => {
              const view = doctrinePanel(st().profile, st().run.time).pairs.find((p) => p.id === pid)!;
              const s = view.sides.find((x) => x.id === side.id)!;
              setText(trade, s.trade);
              setText(btn, s.action);
              btn.setAttribute('aria-pressed', s.picked ? 'true' : 'false');
              btn.setAttribute('aria-label', `${s.name}. ${s.trade} ${s.action}`);
              // Stay focusable while locked so keyboard and gamepad can land here.
              // Activating still sends the command; the sim rejects it with a log line.
              btn.setAttribute('aria-disabled', view.locked ? 'true' : 'false');
              btn.title = view.locked ? 'Respec at warp' : '';
              btn.classList.toggle('on', s.picked);
              row.classList.toggle('picked', s.picked);
            });
            return row;
          });
          const clear = h('button', {
            onclick: () => ctx.send({ t: 'chooseDoctrine', pair: pid, side: null }),
          });
          clear.type = 'button';
          bind(() => {
            const view = doctrinePanel(st().profile, st().run.time).pairs.find((p) => p.id === pid)!;
            setText(clear, view.clear);
            clear.setAttribute('aria-label', `${def.name}. ${view.clear}`);
            // Nothing chosen while the window is open: leave the tab order. Locked stays
            // focusable, and both states set aria-disabled to match whether the click applies.
            const skip = !view.locked && view.picked == null;
            clear.disabled = skip;
            clear.setAttribute('aria-disabled', view.locked || skip ? 'true' : 'false');
            clear.title = view.locked ? 'Respec at warp' : '';
          });
          const group = h(
            'div',
            { class: 'doctrine' },
            h('h3', { text: def.name }),
            ...rows,
            h('div', { class: 'row end' }, clear),
          );
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', def.name);
          return group;
        });
        const rows = PERK_IDS.map((pid) => {
          const def = PERKS[pid];
          const desc = h('small');
          const lvl = h('span', { class: 'pips' });
          const btn = h('button', { onclick: () => ctx.send({ t: 'buyPerk', perk: pid }) });
          btn.type = 'button';
          bind(() => {
            const s = st();
            const l = s.profile.perks[pid];
            setText(lvl, ` ${l}/${def.max}`);
            setText(
              desc,
              l > 0 ? `Now: ${def.describe(l)} · Next: ${def.describe(l + 1)}` : `Next: ${def.describe(1)}`,
            );
            const cost = perkCost(s, pid);
            setText(btn, cost == null ? 'MAX' : `✦ ${cost}`);
            setDisabled(btn, cost == null || s.profile.data < cost, cost == null ? 'Maxed' : 'Not enough Horizon Data');
          });
          return slotRow(def.name, [lvl, desc], btn);
        });
        const close = h('button', { text: 'Close', onclick: () => this.toggle(false) });
        close.type = 'button';
        const gateBlock = h(
          'div',
          { class: 'gate' },
          h('h3', { class: 'section', text: 'Horizon Gate' }),
          gateStatus,
          gateBar.el,
          gateNext,
          gateSummary,
          gateRule,
          h('div', { class: 'row end' }, deliver, newGame),
        );
        gateBlock.setAttribute('role', 'group');
        gateBlock.setAttribute('aria-label', 'Horizon Gate');
        box.append(
          head,
          intro,
          gateBlock,
          h('h3', { class: 'section', text: 'Doctrines' }),
          hint,
          ...doctrines,
          h('h3', { class: 'section', text: 'Perks' }),
          ...rows,
          h('div', { class: 'row end' }, close),
        );
        return [box];
      },
    );
    el.addEventListener('click', (e) => {
      if (e.target === el) this.toggle(false);
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

  toggle(force?: boolean): void {
    const open = force ?? !this.open;
    const was = this.open;
    if (open && !was) this.returnTo = previousFocus(document.activeElement);
    this.el.classList.toggle('hidden', !open);
    if (open) {
      this.panel.refresh();
      this.focusFirst();
    } else if (was) {
      const target = this.returnTo?.isConnected ? this.returnTo : null;
      this.returnTo = null;
      target?.focus();
    }
  }

  /** A doctrine button, so opening the panel does not land on Deliver or a perk purchase. */
  private focusFirst(): void {
    const items = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
    const doctrine = items.find((n) => n.closest('.doctrine'));
    (doctrine ?? items[0])?.focus();
  }

  /** Refreshes only while visible. */
  refresh(): void {
    if (this.open) this.panel.refresh();
  }
}
