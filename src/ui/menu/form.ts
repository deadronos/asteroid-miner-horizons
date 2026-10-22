// Settings form rows shared by the menu tabs. Each control writes straight
// back to the SettingsStore.

import type { Settings, SettingsStore } from '../../settings';
import { h } from '../dom';

export type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
export type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
export type SelectKey =
  | 'autosaveSec'
  | 'quality'
  | 'renderScale'
  | 'shake'
  | 'logVerbosity'
  | 'help'
  | 'touchControls'
  | 'hazards'
  | 'autoRepairAt'
  | 'autoReserve';

export function section(title: string): HTMLElement {
  return h('h3', { class: 'section', text: title });
}

export function row(label: string, hint: string, control: HTMLElement, inline = false): HTMLElement {
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

export function toggleRow(settings: SettingsStore, key: BoolKey, label: string, hint = ''): HTMLElement {
  const box = h('input');
  box.type = 'checkbox';
  box.name = key;
  box.checked = settings.value[key];
  box.addEventListener('change', () => settings.set({ [key]: box.checked } as Partial<Settings>));
  return row(label, hint, box, true);
}

export function selectRow<K extends SelectKey>(
  settings: SettingsStore,
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
    o.selected = settings.value[key] === v;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    const picked = options.find(([v]) => String(v) === sel.value);
    if (picked) settings.set({ [key]: picked[0] } as Partial<Settings>);
  });
  return row(label, hint, sel);
}

export function rangeRow(
  settings: SettingsStore,
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
  input.value = String(settings.value[key]);
  input.disabled = disabled;
  const out = h('span', { class: 'val', text: fmt(settings.value[key]) });
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    settings.set({ [key]: Number(input.value) } as Partial<Settings>);
  });
  return row(label, '', h('div', { class: 'rangewrap' }, input, out));
}
