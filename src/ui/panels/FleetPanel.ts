// Fleet list (status, hull and cargo bars, AI mode, autorepair/autoupgrade), the outposts list and the shipyard.

import { HULLS, HULL_IDS } from '../../data/hulls';
import { formatCost, walletTotal } from '../../data/resources';
import { TUNING } from '../../data/tuning';
import { outpostAt } from '../../sim/automation';
import { hullBlock, isDocked } from '../../sim/economy';
import { droneCount, findShip, fleetCap, isAlive, isFlagship, isHauler, shipStats } from '../../sim/ships';
import type { IdleReason, ShipStatus } from '../../sim/status';
import type { GameState, Ship } from '../../sim/types';
import { Panel, bar, h, setBlocked, setText } from '../dom';
import type { PanelCtx } from './context';

const REASONS: Record<IdleReason, string> = {
  noRocks: 'no safe rocks in range',
  outpostLimit: 'outpost limit reached',
  noBuildSite: 'no build site',
  belowReserve: 'bank below reserve',
  repairMoney: 'waiting for repair money',
  nothingToHaul: 'nothing to haul',
};

/** The line a brain's status shows in the fleet list; `holdShare` is cargo over capacity (0..1). */
export function formatStatus(st: ShipStatus, holdShare: number): string {
  const rock = st.rockKind ? `${st.large ? 'large ' : ''}${st.rockKind} rock` : '';
  const why = st.reason ? ` · ${REASONS[st.reason]}` : '';
  const hold = ` · hold ${Math.round(holdShare * 100)}%`;
  switch (st.kind) {
    case 'mining':
      return `Mining ${rock || 'rock'}${hold}`;
    case 'heading':
      return rock ? `Heading to ${rock}` : 'Repositioning';
    case 'collecting':
      return 'Collecting pickups';
    case 'returning':
      return `Returning to dock${holdShare >= 1 ? ' · hold full' : ''}`;
    case 'docked':
      return 'Docked';
    case 'repairing':
      return 'Docked · repairing';
    case 'unloading':
      return 'Docked · unloading';
    case 'haulOutpost':
      return st.reason ? `Hauling${why}` : 'Collecting from outpost';
    case 'haulMiner':
      return st.reason ? `Hauling${why}` : 'Collecting from drone';
    case 'buildHeading':
      return 'Heading to build an outpost';
    case 'building':
      return `Building outpost${rock ? ` on ${rock}` : ''}`;
    case 'avoidComet':
      return 'Avoiding comet';
    case 'flare':
      return 'Sheltering from flare';
    case 'escorting':
      return 'Escorting';
    case 'idle':
      return `Idle${why || (holdShare >= 1 ? ' · hold full' : '')}`;
  }
}

function status(state: GameState, s: Ship): string {
  if (!isAlive(s)) return `Rebuilding ${Math.ceil(s.respawn)}s`;
  if (isDocked(state.run, s) && !s.order && isFlagship(s)) return 'Docked';
  if (s.order?.kind === 'mine') return s.beamOn ? 'Mining' : 'Approaching';
  if (s.order?.kind === 'dock') return 'Returning';
  if (s.order?.kind === 'move') return 'Moving';
  if (isFlagship(s)) return s.beamOn ? 'Mining' : 'Idle';
  const st = state.out.status.get(s.id);
  if (!st) return 'Standby';
  const cap = shipStats(s, state.profile).cargoCap;
  return formatStatus(st, cap > 0 ? walletTotal(s.cargo) / cap : 0);
}

