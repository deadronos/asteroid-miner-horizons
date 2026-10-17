// Tiny DOM toolkit for the HUD. Panels are built once per "structure key"
// and then refreshed in place via binders, so buttons are never destroyed
// mid-click (a rebuild only happens when the structure actually changes).

export type Binder = () => void;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { class?: string; text?: string; title?: string; onclick?: (e: MouseEvent) => void } = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs.class) e.className = attrs.class;
  if (attrs.text != null) e.textContent = attrs.text;
  if (attrs.title) e.title = attrs.title;
  if (attrs.onclick) (e as HTMLElement).addEventListener('click', attrs.onclick);
  for (const c of children) if (c) e.append(c);
  return e;
}

/** A panel whose contents are rebuilt only when `key()` changes. */
export class Panel {
  private binders: Binder[] = [];
  private lastKey = '';

  constructor(
    readonly el: HTMLElement,
    private readonly key: () => string,
    private readonly build: (bind: (b: Binder) => void) => Node[],
  ) {}

  refresh(): void {
    const k = this.key();
    if (k !== this.lastKey) {
      this.lastKey = k;
      this.binders = [];
      this.el.replaceChildren(...this.build((b) => this.binders.push(b)));
    }
    for (const b of this.binders) b();
  }

  invalidate(): void {
    this.lastKey = '';
  }
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setDisabled(btn: HTMLButtonElement, disabled: boolean, reason = ''): void {
  if (btn.disabled !== disabled) btn.disabled = disabled;
  const t = disabled ? reason : '';
  if (btn.dataset.reason !== t) {
    btn.dataset.reason = t;
    btn.title = t || btn.dataset.title || '';
  }
}

export function bar(cls: string): { el: HTMLElement; set: (f: number, label?: string) => void } {
  const fill = h('div', { class: 'fill' });
  const label = h('span', { class: 'label' });
  const el = h('div', { class: `bar ${cls}` }, fill, label);
  return {
    el,
    set(f, text = '') {
      fill.style.width = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`;
      setText(label, text);
    },
  };
}
