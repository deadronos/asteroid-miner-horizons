// Selected-ship panel: hull/shield/cargo bars, stats, dock/repair/scrap and
// the component slots (install, upgrade, remove).

import {
  COMPONENTS,
  COMPONENT_IDS,
  isVariant,
  variantDef,
  type ComponentId,
  type VariantId,
} from '../../data/components';
import { HULLS } from '../../data/hulls';
import { canAfford, formatCost, formatWallet, type Cost, walletTotal } from '../../data/resources';
import { isDocked, refitBlock, repairCost, scrapValue, upgradeCost } from '../../sim/economy';
import { applySystemStats } from '../../sim/modifiers';
import { findShip, isAlive, isFlagship, selectedShip, shipStats } from '../../sim/ships';
import type { Fitted, Ship } from '../../sim/types';
import { Panel, bar, h, setDisabled, setText } from '../dom';
import type { PanelCtx } from './context';

/** One `<option>` of an empty slot's install select. */
export interface InstallOption {
  /** `component:variant`, the option's `value`. */
  value: string;
  /** Option text: the family name, plus the variant when the family has several, plus the tier-1 price. */
  label: string;
  comp: ComponentId;
  variant: VariantId;
  /** That variant's tier-1 install price. */
  cost: Cost;
}

/** Every (component, variant) an empty slot can install, in table order. */
export function installOptions(): InstallOption[] {
  const out: InstallOption[] = [];
  for (const cid of COMPONENT_IDS) {
    const def = COMPONENTS[cid];
    for (const v of def.variants) {
      const cost = v.cost(1);
      const name = def.variants.length > 1 ? `${def.name} — ${v.name}` : def.name;
      out.push({
        value: `${cid}:${v.id}`,
        label: `${name} — ${formatCost(cost)}`,
        comp: cid,
        variant: v.id,
        cost,
      });
    }
  }
  return out;
}

/** Parse an install option's `value`; null if it names no real component variant. */
export function parseInstallValue(value: string): { comp: ComponentId; variant: VariantId } | null {
  const at = value.indexOf(':');
  if (at < 0) return null;
  const comp = value.slice(0, at) as ComponentId;
  const variant = value.slice(at + 1);
  if (!COMPONENT_IDS.includes(comp) || !isVariant(comp, variant)) return null;
  return { comp, variant };
}

/** Tooltip for the remove button: the refund of half the fitted variant's cost. */
export function removeRefundTitle(f: Fitted): string {
  return `Remove (refund ${formatCost(scrapValue(f))})`;
}

/** Structure key for the panel: hull plus every slot's type, variant and tier. */
export function shipPanelKey(ship: Ship | undefined): string {
  if (!ship) return 'none';
  const slots = ship.slots.map((f) => (f ? `${f.type}:${f.variant}:${f.tier}` : '-')).join('.');
  return `${ship.id}:${ship.hullId}:${slots}`;
}

export function createShipPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  return new Panel(
    el,
    () => {
      const s = ctx.getState();
      return shipPanelKey(selectedShip(s.run));
    },
    (bind) => {
      const st = ctx.getState;
      const s0 = st();
      const ship0 = selectedShip(s0.run);
      if (!ship0) return [h('h3', { text: 'No ship selected' })];
      const id = ship0.id;
      const cur = (): Ship | undefined => findShip(st().run, id);
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
        setText(cargoDetail, formatWallet(s.cargo, { min: 1, sep: '  ', iconFirst: true, empty: 'Hold empty' }));
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
          const def = variantDef(f.type, f.variant);
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
            title: removeRefundTitle(f),
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
          const opts = installOptions();
          for (const o of opts) {
            const opt = h('option', { text: o.label });
            opt.value = o.value;
            sel.append(opt);
          }
          sel.addEventListener('change', () => {
            const pick = parseInstallValue(sel.value);
            if (pick) send({ t: 'install', shipId: id, slot: i, comp: pick.comp, variant: pick.variant });
            sel.selectedIndex = 0;
          });
          row.append(sel);
          bind(() => {
            const s = cur();
            if (!s) return;
            const rb = refitBlock(st(), s);
            sel.disabled = !!rb;
            sel.title = rb ?? '';
            // Option 0 is the 'Install…' placeholder; the rest mirror installOptions().
            const bank = st().run.bank;
            for (let k = 0; k < opts.length; k++) sel.options[k + 1]!.disabled = !canAfford(bank, opts[k]!.cost);
          });
        }
        return row;
      });

      return [title, hull.el, shield.el, cargo.el, cargoDetail, stats, actions, notice, slotsHead, ...slotRows];
    },
  );
}
