// A tiny document, enough to build the research, gate and warp dialogs and dispatch Tab.
// The suite stays on the node environment, so this is not a DOM implementation.

export interface FakeEl {
  tag: string;
  readonly tagName: string;
  id: string;
  parent: FakeEl | null;
  childNodes: FakeEl[];
  hidden: boolean;
  disabled: boolean;
  type: string;
  value: string;
  min: string;
  max: string;
  step: string;
  title: string;
  innerHTML: string;
  dataset: Record<string, string>;
  style: {
    width: string;
    display: string;
    opacity: string;
    transform: string;
    setProperty: (k: string, v: string) => void;
  };
  classList: {
    contains: (name: string) => boolean;
    add: (name: string) => void;
    remove: (name: string) => void;
    toggle: (name: string, force?: boolean) => boolean;
  };
  ownerDocument: FakeDoc;
  textContent: string;
  className: string;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  addEventListener: (type: string, fn: (e: Event) => void) => void;
  dispatch: (type: string, event: Event) => void;
  dispatchEvent: (event: Event) => boolean;
  click: () => void;
  append: (...nodes: (FakeEl | string)[]) => void;
  prepend: (...nodes: (FakeEl | string)[]) => void;
  replaceChildren: (...nodes: FakeEl[]) => void;
  remove: () => void;
  querySelectorAll: (selector: string) => FakeEl[];
  getClientRects: () => { length: number };
  focus: () => void;
  closest: (selector: string) => FakeEl | null;
  contains: (node: FakeEl) => boolean;
  isConnected: boolean;
  childElementCount: number;
  lastElementChild: FakeEl | null;
  options: FakeEl[];
}

export interface FakeDoc {
  body: FakeEl;
  activeElement: FakeEl | null;
  createElement: (tag: string) => FakeEl;
  querySelector: (selector: string) => FakeEl | null;
  querySelectorAll: (selector: string) => FakeEl[];
}

const listeners: { type: string; fn: (e: KeyboardEvent) => void }[] = [];

/** Drops elements and key listeners from the previous test. */
export function resetDom(): void {
  listeners.length = 0;
  const doc = createDoc();
  const win = {
    document: doc,
    addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
      listeners.push({ type, fn });
    },
    removeEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.assign(globalThis, { document: doc, window: win, HTMLElement: Object });
}

/** Fires a `keydown` for `key` (its `code` defaults to the key) on every window listener, in order. */
export function pressKey(key: string, shift = false, code = key): void {
  let prevented = false;
  const event = {
    key,
    code,
    shiftKey: shift,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  } as KeyboardEvent;
  for (const l of listeners) if (l.type === 'keydown') l.fn(event);
}

