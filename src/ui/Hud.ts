// DOM HUD: top bar (bank, warp), fleet list + shipyard, selected-ship refit
// panel, research (prestige) overlay, event log, help and hover tooltip.
// All actions go out as sim Commands via `send`.

import { COMPONENTS, COMPONENT_IDS } from '../data/components';
import { HULLS, HULL_IDS } from '../data/hulls';
import { PERKS, PERK_IDS } from '../data/perks';
import { RESOURCES, RESOURCE_INFO, canAfford, formatCost, walletTotal } from '../data/resources';
import type { Command } from '../sim/commands';
import {
  dataGain,
  halve,
  hullBlock,
  investedCost,
  isDocked,
  perkCost,
  refitBlock,
  repairCost,
  upgradeCost,
  warpCost,
} from '../sim/economy';
import { droneCount, fleetCap, isAlive, isFlagship, shipStats } from '../sim/ships';
import { keyLabel, type SettingsStore } from '../settings';
import type { GameState, LogEntry, Rock, Ship } from '../sim/types';
import { Panel, bar, h, setDisabled, setText } from './dom';
import { GEAR_SVG, Menu, type SaveActions } from './Menu';

const MAX_LOG = 60;

export interface HudActions {
  send: (cmd: Command) => void;
  saves: SaveActions;
}

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

const fmt = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);

export class Hud {
  readonly root: HTMLElement;
  private getState: () => GameState;
  private top: Panel;
  private fleet: Panel;
  private ship: Panel;
  private research: Panel;
  private log = h('div', { class: 'hud' }) as HTMLElement;
  private tooltip = h('div', { class: 'tooltip' });
  private flash = h('div', { class: 'flash' });
  private help: HTMLElement;
  private researchWrap: HTMLElement;
  private paused = h('div', { class: 'paused hidden' });
  private fps = h('div', { class: 'fps hidden' });
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsWorst = 0;
  readonly menu: Menu;

  constructor(
    root: HTMLElement,
    getState: () => GameState,
    private actions: HudActions,
    private readonly settings: SettingsStore,
  ) {
    this.root = root;
    this.getState = getState;
    const mk = (id: string, cls = 'hud'): HTMLElement => {
      const e = h('div', { class: cls });
      e.id = id;
      root.append(e);
      return e;
    };
    this.top = new Panel(
      mk('topbar'),
      () => `${getState().run.system.number}`,
      (b) => this.buildTop(b),
    );
    this.fleet = new Panel(
      mk('fleet'),
      () => {
        const s = getState();
        return s.run.ships.map((x) => `${x.id}:${x.hullId}`).join(',') + `|${fleetCap(s.profile)}`;
      },
      (b) => this.buildFleet(b),
    );
    this.ship = new Panel(
      mk('ship'),
      () => {
        const s = getState();
        const sel = s.run.ships.find((x) => x.id === s.run.selectedId);
        return sel ? `${sel.id}:${sel.hullId}:${sel.slots.map((f) => (f ? f.type + f.tier : '-')).join('.')}` : 'none';
      },
      (b) => this.buildShip(b),
    );
    this.log.id = 'log';
    root.append(this.log);

    this.researchWrap = mk('research', 'modal hidden');
    this.research = new Panel(
      this.researchWrap,
      () => `${getState().profile.warps}`,
      (b) => this.buildResearch(b),
    );
    this.researchWrap.addEventListener('click', (e) => {
      if (e.target === this.researchWrap) this.toggleResearch(false);
    });

    this.help = mk('help');

    this.menu = new Menu(root, actions.saves, settings);
    root.append(this.tooltip, this.flash, this.paused, this.fps);
    settings.onChange(() => this.applySettings());
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings.value;
    this.root.style.setProperty('--hud-scale', String(s.hudScale));
    this.help.classList.toggle('hidden', !s.showHelp);
    // Help text follows the current key bindings.
    const k = (a: keyof typeof s.keys): string => s.keys[a].filter(Boolean).map(keyLabel).join('/') || 'unbound';
    this.help.innerHTML = `
      <b>Flight</b> ${k('up')} ${k('left')} ${k('down')} ${k('right')} · click space to move<br>
      <b>Mine</b> click an asteroid (laser auto-chains fragments)<br>
      <b>Collect</b> fly near debris · <b>Unload</b> click the station<br>
      <b>Fleet</b> click a ship, ${k('cycleShip')} or 1–9 to select · Esc stops<br>
      <b>View</b> wheel zoom · drag to pan · ${k('follow')} follow · ${k('map')} map<br>
      <b>Menus</b> ${k('research')} research · ${k('pause')} pause · ${k('help')} hide help · ⚙ saves & settings`;
    this.fps.classList.toggle('hidden', !s.showFps);
  }

  /** Shows the pause banner with the reason (manual, menu, unfocused). */
  setPaused(reason: string | null): void {
    this.paused.classList.toggle('hidden', !reason);
    if (reason) setText(this.paused, reason);
  }

  /** Called every rendered frame to update the FPS counter. */
  frame(dt: number): void {
    if (!this.settings.value.showFps) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    this.fpsWorst = Math.max(this.fpsWorst, dt);
    if (this.fpsTime >= 0.5) {
      setText(
        this.fps,
        `${Math.round(this.fpsFrames / this.fpsTime)} fps · worst ${(this.fpsWorst * 1000).toFixed(0)} ms`,
      );
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.fpsWorst = 0;
    }
  }

  /** Esc: close the topmost open overlay. Returns true if something closed. */
  escape(): boolean {
    if (this.menu.escape()) return true;
    if (!this.researchWrap.classList.contains('hidden')) {
      this.toggleResearch(false);
      return true;
    }
    return false;
  }

