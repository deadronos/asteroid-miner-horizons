// Saves tab: the 3 localStorage slots (load / save / new / delete), import
// from a file or pasted text, export to compact text or a downloaded .json.
// A slot whose save this build can't read shows why, offers its raw text, and
// asks before anything replaces it.

import { formatDuration } from '../../core/format';
import type { SaveActions } from '../../session';
import {
  MAX_IMPORT_JSON_BYTES,
  SLOT_COUNT,
  exportCompact,
  exportText,
  isCompactText,
  parseImportText,
  type SaveRecord,
  type SlotStatus,
  slotStatus,
} from '../../sim/save';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import type { MenuCtx } from './context';

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 86400) return `${formatDuration(s, { seconds: s < 60 })} ago`;
  return new Date(ms).toLocaleString();
}

function summary(state: GameState): string[] {
  const { run, profile } = state;
  const b = run.bank;
  return [
    `System ${run.system.number} · ${run.system.name} (${run.system.starClass}-class)`,
    `${profile.warps} warp${profile.warps === 1 ? '' : 's'} · ✦ ${profile.data} HD · ${run.ships.length} ship${run.ships.length === 1 ? '' : 's'} · ${formatDuration(run.time, { seconds: true })} in system`,
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

/** Minute-precision timestamp for download file names. */
const stamp = (): string => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function fileName(state: GameState, slot: number): string {
  return `amh-slot${slot + 1}-sys${state.run.system.number}-${state.run.system.name.toLowerCase()}-${stamp()}.json`;
}

function rawFileName(slot: number): string {
  return `amh-slot${slot + 1}-unreadable-${stamp()}.json`;
}

export class SavesTab {
  readonly fileInput = h('input');
  private importSlot = 0;

  constructor(
    private readonly saves: SaveActions,
    private readonly ctx: MenuCtx,
  ) {
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,.txt,application/json,text/plain';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', this.onFilePicked);
  }

  render(): Node[] {
    const active = this.saves.active();
    const intro = h('p', {
      class: 'dim',
      text: `Three save slots, stored in this browser. The running game autosaves to its slot ${
        this.ctx.settings.value.autosaveSec ? `every ${this.ctx.settings.value.autosaveSec} seconds and ` : ''
      }when you leave the page. Export a save to keep a backup or move it to another browser.`,
    });
    const cards: Node[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const isActive = i === active;
      const st = slotStatus(i);
      // Unless the running game is kept unsaved on top of it, an unreadable save gets its own card.
      if (st.kind === 'unreadable' && !(isActive && this.saves.saving())) {
        cards.push(this.unreadableCard(i, st, isActive));
        continue;
      }
      const stored = st.kind === 'ok' ? st.record : null;
      // The running game is shown live, not from storage.
      const rec: SaveRecord | null = isActive ? { savedAt: Date.now(), state: this.saves.current() } : stored;
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
                this.ctx.rerender();
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
                this.ctx.close();
              },
            }),
          );
        }
        btns.append(
          h('button', { text: 'Export…', onclick: () => void this.exportWindow(i, rec.state) }),
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
                  !this.ctx.settings.value.confirmDestructive ||
                  confirm(
                    `Start a NEW GAME in slot ${i + 1}? This slot's progress, including research, will be erased.`,
                  )
                ) {
                  this.saves.newGame(i);
                  this.ctx.close();
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
                  !this.ctx.settings.value.confirmDestructive ||
                  confirm(`Delete the save in slot ${i + 1}? Export it first if you might want it back.`)
                ) {
                  this.saves.remove(i);
                  this.ctx.rerender();
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
              this.ctx.close();
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

  /** A slot holding text this build can't load: the reason, its raw text, and confirmed ways to replace it. */
  private unreadableCard(i: number, st: Extract<SlotStatus, { kind: 'unreadable' }>, running: boolean): HTMLElement {
    const card = h('div', { class: 'slotcard unreadable' });
    const head = h('div', { class: 'slothead' }, h('b', { text: `Slot ${i + 1}` }));
    if (running) head.append(h('span', { class: 'badge', text: 'RUNNING · NOT SAVED' }));
    head.append(h('span', { class: 'badge bad', text: "CAN'T LOAD" }));
    card.append(
      head,
      h('div', { class: 'small', text: st.reason }),
      h('div', {
        class: 'small dim',
        text: `${st.raw.length < 1024 ? `${st.raw.length} bytes` : `${(st.raw.length / 1024).toFixed(1)} KB`} kept as-is. Export the raw text to keep a copy, or to load it in a newer version.`,
      }),
    );
    // Always confirmed: unlike a readable save, this one can't be re-exported later from its card's summary.
    const replace =
      (what: string, act: () => void): (() => void) =>
      () => {
        if (confirm(`${what} in slot ${i + 1}? The unreadable save there will be lost unless you exported it.`)) act();
      };
    const btns = h('div', { class: 'row' });
    btns.append(
      h('button', { text: 'Export raw…', onclick: () => this.rawWindow(i, st.raw) }),
      h('button', {
        text: 'Download raw',
        title: 'Download the stored text exactly as it is',
        onclick: () => download(rawFileName(i), st.raw),
      }),
    );
    if (!running) {
      btns.append(
        h('button', {
          text: 'New game',
          title: 'Saves the running game, then starts a fresh one here',
          onclick: replace('Start a new game', () => {
            this.saves.newGame(i);
            this.ctx.close();
          }),
        }),
        h('button', { text: 'Import file…', onclick: replace('Import a save', () => this.importFile(i)) }),
        h('button', { text: 'Paste text…', onclick: replace('Import a save', () => this.importWindow(i)) }),
      );
    }
    btns.append(
      h('button', {
        class: 'danger',
        text: 'Delete',
        onclick: () => {
          const then = running ? ' The running game will save there from now on.' : '';
          if (confirm(`Delete the unreadable save in slot ${i + 1}? It is gone unless you exported it.${then}`)) {
            this.saves.remove(i);
            this.ctx.rerender();
          }
        },
      }),
    );
    card.append(btns);
    return card;
  }

  private rawWindow(slot: number, raw: string): void {
    const dl = h('button', { text: 'Download', onclick: () => download(rawFileName(slot), raw) });
    this.textWindow(
      `Raw save text, slot ${slot + 1}`,
      "This build can't load it. Keep a copy; a newer version may import it.",
      raw,
      true,
      [dl],
    );
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
    if (file.size > MAX_IMPORT_JSON_BYTES) {
      alert(`Couldn't import ${file.name}: it is too large to be a save.`);
      return;
    }
    const res = await parseImportText(await file.text());
    if (!res.ok) {
      alert(`Couldn't import ${file.name}: ${res.error}`);
      return;
    }
    this.saves.importTo(this.importSlot, res.record);
    this.ctx.rerender();
  };

  // ---------- Text windows ----------
  private textWindow(
    title: string,
    note: string,
    text: string,
    readOnly: boolean,
    buttons: HTMLElement[],
  ): { area: HTMLTextAreaElement; error: HTMLElement } {
    const area = h('textarea');
    area.value = text;
    area.readOnly = readOnly;
    area.spellcheck = false;
    area.name = 'save-json';
    const error = h('div', { class: 'error' });
    const cancel = h('button', { text: readOnly ? 'Close' : 'Cancel', onclick: () => this.ctx.closeOverlay() });
    const win = h(
      'div',
      { class: 'textwin' },
      h('h3', { text: title }),
      h('p', { class: 'dim small', text: note }),
      area,
      error,
      h('div', { class: 'row end' }, ...buttons, cancel),
    );
    this.ctx.showOverlay(win);
    area.focus();
    if (readOnly) area.select();
    return { area, error };
  }

  private async exportWindow(slot: number, state: GameState): Promise<void> {
    let text: string;
    try {
      text = await exportCompact(state);
    } catch {
      alert(`Couldn't export slot ${slot + 1}. Try Download instead.`);
      return;
    }
    const copy = h('button', { text: 'Copy' });
    const dl = h('button', {
      text: 'Download .json',
      onclick: () => download(fileName(state, slot), exportText(state)),
    });
    const { area } = this.textWindow(
      `Export slot ${slot + 1}`,
      `${summary(state)[0]}. Copy this text somewhere safe; paste it into an empty slot to restore it.` +
        (isCompactText(text) ? '' : " This browser can't compress saves, so it is the full JSON."),
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
      'Paste exported save text (or a downloaded .json) below.',
      '',
      false,
      [go],
    );
    go.addEventListener('click', async () => {
      const res = await parseImportText(area.value);
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      this.saves.importTo(slot, res.record);
      this.ctx.rerender();
    });
  }
}
