// Gear menu: a tabbed modal. "Saves" manages the 3 localStorage slots
// (load / save / new / delete, import from file or pasted text, export to
// text or a downloaded .json). "Controls" is a key reference.

import { SLOT_COUNT, exportText, parseImport, readSlot, type SaveRecord } from '../sim/save';
import type { GameState } from '../sim/types';
import { KEY_ACTIONS, RESERVED_KEYS, keyLabel, type KeyAction, type Settings, type SettingsStore } from '../settings';
import { h } from './dom';

export interface SaveActions {
  active(): number;
  current(): GameState;
  saveNow(): void;
  load(slot: number): void;
  newGame(slot: number): void;
  importTo(slot: number, record: SaveRecord): void;
  remove(slot: number): void;
}

type Tab = 'saves' | 'gameplay' | 'graphics' | 'interface' | 'controls' | 'audio';

const TABS: [Tab, string][] = [
  ['saves', 'Saves'],
  ['gameplay', 'Gameplay'],
  ['graphics', 'Graphics'],
  ['interface', 'Interface'],
  ['controls', 'Controls'],
  ['audio', 'Audio'],
];

export const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.7 7.7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString();
}

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${Math.floor(sec % 60)}s`;
}

function summary(state: GameState): string[] {
  const { run, profile } = state;
  const b = run.bank;
  return [
    `System ${run.system.number} · ${run.system.name} (${run.system.starClass}-class)`,
    `${profile.warps} warp${profile.warps === 1 ? '' : 's'} · ✦ ${profile.data} HD · ${run.ships.length} ship${run.ships.length === 1 ? '' : 's'} · ${clock(run.time)} in system`,
    `⬢ ${Math.floor(b.ore)}  ❄ ${Math.floor(b.ice)}${b.crystal > 0 ? `  ◆ ${Math.floor(b.crystal)}` : ''}`,
  ];
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileName(state: GameState, slot: number): string {
  const d = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `amh-slot${slot + 1}-sys${state.run.system.number}-${state.run.system.name.toLowerCase()}-${d}.json`;
}

export class Menu {
  readonly el: HTMLElement;
  private box: HTMLElement;
  private body = h('div', { class: 'tab-body' });
  private tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'saves';
  private overlay: HTMLElement | null = null;
  private fileInput = h('input');
  private importSlot = 0;
  private capture: { action: KeyAction; slot: 0 | 1; btn: HTMLButtonElement; note: HTMLElement } | null = null;

  constructor(
    root: HTMLElement,
    private readonly saves: SaveActions,
    private readonly settings: SettingsStore,
  ) {
    window.addEventListener('keydown', this.onCaptureKey, true);
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,.txt,application/json,text/plain';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', this.onFilePicked);

    const tabBar = h('div', { class: 'tabs' });
    for (const [id, label] of TABS) {
      const b = h('button', { class: 'tab', text: label, onclick: () => this.show(id) });
      this.tabs.set(id, b);
      tabBar.append(b);
    }
    const close = h('button', { class: 'icon', text: '✕', title: 'Close (Esc)', onclick: () => this.toggle(false) });
    this.box = h(
      'div',
      { class: 'hud box menu' },
      h('div', { class: 'menu-head' }, tabBar, close),
      this.body,
      this.fileInput,
    );
    this.el = h('div', { class: 'modal hidden' }, this.box);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.toggle(false);
    });
    root.append(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    const open = force ?? !this.open;
    this.el.classList.toggle('hidden', !open);
    if (open) this.show(this.tab);
    else {
      this.closeOverlay();
      this.capture = null;
    }
  }

  /** Esc handling: close a text window first, then the menu. Returns true if it consumed the key. */
  escape(): boolean {
    if (this.overlay) {
      this.closeOverlay();
      return true;
    }
    if (this.open) {
      this.toggle(false);
      return true;
    }
    return false;
  }

  private show(tab: Tab): void {
    this.tab = tab;
    this.capture = null;
    for (const [id, b] of this.tabs) b.classList.toggle('active', id === tab);
    this.closeOverlay();
    const render: Record<Tab, () => Node[]> = {
      saves: () => this.renderSaves(),
      gameplay: () => this.renderGameplay(),
      graphics: () => this.renderGraphics(),
      interface: () => this.renderInterface(),
      controls: () => this.renderControls(),
      audio: () => this.renderAudio(),
    };
    this.body.replaceChildren(...render[tab]());
  }

  private rerender(): void {
    if (this.open) this.show(this.tab);
  }

  // ---------- Saves tab ----------
  private renderSaves(): Node[] {
    const active = this.saves.active();
    const intro = h('p', {
      class: 'dim',
      text: `Three save slots, stored in this browser. The running game autosaves to its slot ${
        this.settings.value.autosaveSec ? `every ${this.settings.value.autosaveSec} seconds and ` : ''
      }when you leave the page. Export a save to keep a backup or move it to another browser.`,
    });
    const cards: Node[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const isActive = i === active;
      // The running game is shown live, not from storage.
      const rec: SaveRecord | null = isActive ? { savedAt: Date.now(), state: this.saves.current() } : readSlot(i);
      const stored = isActive ? readSlot(i) : rec;
      const card = h('div', { class: `slotcard${isActive ? ' active' : ''}${rec ? '' : ' empty'}` });
      const head = h('div', { class: 'slothead' }, h('b', { text: `Slot ${i + 1}` }));
      if (isActive) head.append(h('span', { class: 'badge', text: 'RUNNING' }));
      if (stored) head.append(h('small', { class: 'dim', text: `saved ${ago(stored.savedAt)}` }));
      else if (isActive) head.append(h('small', { class: 'dim', text: 'not saved yet' }));
      card.append(head);

      const btns = h('div', { class: 'row' });
      if (rec) {
        for (const line of summary(rec.state)) card.append(h('div', { class: 'small', text: line }));
        if (isActive) {
          btns.append(
            h('button', {
              text: 'Save now',
              onclick: () => {
                this.saves.saveNow();
                this.rerender();
              },
            }),
          );
        } else {
          btns.append(
            h('button', {
              text: 'Load',
              title: 'Saves the running game to its slot, then switches to this one',
              onclick: () => {
                this.saves.load(i);
                this.toggle(false);
              },
            }),
          );
        }
        btns.append(
          h('button', { text: 'Export…', onclick: () => this.exportWindow(i, rec.state) }),
          h('button', {
            text: 'Download',
            title: 'Download as a .json file',
            onclick: () => download(fileName(rec.state, i), exportText(rec.state)),
          }),
        );
        if (isActive) {
          btns.append(
            h('button', {
              class: 'danger',
              text: 'Restart',
              title: 'Start a brand-new game in this slot (erases it, including research)',
              onclick: () => {
                if (
                  !this.settings.value.confirmDestructive ||
                  confirm(
                    `Start a NEW GAME in slot ${i + 1}? This slot's progress, including research, will be erased.`,
                  )
                ) {
                  this.saves.newGame(i);
                  this.toggle(false);
                }
              },
            }),
          );
        } else {
          btns.append(
            h('button', {
              class: 'danger',
              text: 'Delete',
              onclick: () => {
                if (
                  !this.settings.value.confirmDestructive ||
                  confirm(`Delete the save in slot ${i + 1}? Export it first if you might want it back.`)
                ) {
                  this.saves.remove(i);
                  this.rerender();
                }
              },
            }),
          );
        }
      } else {
        card.append(h('div', { class: 'small dim', text: 'Empty slot' }));
        btns.append(
          h('button', {
            text: 'New game',
            title: 'Saves the running game, then starts a fresh one here',
            onclick: () => {
              this.saves.newGame(i);
              this.toggle(false);
            },
          }),
          h('button', { text: 'Import file…', onclick: () => this.importFile(i) }),
          h('button', { text: 'Paste text…', onclick: () => this.importWindow(i) }),
        );
      }
      card.append(btns);
      cards.push(card);
    }
    return [intro, ...cards];
  }

  private importFile(slot: number): void {
    // One shared listener (registered in the constructor) reads the target slot,
    // so a cancelled file dialog never leaves a stale handler behind.
    this.importSlot = slot;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private onFilePicked = async (): Promise<void> => {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const res = parseImport(await file.text());
    if (!res.ok) {
      alert(`Couldn't import ${file.name}: ${res.error}`);
      return;
    }
    this.saves.importTo(this.importSlot, res.record);
    this.rerender();
  };

  // ---------- Text windows ----------
  private textWindow(
    title: string,
    note: string,
    text: string,
    readOnly: boolean,
    buttons: HTMLElement[],
  ): { area: HTMLTextAreaElement; error: HTMLElement } {
    this.closeOverlay();
    const area = h('textarea');
    area.value = text;
    area.readOnly = readOnly;
    area.spellcheck = false;
    area.name = 'save-json';
    const error = h('div', { class: 'error' });
    const cancel = h('button', { text: readOnly ? 'Close' : 'Cancel', onclick: () => this.closeOverlay() });
    this.overlay = h(
      'div',
      { class: 'textwin' },
      h('h3', { text: title }),
      h('p', { class: 'dim small', text: note }),
      area,
      error,
      h('div', { class: 'row end' }, ...buttons, cancel),
    );
    this.box.append(this.overlay);
    area.focus();
    if (readOnly) area.select();
    return { area, error };
  }

  private exportWindow(slot: number, state: GameState): void {
    const text = exportText(state);
    const copy = h('button', { text: 'Copy' });
    const dl = h('button', { text: 'Download .json', onclick: () => download(fileName(state, slot), text) });
    const { area } = this.textWindow(
      `Export slot ${slot + 1}`,
      `${summary(state)[0]}. Copy this text somewhere safe; paste it into an empty slot to restore it.`,
      text,
      true,
      [copy, dl],
    );
    copy.addEventListener('click', async () => {
      area.select();
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied ✓';
      } catch {
        document.execCommand('copy');
        copy.textContent = 'Copied ✓';
      }
    });
  }

  private importWindow(slot: number): void {
    const go = h('button', { text: 'Import' });
    const { area, error } = this.textWindow(
      `Import into slot ${slot + 1}`,
      'Paste exported save text (JSON) below.',
      '',
      false,
      [go],
    );
    go.addEventListener('click', () => {
      const res = parseImport(area.value);
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      this.saves.importTo(slot, res.record);
      this.rerender();
    });
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  // ---------- Settings tabs ----------
  private renderGameplay(): Node[] {
    return [
      section('Pausing'),
      this.toggleRow('pauseInMenus', 'Pause while menus are open', 'This menu and the Research panel'),
      this.toggleRow('pauseUnfocused', 'Pause when the window loses focus', 'Switching to another app or tab'),
      section('Saving'),
      this.selectRow('autosaveSec', 'Autosave', [
        [0, 'Off (only when leaving the page)'],
        [10, 'Every 10 seconds'],
        [30, 'Every 30 seconds'],
        [60, 'Every minute'],
      ]),
      this.toggleRow(
        'confirmDestructive',
        'Confirm restart, delete and scrap',
        'Ask before erasing a save or scrapping a ship',
      ),
      section('Autopilot assists'),
      this.toggleRow(
        'assistAvoid',
        'Steer around asteroids',
        'Move, dock and mining approaches avoid rocks. Off: straight lines; you may crash.',
      ),
      this.toggleRow(
        'assistAutoDock',
        'Drones unload automatically',
        'Full drones fly home to unload. Off: they wait for a manual dock order.',
      ),
      this.toggleRow(
        'assistChain',
        'Keep mining fragments',
        'After a rock breaks, the laser moves on to the nearest fragment',
      ),
    ];
  }

  private renderGraphics(): Node[] {
    return [
      section('Quality'),
      this.selectRow(
        'quality',
        'Preset',
        [
          ['low', 'Low: 1× resolution, fewer stars & particles'],
          ['medium', 'Medium: up to 1.5× resolution'],
          ['high', 'High: up to 2× resolution, full effects'],
        ],
        "Resolution is capped at your display's pixel density",
      ),
      this.toggleRow('nebula', 'Nebula backdrop'),
      this.toggleRow('antialias', 'Anti-aliasing', 'Smooth edges. Takes effect after reloading the page.'),
      section('Effects'),
      this.selectRow('shake', 'Screen shake', [
        ['off', 'Off'],
        ['low', 'Low'],
        ['full', 'Full'],
      ]),
      this.toggleRow('showFps', 'Show FPS counter'),
    ];
  }

  private renderInterface(): Node[] {
    return [
      section('HUD'),
      this.rangeRow('hudScale', 'HUD scale', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.toggleRow(
        'alwaysShowBars',
        'Always show ship bars',
        'Otherwise only for the selected, damaged or loaded ships',
      ),
      this.toggleRow('showHelp', 'Show help box'),
      this.selectRow(
        'logVerbosity',
        'Event log',
        [
          ['all', 'Everything'],
          ['important', 'Important only'],
        ],
        'Important: warnings, losses and milestones',
      ),
      section('Camera'),
      this.toggleRow(
        'followByDefault',
        'Follow the selected ship',
        'Selecting a ship or flying re-centres the camera. The follow key always toggles it.',
      ),
      this.rangeRow('zoomSpeed', 'Zoom speed', 0.4, 2.5, 0.1, (v) => `${v.toFixed(1)}×`),
      this.toggleRow('edgePan', 'Edge panning', 'Pan by resting the cursor at the screen edge'),
    ];
  }

  private renderAudio(): Node[] {
    return [
      h('p', {
        class: 'dim',
        text: "Sound isn't in the game yet. These levels are saved now and will apply once audio arrives.",
      }),
      this.rangeRow('volMaster', 'Master volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
      this.rangeRow('volSfx', 'Effects', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
      this.rangeRow('volMusic', 'Music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
    ];
  }

  private toggleRow(key: BoolKey, label: string, hint = ''): HTMLElement {
    const box = h('input');
    box.type = 'checkbox';
    box.name = key;
    box.checked = this.settings.value[key];
    box.addEventListener('change', () => this.settings.set({ [key]: box.checked } as Partial<Settings>));
    return row(label, hint, box, true);
  }

  private selectRow<K extends SelectKey>(
    key: K,
    label: string,
    options: [Settings[K], string][],
    hint = '',
  ): HTMLElement {
    const sel = h('select');
    sel.name = key;
    for (const [v, text] of options) {
      const o = h('option', { text });
      o.value = String(v);
      o.selected = this.settings.value[key] === v;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      const picked = options.find(([v]) => String(v) === sel.value);
      if (picked) this.settings.set({ [key]: picked[0] } as Partial<Settings>);
    });
    return row(label, hint, sel);
  }

  private rangeRow(
    key: NumKey,
    label: string,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
    disabled = false,
  ): HTMLElement {
    const input = h('input');
    input.type = 'range';
    input.name = key;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.settings.value[key]);
    input.disabled = disabled;
    const out = h('span', { class: 'val', text: fmt(this.settings.value[key]) });
    input.addEventListener('input', () => {
      out.textContent = fmt(Number(input.value));
      this.settings.set({ [key]: Number(input.value) } as Partial<Settings>);
    });
    return row(label, '', h('div', { class: 'rangewrap' }, input, out));
  }

  // ---------- Controls tab (key rebinding) ----------
  private renderControls(): Node[] {
    const keys = this.settings.value.keys;
    const note = h('div', { class: 'bind-note' });
    const table = h('div', { class: 'binds' });
    table.append(
      h('span', { class: 'dim small', text: 'Action' }),
      h('span', { class: 'dim small', text: 'Primary' }),
      h('span', { class: 'dim small', text: 'Secondary' }),
    );
    for (const { id, label } of KEY_ACTIONS) {
      table.append(h('span', { text: label }));
      for (const slot of [0, 1] as const) {
        const b = h('button', { class: 'bind', text: keyLabel(keys[id][slot]) });
        b.title = 'Click, then press a key. Backspace clears, Esc cancels.';
        b.addEventListener('click', () => this.startCapture(id, slot, b, note));
        table.append(b);
      }
    }
    const fixed: [string, string][] = [
      ['Left-click', 'Select ship · mine rock · dock at station · move'],
      ['Right-click', 'Order without changing selection'],
      ['Drag', 'Pan camera'],
      ['Mouse wheel', 'Zoom'],
      ['1–9', 'Select ship by fleet position'],
      ['Esc', 'Close menus, otherwise stop the selected ship'],
    ];
    const fixedTable = h('div', { class: 'keys' });
    for (const [k, v] of fixed) fixedTable.append(h('kbd', { text: k }), h('span', { text: v }));
    const reset = h('button', {
      text: 'Reset to defaults',
      onclick: () => {
        this.settings.resetKeys();
        this.rerender();
      },
    });
    return [
      section('Keyboard'),
      table,
      note,
      h('div', { class: 'row end' }, reset),
      section('Fixed controls'),
      fixedTable,
    ];
  }

  private startCapture(action: KeyAction, slot: 0 | 1, btn: HTMLButtonElement, note: HTMLElement): void {
    this.capture?.btn.classList.remove('capturing');
    this.capture = { action, slot, btn, note };
    btn.classList.add('capturing');
    btn.textContent = 'Press a key…';
    note.textContent = '';
  }

  /** Keydown in the capture phase: while rebinding, the pressed key is the binding. */
  private onCaptureKey = (e: KeyboardEvent): void => {
    const c = this.capture;
    if (!c) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') {
      this.capture = null;
      this.rerender();
      return;
    }
    if (RESERVED_KEYS.has(e.code)) {
      c.note.textContent = `${keyLabel(e.code)} is reserved and can't be bound.`;
      return;
    }
    const code = e.code === 'Backspace' || e.code === 'Delete' ? null : e.code;
    const stolen = this.settings.bind(c.action, c.slot, code);
    this.capture = null;
    this.rerender();
    if (stolen) {
      const label = KEY_ACTIONS.find((a) => a.id === stolen)?.label ?? stolen;
      const n = this.body.querySelector('.bind-note');
      if (n) n.textContent = `${keyLabel(code)} was unbound from "${label}".`;
    }
  };
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type SelectKey = 'autosaveSec' | 'quality' | 'shake' | 'logVerbosity';

function section(title: string): HTMLElement {
  return h('h3', { class: 'section', text: title });
}

function row(label: string, hint: string, control: HTMLElement, inline = false): HTMLElement {
  const text = h(
    'div',
    { class: 'lbl' },
    h('span', { text: label }),
    hint ? h('small', { class: 'dim', text: hint }) : null,
  );
  if (inline) {
    // Whole row toggles the checkbox.
    return h('label', { class: 'setting' }, text, control);
  }
  return h('div', { class: 'setting' }, text, control);
}