  get researchOpen(): boolean {
    return !this.researchWrap.classList.contains('hidden');
  }

  toggleResearch(force?: boolean): void {
    this.researchWrap.classList.toggle('hidden', force == null ? undefined : !force);
  }

  refresh(warpFlash: number): void {
    const state = this.getState();
    for (const line of state.out.log.splice(0)) this.pushLog(line);
    this.top.refresh();
    this.fleet.refresh();
    this.ship.refresh();
    if (!this.researchWrap.classList.contains('hidden')) this.research.refresh();
    this.flash.style.opacity = warpFlash.toFixed(3);
  }

  private pushLog(entry: LogEntry): void {
    if (entry.level === 'info' && this.settings.value.logVerbosity === 'important') return;
    const row = h('div', { class: entry.level, text: entry.level === 'warn' ? `⚠ ${entry.text}` : entry.text });
    this.log.prepend(row);
    while (this.log.childElementCount > MAX_LOG) this.log.lastElementChild?.remove();
  }

  showTooltip(x: number, y: number, rock: Rock | null, label: string | null): void {
    if (!rock && !label) {
      this.tooltip.style.display = 'none';
      return;
    }
    const text = rock
      ? `${['Large', 'Medium', 'Small'][rock.size]} ${RESOURCE_INFO[rock.kind].name.toLowerCase()} asteroid · ${rock.units} units · ${Math.max(0, Math.ceil((rock.hp / rock.maxHp) * 100))}%`
      : label!;
    setText(this.tooltip, text);
    this.tooltip.style.display = 'block';
    this.tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  }

  // ---------- Top bar ----------
  private buildTop(bind: (b: () => void) => void): Node[] {
    const st = this.getState;
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
    const warp = h('button', { class: 'warp', onclick: () => this.actions.send({ t: 'warp' }) });
    warp.dataset.title =
      'Jump to a fresh system. Resets your fleet and bank; keeps research. Grants Horizon Data based on value delivered this run.';
    const researchBtn = h('button', { text: 'Research', onclick: () => this.toggleResearch() });
    const menu = h('button', {
      class: 'icon gear',
      title: 'Menu: saves & controls',
      onclick: () => this.menu.toggle(),
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
  }

  // ---------- Fleet ----------
  private buildFleet(bind: (b: () => void) => void): Node[] {
    const st = this.getState;
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
        { class: 'shiprow', onclick: () => this.actions.send({ t: 'select', shipId: id }) },
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
            if (cur) this.actions.send({ t: 'aiMode', shipId: id, mode: cur.aiMode === 'assist' ? 'auto' : 'assist' });
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
      const btn = h('button', { class: 'buy', onclick: () => this.actions.send({ t: 'buyHull', hullId: hid }) });
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
  }

  // ---------- Selected ship ----------
  private buildShip(bind: (b: () => void) => void): Node[] {
    const st = this.getState;
    const s0 = st();
    const ship0 = s0.run.ships.find((x) => x.id === s0.run.selectedId);
    if (!ship0) return [h('h3', { text: 'No ship selected' })];
    const id = ship0.id;
    const cur = (): Ship | undefined => st().run.ships.find((x) => x.id === id);
    const send = this.actions.send;

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
          if (!this.settings.value.confirmDestructive || confirm(`Scrap ${ship0.name} for half its value?`))
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
      setText(
        stats,
        `SPD ${k.speed.toFixed(0)} · DPS ${k.dps.toFixed(0)} · RNG ${k.range.toFixed(0)} · MAG ${k.magnet.toFixed(0)} · ARM −${Math.round((1 - k.dmgMul) * 100)}%`,
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
          if (sel.value) send({ t: 'install', shipId: id, slot: i, comp: sel.value as (typeof COMPONENT_IDS)[number] });
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
  }

  // ---------- Research / prestige ----------
  private buildResearch(bind: (b: () => void) => void): Node[] {
    const st = this.getState;
    const box = h('div', { class: 'hud box' });
    const head = h('h2', { text: 'Horizon Research' });
    const intro = h('p', { class: 'dim' });
    bind(() => {
      const s = st();
      setText(
        intro,
        `Warping to a fresh system resets your bank, ships and components but keeps research. You have ✦ ${s.profile.data} Horizon Data (${s.profile.dataEarned} earned over ${s.profile.warps} warps). Warping now earns +${dataGain(s)} HD.`,
      );
    });
    const rows = PERK_IDS.map((pid) => {
      const def = PERKS[pid];
      const desc = h('small');
      const lvl = h('span', { class: 'pips' });
      const btn = h('button', { onclick: () => this.actions.send({ t: 'buyPerk', perk: pid }) });
      bind(() => {
        const s = st();
        const l = s.profile.perks[pid];
        setText(lvl, ` ${l}/${def.max}`);
        setText(desc, l > 0 ? `Now: ${def.describe(l)} · Next: ${def.describe(l + 1)}` : `Next: ${def.describe(1)}`);
        const cost = perkCost(s, pid);
        setText(btn, cost == null ? 'MAX' : `✦ ${cost}`);
        setDisabled(btn, cost == null || s.profile.data < cost, cost == null ? 'Maxed' : 'Not enough Horizon Data');
      });
      return h('div', { class: 'slot' }, h('div', { class: 'nm' }, h('b', { text: def.name }), lvl, desc), btn);
    });
    const close = h('button', { text: 'Close', onclick: () => this.toggleResearch(false) });
    box.append(head, intro, ...rows, h('div', { class: 'row end' }, close));
    return [box];
  }
}
