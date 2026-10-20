// First-steps checklist (#171): six onboarding goals with the next one's how-to,
// a hint for the current blocker, and a close button that hides it for this save.
// Built once; refresh only flips classes and text. The rules live in `../goals`.

import { GOALS, goalDone, goalHint, goalProgress, goalsVisible, type HintEnv } from '../goals';
import { Panel, h, setText } from '../dom';
import type { PanelCtx } from './context';

export function createGoalsPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  const st = ctx.getState;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'First steps');
  return new Panel(
    el,
    () => 'goals',
    (bind) => {
      const count = h('small');
      const close = h('button', { class: 'icon close', text: '×', onclick: () => ctx.send({ t: 'dismissGoals' }) });
      close.title = 'Hide the first steps for this save';
      close.setAttribute('aria-label', 'Hide the first steps for this save');
      const head = h('div', { class: 'head' }, h('h3', {}, 'First steps ', count), close);

      const rows = GOALS.map((g) => {
        const mark = h('span', { class: 'mark' });
        const progress = h('small', { class: 'dim' });
        const how = h('div', { class: 'how', text: g.how });
        const row = h('li', { class: 'goal' }, mark, h('span', { text: g.label }), ' ', progress, how);
        return { g, row, mark, progress };
      });
      const hint = h('div', { class: 'notice hint' });
      hint.setAttribute('role', 'status');

      bind(() => {
        const s = st();
        const show = goalsVisible(s);
        el.classList.toggle('hidden', !show);
        if (!show) return;
        const done = rows.map((r) => goalDone(s, r.g.id));
        const cur = done.indexOf(false);
        rows.forEach((r, i) => {
          r.row.classList.toggle('done', done[i]!);
          r.row.classList.toggle('cur', i === cur);
          setText(r.mark, done[i] ? '✓' : i === cur ? '▸' : '○');
          setText(r.progress, done[i] ? '' : (goalProgress(s, r.g.id) ?? ''));
        });
        setText(count, `${done.filter(Boolean).length}/${GOALS.length}`);
        const v = ctx.settings.value;
        const env: HintEnv = {
          assists: { autoDock: v.assistAutoDock },
          auto: { repairAt: v.autoRepairAt, reserve: v.autoReserve },
        };
        const text = goalHint(s, env);
        hint.classList.toggle('hidden', !text);
        setText(hint, text ? `⚠ ${text}` : '');
      });

      return [head, h('ul', {}, ...rows.map((r) => r.row)), hint];
    },
  );
}
