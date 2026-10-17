// Saves tab: the 3 localStorage slots (load / save / new / delete), import
// from a file or pasted text, export to text or a downloaded .json.

import type { SaveActions } from '../../session';
import { SLOT_COUNT, exportText, parseImport, readSlot, type SaveRecord } from '../../sim/save';
import type { GameState } from '../../sim/types';
import { h } from '../dom';
import type { MenuCtx } from './context';

// The save-slot actions this tab drives are declared with the session that
// implements them; re-exported so Menu keeps its existing surface.
export type { SaveActions };

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
      this.ctx.rerender();
    });
  }
}
