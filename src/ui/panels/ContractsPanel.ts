// Contract board: the active contract (goal, progress, timer, Abandon) and the
// station's open offers (goal, reward, offer timer, Accept).

import { formatCountdown } from '../../core/format';
import { formatCost } from '../../data/resources';
import { describeContract } from '../../sim/contracts';
import { Panel, bar, h, setDisabled, setText } from '../dom';
import type { PanelCtx } from './context';

const ACTIVE_REASON = 'Finish or abandon the current contract first';

export function createContractsPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  const st = ctx.getState;
  return new Panel(
    el,
    () => {
      const s = st();
      const b = s.run.contracts;
      // Board ids restart per run/system, so seed+system are needed to tell boards apart.
      return `${s.profile.seed}:${s.run.system.number}|${b.active?.id ?? '-'}|${b.offers.map((o) => o.id).join(',')}`;
    },
    (bind) => {
      const s0 = st();
      const board0 = s0.run.contracts;
      const nodes: Node[] = [h('h3', { text: 'Contracts' })];

      const active = board0.active;
      if (active) {
        const goal = h('b', { text: describeContract(active) });
        const timer = h('small');
        const progress = bar('cargo');
        const abandon = h('button', {
          class: 'danger',
          text: 'Abandon',
          onclick: () => ctx.send({ t: 'abandonContract' }),
        });
        nodes.push(h('div', { class: 'slot' }, h('div', { class: 'nm' }, goal, timer), abandon), progress.el);
        bind(() => {
          const c = st().run.contracts.active;
          if (!c) return;
          setText(timer, `⏱ ${formatCountdown(c.timeLeft)}`);
          progress.set(c.progress / c.target, `${Math.floor(c.progress)}/${c.target}`);
        });
      }

      for (const offer of board0.offers) {
        const id = offer.id;
        const goal = h('b', { text: describeContract(offer) });
        const meta = h('small');
        const accept = h('button', {
          text: 'Accept',
          onclick: () => ctx.send({ t: 'acceptContract', contractId: id }),
        });
        nodes.push(h('div', { class: 'slot' }, h('div', { class: 'nm' }, goal, meta), accept));
        bind(() => {
          const c = st().run.contracts.offers.find((o) => o.id === id);
          if (!c) return;
          setText(
            meta,
            `${formatCost(c.reward)}${c.data ? ` +${c.data} ✦` : ''} · expires ${formatCountdown(c.timeLeft)}`,
          );
          setDisabled(accept, !!st().run.contracts.active, ACTIVE_REASON);
        });
      }

      if (!active && board0.offers.length === 0) {
        nodes.push(h('div', { class: 'dim small', text: 'No offers right now.' }));
      }

      return nodes;
    },
  );
}
