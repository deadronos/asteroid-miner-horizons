// Horizon Research (prestige) modal: perk list with levels and costs.

import { PERKS, PERK_IDS } from '../../data/perks';
import { dataGain, perkCost } from '../../sim/economy';
import { Panel, h, setDisabled, setText } from '../dom';
import type { PanelCtx } from './context';

export class ResearchPanel {
  private panel: Panel;

  constructor(
    readonly el: HTMLElement,
    ctx: PanelCtx,
  ) {
    const st = ctx.getState;
    this.panel = new Panel(
      el,
      () => `${st().profile.warps}`,
      (bind) => {
        const box = h('div', { class: 'hud box' });
        const head = h('h2', { text: 'Horizon Research' });
        const intro = h('p', { class: 'dim' });
        bind(() => {
          const s = st();
          setText(
            intro,
            `Warping to a fresh system resets your bank, ships and components but keeps research. You have ✦ ${s.profile.data} Horizon Data (${s.profile.dataEarned} earned over ${s.profile.warps} warps). Warping now earns +${dataGain(s)} HD.`,
          );
        });
        const rows = PERK_IDS.map((pid) => {
          const def = PERKS[pid];
          const desc = h('small');
          const lvl = h('span', { class: 'pips' });
          const btn = h('button', { onclick: () => ctx.send({ t: 'buyPerk', perk: pid }) });
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
          return h('div', { class: 'slot' }, h('div', { class: 'nm' }, h('b', { text: def.name }), lvl, desc), btn);
        });
        const close = h('button', { text: 'Close', onclick: () => this.toggle(false) });
        box.append(head, intro, ...rows, h('div', { class: 'row end' }, close));
        return [box];
      },
    );
    el.addEventListener('click', (e) => {
      if (e.target === el) this.toggle(false);
    });
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('hidden', force == null ? undefined : !force);
  }

  /** Refreshes only while visible. */
  refresh(): void {
    if (this.open) this.panel.refresh();
  }
}
