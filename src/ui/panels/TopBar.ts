// Top bar: system name, system modifier chips, bank, Horizon Data, warp button, research, help and menu buttons.

import { MODIFIERS } from '../../data/modifiers';
import { PERK_IDS } from '../../data/perks';
import { RESOURCES, RESOURCE_INFO } from '../../data/resources';
import { dataGain, perkCost, warpCost } from '../../sim/economy';
import { keyLabel } from '../../settings';
import { describeModifier } from '../../sim/modifiers';
import type { GameState } from '../../sim/types';
import { Panel, h, setDisabled, setText } from '../dom';
import { GEAR_SVG } from '../Menu';
import type { PanelCtx } from './context';

export interface TopBarHooks {
  toggleResearch: () => void;
  toggleMenu: () => void;
  toggleHelp: () => void;
  helpVisible: () => boolean;
}

const fmt = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);

/** Panel key: rebuilds on warp and when a loaded slot has the same system number but different modifiers. */
export function topBarKey(state: GameState): string {
  const { number, modifiers } = state.run.system;
  return `${number}|${modifiers.join(',')}`;
}

export function createTopBar(el: HTMLElement, ctx: PanelCtx, hooks: TopBarHooks): Panel {
  const st = ctx.getState;
  return new Panel(
    el,
    () => topBarKey(st()),
    (bind) => {
      const sys = h('span', { class: 'sys' });
      const mods = st().run.system.modifiers.map((id) => {
        const { name, icon } = MODIFIERS[id];
        const chip = h(
          'span',
          { class: 'mod', text: icon, title: describeModifier(id) },
          h('span', { class: 'mod-name', text: ` ${name}` }),
        );
        chip.setAttribute('aria-label', `${name}: ${describeModifier(id)}`);
        return chip;
      });
      const res = RESOURCES.map((r) => {
        const e = h('span', { class: `res ${r}`, title: RESOURCE_INFO[r].name });
        bind(() => {
          const s = st();
          const b = s.run.bank;
          const late = r === 'crystal' || r === 'alloy';
          // Keep crystal/alloy on screen while a job of that recipe is queued; fuel is always shown.
          const queued = s.run.refinery.queue.some((j) => j.recipe === r);
          e.style.display = late && b[r] <= 0 && !queued && s.run.system.number < 2 ? 'none' : '';
          setText(e, `${RESOURCE_INFO[r].icon} ${fmt(b[r])}`);
        });
        return e;
      });
      const data = h('span', { class: 'res data', title: 'Horizon Data — spend on permanent research' });
      const warp = h('button', { class: 'warp', onclick: () => ctx.send({ t: 'warp' }) });
      warp.dataset.title =
        'Jump to a fresh system. Resets your fleet and bank; keeps research. Grants Horizon Data based on value delivered this run.';
      const researchBtn = h('button', { text: 'Research', onclick: hooks.toggleResearch });
      const help = h('button', { class: 'icon help-btn', text: '?', onclick: hooks.toggleHelp });
      help.setAttribute('aria-label', 'Help');
      const menu = h('button', {
        class: 'icon gear',
        title: 'Menu: saves & controls',
        onclick: hooks.toggleMenu,
      });
      menu.innerHTML = GEAR_SVG;
      menu.setAttribute('aria-label', 'Menu');
      bind(() => {
        const s = st();
        const shown = hooks.helpVisible();
        if (help.getAttribute('aria-pressed') !== String(shown)) help.setAttribute('aria-pressed', String(shown));
        const key = ctx.settings.value.keys.help.find(Boolean);
        const title = `${shown ? 'Hide' : 'Show'} help${key ? ` (${keyLabel(key)})` : ''}`;
        if (help.title !== title) help.title = title;
        const k = s.run.system;
        setText(sys, `SYS ${k.number} · ${k.name} · ${k.starClass}-class`);
        setText(data, `✦ ${s.profile.data} HD`);
        const cost = warpCost(s);
        const gain = dataGain(s);
        setText(warp, `WARP ▸ ${cost}◉  (+${gain} HD)`);
        setDisabled(
          warp,
          s.run.bank.fuel < cost,
          `Need ${cost} fuel in the station bank (have ${Math.floor(s.run.bank.fuel)}). Would earn +${gain} HD.`,
        );
        researchBtn.classList.toggle(
          'glow',
          PERK_IDS.some((p) => (perkCost(s, p) ?? Infinity) <= s.profile.data),
        );
      });
      return [
        sys,
        ...(mods.length ? [h('span', { class: 'mods' }, ...mods)] : []),
        ...res,
        data,
        warp,
        researchBtn,
        help,
        menu,
      ];
    },
  );
}
