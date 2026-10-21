// Station refinery panel: the two recipes with +1/+10/Max queue buttons and the
// live queue, each job showing done/total, a progress bar and a cancel button.

import { RECIPES, RECIPE_IDS } from '../../data/refining';
import { RESOURCE_INFO } from '../../data/resources';
import { describeRecipe, findJob, jobProgress, maxBatches, refineBlock } from '../../sim/refining';
import type { GameState } from '../../sim/types';
import { Panel, bar, h, setBlocked, setText, slotRow } from '../dom';
import { collapsibleHeading } from './collapsible';
import type { PanelCtx } from './context';
import { type RefineryCollapseState, syncRefineryCollapse, toggleRefineryCollapse } from './refineryCollapse';

/**
 * Structure key for the panel: seed, system number and the queue's
 * `id:recipe:total` list. Seed+system tell runs apart because job ids restart per
 * run, like contract board ids.
 */
export function refineryKey(state: GameState): string {
  const { profile, run } = state;
  return `${profile.seed}:${run.system.number}|${run.refinery.queue.map((j) => `${j.id}:${j.recipe}:${j.total}`).join(',')}`;
}

export function createRefineryPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  const st = ctx.getState;
  let collapse: RefineryCollapseState = { collapsed: false, keepOpenWhenEmpty: false };
  let panel: Panel;
  const toggle = (): void => {
    collapse = toggleRefineryCollapse(collapse, st().run.refinery.queue.length);
    panel.invalidate();
    panel.refresh();
  };
  panel = new Panel(
    el,
    () => {
      collapse = syncRefineryCollapse(collapse, st().run.refinery.queue.length);
      return `${refineryKey(st())}|${collapse.collapsed ? 'c' : 'o'}`;
    },
    (bind) => {
      const queue0 = st().run.refinery.queue;
      const nodes: Node[] = [collapsibleHeading('Refinery', collapse.collapsed, toggle)];
      if (collapse.collapsed) return nodes;

      for (const id of RECIPE_IDS) {
        const row = h('div', { class: 'row' });
        const specs: { label: string; n: () => number }[] = [
          { label: '+1', n: () => 1 },
          { label: '+10', n: () => 10 },
          { label: 'Max', n: () => maxBatches(st().run, id) },
        ];
        for (const spec of specs) {
          const btn = h('button', {
            text: spec.label,
            // Max can be 0; validate 1 so the sim rejects nothing (see the disabled check).
            onclick: () => ctx.send({ t: 'refine', recipe: id, count: Math.max(1, spec.n()) }),
          });
          row.append(btn);
          bind(() => {
            // Max can be 0; validate 1 so the tooltip names the real blocker.
            const block = refineBlock(st().run, id, Math.max(1, spec.n()));
            setBlocked(btn, 'error' in block ? block.error : null);
          });
        }
        const desc = h('small');
        bind(() => setText(desc, describeRecipe(id, st().profile)));
        nodes.push(slotRow(RECIPES[id].name, desc, row));
      }

      if (queue0.length === 0) {
        nodes.push(h('div', { class: 'dim small', text: 'Queue empty.' }));
      } else {
        for (let i = 0; i < queue0.length; i++) {
          const { id: jobId, recipe: id } = queue0[i]!;
          const done = h('small');
          const cancel = h('button', {
            class: 'danger',
            text: '✕',
            title: 'Cancel and refund',
            onclick: () => ctx.send({ t: 'cancelRefine', jobId }),
          });
          bind(() => {
            const job = findJob(st().run, jobId);
            if (job) setText(done, `${job.total - job.count}/${job.total}`);
          });
          nodes.push(slotRow(`${RESOURCE_INFO[id].icon} ${RECIPES[id].name}`, done, cancel));
          if (i === 0) {
            const progress = bar('refine');
            nodes.push(progress.el);
            bind(() => {
              const job = st().run.refinery.queue[0];
              if (job) progress.set(jobProgress(job, st().profile));
            });
          }
        }
      }

      return nodes;
    },
  );
  return panel;
}
