// Warp route picker (#172) modal: one card per candidate system with its star class, hazard level, belts and
// modifiers, each with its own warp button. Opened from the top bar's WARP button.

import type { HazardLevel } from '../../data/hazards';
import { MODIFIERS } from '../../data/modifiers';
import { dataGain, warpCost } from '../../sim/economy';
import { describeModifier } from '../../sim/modifiers';
import { type HazardRating, hazardRating, richestRoute, routeRocks, warpRoutes } from '../../sim/routes';
import type { Profile, StarClass, StarSystem } from '../../sim/types';
import { Panel, h, setDisabled, setText } from '../dom';
import { FOCUSABLE } from '../focus';
import { previousFocus, trapModalTab } from '../modalKey';
import type { PanelCtx } from './context';

const STAR_NAMES: Record<StarClass, string> = { M: 'red dwarf', G: 'yellow star', B: 'blue giant' };

/** Everything a route card shows, as text. */
export interface RouteCard {
  title: string;
  star: string;
  hazard: HazardRating;
  hazardText: string;
  belts: string;
  modifiers: { icon: string; name: string; effect: string }[];
}

/** The text of one route card; `hazards` is the player's hazard setting. */
export function routeCard(sys: StarSystem, hazards: HazardLevel): RouteCard {
  const rating = hazardRating(sys.starClass);
  return {
    title: `${sys.name} · SYS ${sys.number}`,
    star: `${sys.starClass}-class ${STAR_NAMES[sys.starClass]}`,
    hazard: rating.level,
    hazardText:
      hazards === 'off' ? `${rating.text} (hazards are off)` : `${rating.text}${hazards === 'harsh' ? ', harsh' : ''}`,
    belts: `${sys.belts.length} belts · ${routeRocks(sys)} rocks · richness ${Math.round(sys.richness * 100)}%`,
    modifiers: sys.modifiers.map((id) => ({
      icon: MODIFIERS[id].icon,
      name: MODIFIERS[id].name,
      effect: describeModifier(id),
    })),
  };
}

/** Panel key: the cards change only with the save's seed and warp count, and the hazard setting. */
export const warpPanelKey = (p: Profile, hazards: HazardLevel): string => `${p.seed}|${p.warps}|${hazards}`;

/** The top bar's WARP button, the first `button.warp` outside the picker (the bar precedes it in the document). */
const warpButton = (picker: HTMLElement): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('button.warp')].find((b) => !picker.contains(b)) ?? null;

export class WarpPanel {
  private panel: Panel;
  private returnTo: HTMLElement | null = null;

  constructor(
    readonly el: HTMLElement,
    ctx: PanelCtx,
  ) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Warp routes');
    const st = ctx.getState;
    this.panel = new Panel(
      el,
      () => warpPanelKey(st().profile, ctx.settings.value.hazards),
      (bind) => {
        const box = h('div', { class: 'hud box routes' });
        const intro = h('p', { class: 'dim' });
        const systems = warpRoutes(st().profile);
        const best = richestRoute(systems);
        const cards = systems.map((sys, route) => {
          const c = routeCard(sys, ctx.settings.value.hazards);
          const hazard = h('div', { class: `hazard-${c.hazard}`, text: `⚠ ${c.hazard} · ${c.hazardText}` });
          const btn = h('button', {
            class: 'warp',
            onclick: () => {
              ctx.send({ t: 'warp', route });
              this.toggle(false);
            },
          });
          btn.type = 'button';
          bind(() => {
            const s = st();
            const cost = warpCost(s);
            setText(btn, `WARP ▸ ${cost}◉`);
            setDisabled(btn, s.run.bank.fuel < cost, `Need ${cost} fuel in the station bank.`);
          });
          const star = h('span', { class: 'star-dot' });
          star.style.background = `#${sys.starColor.toString(16).padStart(6, '0')}`;
          return h(
            'div',
            { class: 'route' },
            h('h3', { text: c.title }, route === best ? h('span', { class: 'badge', text: 'richest' }) : null),
            h('div', {}, star, ` ${c.star}`),
            hazard,
            h('div', { class: 'dim', text: c.belts }),
            h(
              'div',
              { class: 'route-mods' },
              ...(c.modifiers.length
                ? c.modifiers.map((m) =>
                    h('div', {}, h('span', { class: 'mod', text: `${m.icon} ${m.name}` }), ` ${m.effect}`),
                  )
                : [h('span', { class: 'dim', text: 'No modifiers' })]),
            ),
            h('div', { class: 'row end' }, btn),
          );
        });
        bind(() => {
          const s = st();
          setText(
            intro,
            `Choose the next system. Warping resets your bank, ships and components but keeps research, and earns +${dataGain(s)} HD.`,
          );
        });
        const close = h('button', { text: 'Cancel', onclick: () => this.toggle(false) });
        close.type = 'button';
        box.append(
          h('h2', { text: 'Warp routes' }),
          intro,
          h('div', { class: 'route-list' }, ...cards),
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

  /** Tab and arrows cycle the picker when it is the topmost modal. Gamepad uses the same buttons. */
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
      const first = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => n.getClientRects().length > 0);
      first?.focus();
    } else if (was) {
      // The opener may be gone by now; fall back to the WARP button, then to the body so focus
      // does not stay on a button inside the hidden picker.
      const target = this.returnTo?.isConnected ? this.returnTo : warpButton(this.el);
      this.returnTo = null;
      (target ?? document.body).focus();
    }
  }

  /** Refreshes only while visible. */
  refresh(): void {
    if (this.open) this.panel.refresh();
  }
}
