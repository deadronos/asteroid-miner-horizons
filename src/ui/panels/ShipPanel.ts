// Selected-ship panel: hull/shield/cargo bars, stats, dock/repair/scrap and
// the component slots (install, upgrade, remove).

import { COMPONENTS, COMPONENT_IDS } from '../../data/components';
import { HULLS } from '../../data/hulls';
import { RESOURCES, RESOURCE_INFO, canAfford, formatCost, walletTotal } from '../../data/resources';
import { halve, investedCost, isDocked, refitBlock, repairCost, upgradeCost } from '../../sim/economy';
import { applySystemStats } from '../../sim/modifiers';
import { isAlive, isFlagship, shipStats } from '../../sim/ships';
import type { Ship } from '../../sim/types';
import { Panel, bar, h, setDisabled, setText } from '../dom';
import type { PanelCtx } from './context';

export function createShipPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  return new Panel(
    el,
    () => {
      const s = ctx.getState();
      const sel = s.run.ships.find((x) => x.id === s.run.selectedId);
      return sel ? `${sel.id}:${sel.hullId}:${sel.slots.map((f) => (f ? f.type + f.tier : '-')).join('.')}` : 'none';
    },
    (bind) => {
      const st = ctx.getState;
      const s0 = st();
      const ship0 = s0.run.ships.find((x) => x.id === s0.run.selectedId);
      if (!ship0) return [h('h3', { text: 'No ship selected' })];
      const id = ship0.id;
      const cur = (): Ship | undefined => st().run.ships.find((x) => x.id === id);
      const send = ctx.send;

      const title = h(
        'h3',
        { text: `${ship0.name}` },
        h('small', { text: ` ${HULLS[ship0.hullId].name} · ${ship0.slots.length} slots` }),
      );
      const hull = bar('hull');
      const shield = bar('shield');
      const cargo = bar('cargo');
      const cargoDetail = h('div', { class: 'dim small' });
      const stats = h('div', { class: 'dim small' });

      const dockBtn = h('button', { text: 'Dock & unload', onclick: () => send({ t: 'dock', shipId: id }) });
      const repairBtn = h('button', { onclick: () => send({ t: 'repair', shipId: id }) });
      const actions = h('div', { class: 'row' }, dockBtn, repairBtn);
      if (!isFlagship(ship0)) {
        const scrap = h('button', {
          text: 'Scrap',
          onclick: () => {
            if (!ctx.settings.value.confirmDestructive || confirm(`Scrap ${ship0.name} for half its value?`))
              send({ t: 'scrap', shipId: id });
          },
        });
        actions.append(scrap);
        bind(() => {
          const s = cur();
          if (s) setDisabled(scrap, !!refitBlock(st(), s), refitBlock(st(), s) ?? '');
        });
      }
      const notice = h('div', { class: 'notice' });

      bind(() => {
        const s = cur();
        if (!s) return;
        const state = st();
        const k = shipStats(s, state.profile);
        hull.set(s.hull / k.maxHull, `Hull ${Math.ceil(Math.max(0, s.hull))}/${k.maxHull}`);
        shield.set(
          k.maxShield ? s.shield / k.maxShield : 0,
          k.maxShield ? `Shield ${Math.floor(s.shield)}/${k.maxShield}` : 'No shield fitted',
        );
        const tot = walletTotal(s.cargo);
        cargo.set(tot / k.cargoCap, `Cargo ${Math.floor(tot)}/${k.cargoCap}`);
        setText(
          cargoDetail,
          RESOURCES.filter((r) => s.cargo[r] >= 1)
            .map((r) => `${RESOURCE_INFO[r].icon} ${Math.floor(s.cargo[r])}`)
            .join('  ') || 'Hold empty',
        );
        const mag = applySystemStats(k, state.run.system).magnet;
        setText(
          stats,
          `SPD ${k.speed.toFixed(0)} · DPS ${k.dps.toFixed(0)} · RNG ${k.range.toFixed(0)} · MAG ${mag.toFixed(0)} · ARM −${Math.round((1 - k.dmgMul) * 100)}%`,
        );
        const rc = repairCost(state, s);
        setText(repairBtn, rc > 0 ? `Repair ${rc}⬢` : 'Hull OK');
        const rb = refitBlock(state, s);
        setDisabled(repairBtn, rc <= 0 || !!rb || state.run.bank.ore < rc, rb ?? (rc > 0 ? 'Not enough ore' : ''));
        setDisabled(dockBtn, !isAlive(s) || isDocked(state.run, s));
        setText(notice, rb ? `⚓ ${rb}` : '⚓ Docked — refit available');
        notice.classList.toggle('ok', !rb);
      });

      const slotsHead = h('h3', { text: 'Components' });
      const slotRows = ship0.slots.map((f, i) => {
        const row = h('div', { class: 'slot' });
        if (f) {
          const def = COMPONENTS[f.type];
          row.append(
            h(
              'div',
              { class: 'nm' },
              h('b', { text: def.name }),
              h('span', { class: 'pips', text: ' ' + '●'.repeat(f.tier) + '○'.repeat(3 - f.tier) }),
              h('small', { text: def.describe(f.tier) }),
            ),
          );
          const up = h('button', { onclick: () => send({ t: 'upgrade', shipId: id, slot: i }) });
          const rm = h('button', {
            class: 'icon',
            text: '✕',
            title: `Remove (refund ${formatCost(halve(investedCost(f.type, f.tier)))})`,
            onclick: () => send({ t: 'remove', shipId: id, slot: i }),
          });
          rm.dataset.title = rm.title;
          row.append(h('div', { class: 'row' }, up, rm));
          bind(() => {
            const s = cur();
            if (!s) return;
            const cost = upgradeCost(s, i);
            const rb = refitBlock(st(), s);
            if (!cost) {
              setText(up, 'MAX');
              setDisabled(up, true, 'Max tier');
            } else {
              setText(up, `T${f.tier + 1} ${formatCost(cost)}`);
              up.dataset.title = def.describe((f.tier + 1) as 2 | 3);
              setDisabled(up, !!rb || !canAfford(st().run.bank, cost), rb ?? 'Not enough resources');
            }
            setDisabled(rm, !!rb, rb ?? '');
          });
        } else {
          row.classList.add('empty');
          row.append(
            h('div', { class: 'nm' }, h('b', { text: 'Empty slot' }), h('small', { text: 'Install a component' })),
          );
          const sel = h('select');
          sel.append(h('option', { text: 'Install…' }));
          for (const cid of COMPONENT_IDS) {
            const o = h('option', { text: `${COMPONENTS[cid].name} — ${formatCost(COMPONENTS[cid].cost(1))}` });
            o.value = cid;
            sel.append(o);
          }
          sel.addEventListener('change', () => {
            if (sel.value)
              send({ t: 'install', shipId: id, slot: i, comp: sel.value as (typeof COMPONENT_IDS)[number] });
            sel.selectedIndex = 0;
          });
          row.append(sel);
          bind(() => {
            const s = cur();
            if (!s) return;
            const rb = refitBlock(st(), s);
            sel.disabled = !!rb;
            sel.title = rb ?? '';
            for (const o of Array.from(sel.options).slice(1)) {
              o.disabled = !canAfford(st().run.bank, COMPONENTS[o.value as (typeof COMPONENT_IDS)[number]].cost(1));
            }
          });
        }
        return row;
      });

      return [title, hull.el, shield.el, cargo.el, cargoDetail, stats, actions, notice, slotsHead, ...slotRows];
    },
  );
}
