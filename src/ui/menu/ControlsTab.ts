// Controls tab: key rebinding table plus the fixed mouse/key reference.
// While a binding button is armed, a capture-phase keydown listener takes
// the next key press as the new binding.

import { KEY_ACTIONS, RESERVED_KEYS, keyLabel, type KeyAction } from '../../settings';
import { h } from '../dom';
import type { MenuCtx } from './context';
import { section } from './form';

export class ControlsTab {
  private capture: { action: KeyAction; slot: 0 | 1; btn: HTMLButtonElement; note: HTMLElement } | null = null;
  /** The note line of the most recent render, for messages shown after a rerender. */
  private note: HTMLElement | null = null;

  constructor(private readonly ctx: MenuCtx) {
    window.addEventListener('keydown', this.onCaptureKey, true);
  }

  /** Disarms any pending key capture (tab switch or menu close). */
  cancel(): void {
    this.capture = null;
  }

  render(): Node[] {
    const keys = this.ctx.settings.value.keys;
    const note = h('div', { class: 'bind-note' });
    this.note = note;
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
        this.ctx.settings.resetKeys();
        this.ctx.rerender();
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
      this.ctx.rerender();
      return;
    }
    if (RESERVED_KEYS.has(e.code)) {
      c.note.textContent = `${keyLabel(e.code)} is reserved and can't be bound.`;
      return;
    }
    const code = e.code === 'Backspace' || e.code === 'Delete' ? null : e.code;
    const stolen = this.ctx.settings.bind(c.action, c.slot, code);
    this.capture = null;
    this.ctx.rerender();
    if (stolen && this.note) {
      const label = KEY_ACTIONS.find((a) => a.id === stolen)?.label ?? stolen;
      this.note.textContent = `${keyLabel(code)} was unbound from "${label}".`;
    }
  };
}