function createDoc(): FakeDoc {
  const doc = {
    activeElement: null as FakeEl | null,
    body: null as unknown as FakeEl,
    createElement(tag: string) {
      return createEl(doc, tag);
    },
    querySelector(selector: string) {
      return matchAll(doc.body, selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return matchAll(doc.body, selector);
    },
  };
  doc.body = createEl(doc, 'body');
  return doc;
}

function createEl(doc: FakeDoc, tag: string): FakeEl {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const elListeners: { type: string; fn: (e: Event) => void }[] = [];
  let text = '';
  const el: FakeEl = {
    tag,
    get tagName() {
      return tag.toUpperCase();
    },
    id: '',
    parent: null,
    childNodes: [],
    hidden: false,
    disabled: false,
    type: '',
    value: '',
    min: '',
    max: '',
    step: '',
    title: '',
    innerHTML: '',
    dataset: {},
    style: { width: '', display: '', opacity: '', transform: '', setProperty: () => {} },
    ownerDocument: doc,
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    get className() {
      return [...classes].join(' ');
    },
    set className(value: string) {
      classes.clear();
      for (const name of value.split(/\s+/)) if (name) classes.add(name);
    },
    get textContent() {
      return text + this.childNodes.map((n) => n.textContent).join('');
    },
    set textContent(value: string) {
      text = value;
      for (const n of el.childNodes) n.parent = null;
      el.childNodes = [];
    },
    setAttribute: (name, value) => attrs.set(name, value),
    getAttribute: (name) => attrs.get(name) ?? null,
    removeAttribute: (name) => {
      attrs.delete(name);
    },
    hasAttribute: (name) => attrs.has(name),
    addEventListener: (type, fn) => {
      elListeners.push({ type, fn });
    },
    dispatch(type, event) {
      for (const l of elListeners) if (l.type === type) l.fn(event);
    },
    dispatchEvent(event) {
      el.dispatch(event.type, event);
      return true;
    },
    click() {
      el.dispatch('click', { target: el } as unknown as Event);
    },
    append(...nodes) {
      for (const n of nodes) {
        const node = typeof n === 'string' ? textNode(doc, n) : n;
        node.parent = el;
        el.childNodes.push(node);
      }
    },
    prepend(...nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]!;
        const node = typeof n === 'string' ? textNode(doc, n) : n;
        node.parent = el;
        el.childNodes.unshift(node);
      }
    },
    replaceChildren(...nodes) {
      for (const n of el.childNodes) n.parent = null;
      el.childNodes = [];
      el.append(...nodes);
    },
    remove() {
      if (!el.parent) return;
      const i = el.parent.childNodes.indexOf(el);
      if (i >= 0) el.parent.childNodes.splice(i, 1);
      el.parent = null;
    },
    get childElementCount() {
      return el.childNodes.length;
    },
    get lastElementChild() {
      return el.childNodes[el.childNodes.length - 1] ?? null;
    },
    get options() {
      return el.childNodes;
    },
    querySelectorAll: (selector) => matchAll(el, selector),
    getClientRects: () => ({ length: shown(el) ? 1 : 0 }),
    focus() {
      doc.activeElement = el;
    },
    get isConnected() {
      let n: FakeEl | null = el;
      while (n) {
        if (n.tag === 'body') return true;
        n = n.parent;
      }
      return false;
    },
    closest(selector) {
      let n: FakeEl | null = el;
      while (n) {
        if (hit(n, selector)) return n;
        n = n.parent;
      }
      return null;
    },
    contains(node) {
      let n: FakeEl | null = node;
      while (n) {
        if (n === el) return true;
        n = n.parent;
      }
      return false;
    },
  };
  return el;
}

/** A text node: only `parent`, `tag` and `textContent` matter to the walkers below. */
function textNode(doc: FakeDoc, text: string): FakeEl {
  const node = createEl(doc, '#text');
  node.textContent = text;
  return node;
}

function shown(el: FakeEl): boolean {
  let n: FakeEl | null = el;
  let connected = false;
  while (n) {
    if (n.hidden || n.classList.contains('hidden')) return false;
    if (n.tag === 'body') connected = true;
    n = n.parent;
  }
  return connected;
}

function matchAll(root: FakeEl, selector: string): FakeEl[] {
  const parts = selector.split(',').map((s) => s.trim());
  const all: FakeEl[] = [];
  const walk = (node: FakeEl): void => {
    for (const child of node.childNodes) {
      all.push(child);
      walk(child);
    }
  };
  walk(root);
  return all.filter((el) => parts.some((part) => hit(el, part)));
}

function hit(el: FakeEl, selector: string): boolean {
  if (selector === '.modal') return el.classList.contains('modal');
  if (selector === '.modal:not(.hidden)') return el.classList.contains('modal') && !el.classList.contains('hidden');
  if (selector === '#boot:not([hidden])') return el.id === 'boot' && !el.hidden;
  if (selector === '.hud-stack') return el.classList.contains('hud-stack');
  if (selector === '.shiprow') return el.classList.contains('shiprow');
  if (selector === '.tabs') return el.classList.contains('tabs');
  if (selector === 'select') return el.tag === 'select';
  if (selector === 'h3') return el.tag === 'h3';
  if (selector === '#log') return el.id === 'log';
  if (selector === '#fleet') return el.id === 'fleet';
  if (selector === '#ship') return el.id === 'ship';
  if (selector === '.doctrine') return el.classList.contains('doctrine');
  if (selector === '.doctrine button')
    return el.tag === 'button' && el.closest('.doctrine') !== el && !!el.closest('.doctrine');
  if (selector === 'button:not([disabled])') return el.tag === 'button' && !el.disabled;
  if (selector === 'input:not([disabled]):not([type="hidden"])')
    return el.tag === 'input' && !el.disabled && el.type !== 'hidden';
  if (selector === 'button.warp') return el.tag === 'button' && el.classList.contains('warp');
  if (selector === 'button') return el.tag === 'button';
  if (selector === 'div') return el.tag === 'div';
  return false;
}