export function createFleetPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  const st = ctx.getState;
  return new Panel(
    el,
    () => {
      const s = st();
      const outposts = s.run.automation.outposts.map((o) => o.rockId).join(',');
      return s.run.ships.map((x) => `${x.id}:${x.hullId}`).join(',') + `|${fleetCap(s.profile)}|${outposts}`;
    },
    (bind) => {
      const s0 = st();
      const head = h('h3');
      bind(() => setText(head, `Fleet · ${droneCount(st().run)}/${fleetCap(st().profile)} drones`));
      const rows = s0.run.ships.map((ship) => {
        const id = ship.id;
        const name = h('span', { class: 'nm', text: `${isFlagship(ship) ? '★' : '▸'} ${ship.name}` });
        const stat = h('span', { class: 'st' });
        const hb = bar('hull mini');
        const cb = bar('cargo mini');
        const row = h(
          'div',
          { class: 'shiprow', onclick: () => ctx.send({ t: 'select', shipId: id }) },
          name,
          stat,
          hb.el,
          cb.el,
        );
        let mode: HTMLButtonElement | null = null;
        let repair: HTMLButtonElement | null = null;
        let upgrade: HTMLButtonElement | null = null;
        if (!isFlagship(ship)) {
          const ctl = h('div', { class: 'ctl' });
          if (!isHauler(ship)) {
            mode = h('button', {
              class: 'mode',
              onclick: (e) => {
                e.stopPropagation();
                const cur = findShip(st().run, id);
                if (cur) ctx.send({ t: 'aiMode', shipId: id, mode: cur.aiMode === 'assist' ? 'auto' : 'assist' });
              },
            });
            mode.dataset.title = 'Assist: work near the flagship · Auto: work near the station';
            ctl.append(mode);
          }
          const toggle = (kind: 'repair' | 'upgrade', text: string, title: string): HTMLButtonElement => {
            const btn = h('button', {
              class: 'mode auto',
              text,
              onclick: (e) => {
                e.stopPropagation();
                const cur = findShip(st().run, id);
                if (cur)
                  ctx.send({
                    t: 'shipAuto',
                    shipId: id,
                    kind,
                    on: !(kind === 'repair' ? cur.autoRepair : cur.autoUpgrade),
                  });
              },
            });
            btn.dataset.title = title;
            ctl.append(btn);
            return btn;
          };
          repair = toggle(
            'repair',
            'REPAIR',
            'Autorepair: fly home and repair below the hull threshold (Menu → Gameplay)',
          );
          upgrade = toggle(
            'upgrade',
            'UPGRADE',
            'Autoupgrade: while docked, spend the bank above the reserve on slots and tiers',
          );
          row.append(ctl);
        }
        bind(() => {
          const s = st();
          const cur = findShip(s.run, id);
          if (!cur) return;
          const stt = shipStats(cur, s.profile);
          row.classList.toggle('sel', s.run.selectedId === id);
          setText(stat, status(s, cur));
          hb.set(cur.hull / stt.maxHull);
          cb.set(walletTotal(cur.cargo) / stt.cargoCap);
          if (mode) setText(mode, cur.aiMode === 'assist' ? 'ASSIST' : 'AUTO');
          repair?.classList.toggle('on', cur.autoRepair);
          upgrade?.classList.toggle('on', cur.autoUpgrade);
        });
        return row;
      });

      const outHead = h('h3');
      bind(() => setText(outHead, `Outposts · ${st().run.automation.outposts.length}/${TUNING.outpostMax}`));
      const outRows = s0.run.automation.outposts.map((o0) => {
        const rockId = o0.rockId;
        const label = h('span', { class: 'nm', text: `▪ ${o0.kind} outpost` });
        const stat = h('span', { class: 'st' });
        const sb = bar('cargo mini');
        bind(() => {
          const o = outpostAt(st(), rockId);
          if (!o) return;
          setText(stat, `${Math.floor(o.reserve)} left`);
          sb.set(walletTotal(o.stored) / TUNING.outpostCapacity);
        });
        return h('div', { class: 'shiprow' }, label, stat, sb.el);
      });
      const outHint = h('div', {
        class: 'dim small',
        text: 'Fly next to a large asteroid and press the outpost key over it. Haulers collect the output.',
      });

      const yard = h('h3', { text: 'Shipyard' });
      const buys = HULL_IDS.filter((id) => id !== 'prospector').map((hid) => {
        const def = HULLS[hid];
        const btn = h('button', { class: 'buy', onclick: () => ctx.send({ t: 'buyHull', hullId: hid }) });
        const note =
          def.role === 'flagship'
            ? ' — replaces your flagship hull, keeps fitted parts'
            : def.role === 'hauler'
              ? ' — ferries cargo from drones and outposts to the station; does not mine'
              : '';
        btn.dataset.title = `${def.name}: ${def.slots} slots (up to ${def.maxSlots}), ${def.hull} hull, ${def.cargo} cargo${note}`;
        btn.append(
          h('span', { text: `${def.role === 'flagship' ? 'Refit flagship → ' : '+ '}${def.name}` }),
          h('small', { text: formatCost(def.cost) }),
        );
        bind(() => {
          setBlocked(btn, hullBlock(st(), hid));
          btn.classList.toggle('hidden', def.role === 'flagship' && st().run.ships.some((x) => x.hullId === hid));
        });
        return btn;
      });
      return [head, ...rows, outHead, ...outRows, ...(outRows.length ? [] : [outHint]), yard, ...buys];
    },
  );
}
