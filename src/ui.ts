// DOM HUD: top bar, fleet/ship panel, event log, help. Re-rendered on refresh().
import { COMPONENTS, TUNING, type SlotKey } from './config';
import {
  buyDrone,
  buyUpgrade,
  canWarp,
  doWarp,
  drainEvents,
  repairCost,
  repairShip,
  selectedShip,
  shipStats,
  upgradeCost,
  warpCost,
  type GameState,
  type Ship,
} from './world';

function el(tag: string, cls = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function pips(level: number, max: number): string {
  return '●'.repeat(level) + '○'.repeat(Math.max(0, max - level));
}

export class UI {
  private top!: HTMLElement;
  private panel!: HTMLElement;
  private logBox!: HTMLElement;
  private logLines: string[] = [];

  constructor(private root: HTMLElement) {
    const scene = el('div');
    scene.id = 'scene';
    root.appendChild(scene);

    this.top = el('div', 'hud');
    this.top.id = 'topbar';
    root.appendChild(this.top);

    this.panel = el('div', 'hud');
    this.panel.id = 'panel';
    root.appendChild(this.panel);

    this.logBox = el('div', 'hud');
    this.logBox.id = 'log';
    root.appendChild(this.logBox);

    const help = el('div', 'hud');
    help.id = 'help';
    help.innerHTML =
      '<b>WASD / arrows</b> fly · <b>click space</b> move<br>' +
      '<b>click rock</b> mining laser · <b>click ship / Tab</b> select<br>' +
      '<b>wheel</b> zoom · <b>Esc</b> cancel orders<br>' +
      'Fly over debris to collect. Ice fuels warp.';
    root.appendChild(help);
  }

  get sceneContainer(): HTMLElement {
    return this.root.querySelector('#scene') as HTMLElement;
  }

  pushLog(lines: string[]): void {
    for (const l of lines) {
      this.logLines.unshift(l);
      const d = el('div', '', l);
      this.logBox.prepend(d);
    }
    while (this.logBox.children.length > 40) this.logBox.lastChild?.remove();
  }

  refresh(state: GameState): void {
    this.pushLog(drainEvents(state));
    this.renderTop(state);
    this.renderPanel(state);
  }

  private renderTop(state: GameState): void {
    const t = this.top;
    t.innerHTML = '';
    const cargoTotal = state.cargo.ore + state.cargo.ice;
    t.appendChild(el('span', 'sys', `SYS-${state.systemIndex}`));
    if (state.prestige > 0) t.appendChild(el('span', 'sys', `✦${state.prestige}`));
    t.appendChild(el('span', 'res ore', `⬢ ${Math.floor(state.cargo.ore)} ore`));
    t.appendChild(el('span', 'res ice', `❄ ${Math.floor(state.cargo.ice)} ice`));
    t.appendChild(el('span', 'res', `▤ ${cargoTotal}/${TUNING.cargoCap}`));
    t.appendChild(el('span', 'res', `⛏ ${state.asteroids.length} rocks`));

    const warp = document.createElement('button');
    warp.className = 'warp';
    warp.textContent = `WARP ▸ ${warpCost(state)}❄`;
    warp.disabled = !canWarp(state);
    warp.title = `Warp to a fresh system (+${Math.round(TUNING.prestigeYieldBonus * 100)}% yield, +${Math.round(TUNING.prestigeSpeedBonus * 100)}% speed)`;
    warp.onclick = () => doWarp(state);
    t.appendChild(warp);

    const drone = document.createElement('button');
    drone.textContent = `+Drone ${TUNING.droneOreCost}⬢ ${TUNING.droneIceCost}❄`;
    const fleetSize = state.ships.filter((s) => s.alive).length;
    drone.disabled =
      fleetSize >= TUNING.maxFleet ||
      state.cargo.ore < TUNING.droneOreCost ||
      state.cargo.ice < TUNING.droneIceCost;
    drone.title = 'Autonomous mining drone: follows, assists, hauls';
    drone.onclick = () => buyDrone(state);
    t.appendChild(drone);
  }

  private renderPanel(state: GameState): void {
    const p = this.panel;
    p.innerHTML = '';
    p.appendChild(el('h3', '', `Fleet (${state.ships.filter((s) => s.alive).length}/${TUNING.maxFleet})`));
    for (const s of state.ships) {
      const row = el('div', `shiprow${s.id === state.selectedId ? ' sel' : ''}${s.alive ? '' : ' dead'}`);
      row.appendChild(el('span', '', `${s.drone ? '▸' : '★'} ${s.name}`));
      row.appendChild(el('span', '', s.alive ? `${Math.ceil(s.hull)}` : 'LOST'));
      if (s.alive) {
        const id = s.id;
        row.onclick = () => {
          state.selectedId = id;
        };
      }
      p.appendChild(row);
    }
    const ship = selectedShip(state);
    if (!ship) {
      p.appendChild(el('h3', '', 'No ship selected'));
      return;
    }
    p.appendChild(el('h3', '', ship.name));
    this.renderBar(p, 'hull', ship.hull, ship.maxHull, `Hull ${Math.ceil(ship.hull)}/${ship.maxHull}`);
    const st = shipStats(ship, state.prestige);
    this.renderBar(p, 'shield', ship.shield, st.shieldMax, `Shield ${Math.ceil(ship.shield)}/${st.shieldMax}`);
    const info = el('div', '', '');
    info.style.cssText = 'font-size:12px;color:var(--dim);margin-bottom:6px;';
    info.textContent =
      `SPD ${st.speed.toFixed(0)} · DPS ${st.dps.toFixed(0)} · RNG ${st.range.toFixed(0)} · ` +
      `MAG ${st.pickupRadius.toFixed(0)}`;
    p.appendChild(info);

    const rep = document.createElement('button');
    const rc = repairCost(ship);
    rep.textContent = rc > 0 ? `Repair hull (${rc}⬢)` : 'Hull full';
    rep.disabled = rc <= 0 || state.cargo.ore < rc;
    rep.onclick = () => repairShip(state, ship.id);
    p.appendChild(rep);

    p.appendChild(el('h3', '', 'Components'));
    (Object.keys(COMPONENTS) as SlotKey[]).forEach((key) => {
      const def = COMPONENTS[key];
      const lvl = ship.slots[key];
      const row = el('div', 'slot');
      const nm = el('div', 'nm', `${def.name} `);
      nm.appendChild(el('span', 'pips', pips(lvl, def.maxLevel)));
      const blurb = el('small', '', def.blurb);
      nm.appendChild(blurb);
      row.appendChild(nm);
      const b = document.createElement('button');
      const cost = upgradeCost(ship, key);
      if (cost == null) {
        b.textContent = 'MAX';
        b.disabled = true;
      } else {
        b.textContent = `${cost}⬢`;
        b.disabled = state.cargo.ore < cost;
        b.onclick = () => buyUpgrade(state, ship.id, key);
      }
      row.appendChild(b);
      p.appendChild(row);
    });
    void this.logLines;
  }

  private renderBar(parent: HTMLElement, cls: string, v: number, max: number, label: string): void {
    const t = el('div', '', label);
    t.style.fontSize = '12px';
    parent.appendChild(t);
    const bar = el('div', `bar ${cls}`);
    const fill = el('div');
    fill.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    bar.appendChild(fill);
    parent.appendChild(bar);
  }
}

export type { Ship };
