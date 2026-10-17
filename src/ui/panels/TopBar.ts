// Top bar: system name, bank, Horizon Data, warp button, research and menu buttons.

import { PERK_IDS } from '../../data/perks';
import { RESOURCES, RESOURCE_INFO } from '../../data/resources';
import { dataGain, perkCost, warpCost } from '../../sim/economy';
import { Panel, h, setDisabled, setText } from '../dom';
import { GEAR_SVG } from '../Menu';
import type { PanelCtx } from './context';

export interface TopBarHooks {
  toggleResearch: () => void;
  toggleMenu: () => void;
}

const fmt = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);

export function createTopBar(el: HTMLElement, ctx: PanelCtx, hooks: TopBarHooks): Panel {
  const st = ctx.getState;
  return new Panel(
    el,
    () => `${st().run.system.number}`,
    (bind) => {
      const sys = h('span', { class: 'sys' });
      const res = RESOURCES.map((r) => {
        const e = h('span', { class: `res ${r}`, title: RESOURCE_INFO[r].name });
        bind(() => {
          const b = st().run.bank;
          e.style.display = r === 'crystal' && b.crystal <= 0 && st().run.system.number < 2 ? 'none' : '';
          setText(e, `${RESOURCE_INFO[r].icon} ${fmt(b[r])}`);
        });
        return e;
      });
      const data = h('span', { class: 'res data', title: 'Horizon Data — spend on permanent research' });
      const warp = h('button', { class: 'warp', onclick: () => ctx.send({ t: 'warp' }) });
      warp.dataset.title =
        'Jump to a fresh system. Resets your fleet and bank; keeps research. Grants Horizon Data based on value delivered this run.';
      const researchBtn = h('button', { text: 'Research', onclick: hooks.toggleResearch });
      const menu = h('button', {
        class: 'icon gear',
        title: 'Menu: saves & controls',
        onclick: hooks.toggleMenu,
      });
      menu.innerHTML = GEAR_SVG;
      menu.setAttribute('aria-label', 'Menu');
      bind(() => {
        const s = st();
        const k = s.run.system;
        setText(sys, `SYS ${k.number} · ${k.name} · ${k.starClass}-class`);
        setText(data, `✦ ${s.profile.data} HD`);
        const cost = warpCost(s);
        const gain = dataGain(s);
        setText(warp, `WARP ▸ ${cost}❄  (+${gain} HD)`);
        setDisabled(
          warp,
          s.run.bank.ice < cost,
          `Need ${cost} ice in the station bank (have ${Math.floor(s.run.bank.ice)}). Would earn +${gain} HD.`,
        );
        researchBtn.classList.toggle(
          'glow',
          PERK_IDS.some((p) => (perkCost(s, p) ?? Infinity) <= s.profile.data),
        );
      });
      return [sys, ...res, data, warp, researchBtn, menu];
    },
  );
}
