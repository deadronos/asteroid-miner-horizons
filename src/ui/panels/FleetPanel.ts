// Fleet list (status, hull and cargo bars, AI mode) plus the shipyard.

import { HULLS, HULL_IDS } from '../../data/hulls';
import { formatCost, walletTotal } from '../../data/resources';
import { hullBlock, isDocked } from '../../sim/economy';
import { droneCount, fleetCap, isAlive, isFlagship, shipStats } from '../../sim/ships';
import type { GameState, Ship } from '../../sim/types';
import { Panel, bar, h, setDisabled, setText } from '../dom';
import type { PanelCtx } from './context';

function status(state: GameState, s: Ship): string {
  if (!isAlive(s)) return `Rebuilding ${Math.ceil(s.respawn)}s`;
  if (isDocked(state.run, s) && !s.order) return 'Docked';
  if (s.order?.kind === 'mine') return s.beamOn ? 'Mining' : 'Approaching';
  if (s.order?.kind === 'dock') return 'Returning';
  if (s.order?.kind === 'move') return 'Moving';
  if (isFlagship(s)) return s.beamOn ? 'Mining' : 'Idle';
  const st = shipStats(s, state.profile);
  if (walletTotal(s.cargo) >= st.cargoCap - Math.max(2, st.cargoCap * 0.04)) return 'Hauling';
  if (s.beamOn) return 'Mining';
  if (s.aiTargetId != null) return 'Prospecting';
  return s.aiMode === 'assist' ? 'Escorting' : 'Idle';
}

export function createFleetPanel(el: HTMLElement, ctx: PanelCtx): Panel {
  const st = ctx.getState;
  return new Panel(
    el,
    () => {
      const s = st();
      return s.run.ships.map((x) => `${x.id}:${x.hullId}`).join(',') + `|${fleetCap(s.profile)}`;
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
        if (!isFlagship(ship)) {
          mode = h('button', {
            class: 'mode',
            onclick: (e) => {
              e.stopPropagation();
              const cur = st().run.ships.find((x) => x.id === id);
              if (cur) ctx.send({ t: 'aiMode', shipId: id, mode: cur.aiMode === 'assist' ? 'auto' : 'assist' });
            },
          });
          mode.dataset.title = 'Assist: work near the flagship · Auto: work near the station';
          row.append(mode);
        }
        bind(() => {
          const s = st();
          const cur = s.run.ships.find((x) => x.id === id);
          if (!cur) return;
          const stt = shipStats(cur, s.profile);
          row.classList.toggle('sel', s.run.selectedId === id);
          setText(stat, status(s, cur));
          hb.set(cur.hull / stt.maxHull);
          cb.set(walletTotal(cur.cargo) / stt.cargoCap);
          if (mode) setText(mode, cur.aiMode === 'assist' ? 'ASSIST' : 'AUTO');
        });
        return row;
      });

      const yard = h('h3', { text: 'Shipyard' });
      const buys = HULL_IDS.filter((id) => id !== 'prospector').map((hid) => {
        const def = HULLS[hid];
        const btn = h('button', { class: 'buy', onclick: () => ctx.send({ t: 'buyHull', hullId: hid }) });
        btn.dataset.title = `${def.name}: ${def.slots} slots, ${def.hull} hull, ${def.cargo} cargo${def.role === 'flagship' ? ' — replaces your flagship hull, keeps fitted parts' : ''}`;
        btn.append(
          h('span', { text: `${def.role === 'flagship' ? 'Refit flagship → ' : '+ '}${def.name}` }),
          h('small', { text: formatCost(def.cost) }),
        );
        bind(() => {
          const block = hullBlock(st(), hid);
          setDisabled(btn, !!block, block ?? '');
          btn.classList.toggle('hidden', def.role === 'flagship' && st().run.ships.some((x) => x.hullId === hid));
        });
        return btn;
      });
      return [head, ...rows, yard, ...buys];
    },
  );
}
