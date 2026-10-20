// Fleet list (status, hull and cargo bars, AI mode), the outposts list and the shipyard.

import { HULLS, HULL_IDS } from '../../data/hulls';
import { formatCost, walletTotal } from '../../data/resources';
import { TUNING } from '../../data/tuning';
import { outpostAt } from '../../sim/automation';
import { hullBlock, isDocked } from '../../sim/economy';
import { droneCount, findShip, fleetCap, isAlive, isFlagship, isHauler, isHoldFull, shipStats } from '../../sim/ships';
import type { GameState, Ship } from '../../sim/types';
import { Panel, bar, h, setBlocked, setText } from '../dom';
import type { PanelCtx } from './context';

function status(state: GameState, s: Ship): string {
  if (!isAlive(s)) return `Rebuilding ${Math.ceil(s.respawn)}s`;
  if (isDocked(state.run, s) && !s.order) return 'Docked';
  if (s.order?.kind === 'mine') return s.beamOn ? 'Mining' : 'Approaching';
  if (s.order?.kind === 'dock') return 'Returning';
  if (s.order?.kind === 'move') return 'Moving';
  if (isFlagship(s)) return s.beamOn ? 'Mining' : 'Idle';
  const st = shipStats(s, state.profile);
  if (isHauler(s)) {
    if (s.aiTargetId != null) return walletTotal(s.cargo) > 0 ? 'Loading' : 'Collecting';
    return walletTotal(s.cargo) > 0 ? 'Unloading' : 'Standby';
  }
  if (isHoldFull(s, st)) return 'Hauling';
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
        if (!isFlagship(ship) && !isHauler(ship)) {
          mode = h('button', {
            class: 'mode',
            onclick: (e) => {
              e.stopPropagation();
              const cur = findShip(st().run, id);
              if (cur) ctx.send({ t: 'aiMode', shipId: id, mode: cur.aiMode === 'assist' ? 'auto' : 'assist' });
            },
          });
          mode.dataset.title = 'Assist: work near the flagship · Auto: work near the station';
          row.append(mode);
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
