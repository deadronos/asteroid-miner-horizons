// Tab cycle for stacked modals. The gate summary opens on top of Research, and
// Research's key listener is registered first. Only the topmost visible .modal
// moves focus, and it still does so if an earlier listener called preventDefault.

import { FOCUSABLE, nextFocusIndex } from './focus';

/** The element to restore when a modal closes. Ignores the document body and non-elements. */
export function previousFocus(active: Element | null): HTMLElement | null {
  if (!active || active === active.ownerDocument.body) return null;
  if (typeof HTMLElement !== 'undefined' && !(active instanceof HTMLElement)) return null;
  return active as HTMLElement;
}

/** True when `el` is the last `.modal` in the document that is not `.hidden`. */
export function isTopModal(el: HTMLElement): boolean {
  if (el.classList.contains('hidden')) return false;
  const modals = [...el.ownerDocument.querySelectorAll('.modal')];
  for (let i = modals.length - 1; i >= 0; i--) {
    const node = modals[i]!;
    if (node.classList.contains('hidden')) continue;
    return node === el;
  }
  return false;
}

/**
 * Tab and arrows cycle `el` when it is the topmost visible modal.
 * Does not look at `defaultPrevented`: a dialog underneath may already have
 * claimed the event, and that must not open a hole out of this one.
 */
export function trapModalTab(el: HTMLElement, e: KeyboardEvent): void {
  if (el.classList.contains('hidden') || e.ctrlKey || e.altKey || e.metaKey) return;
  if (!isTopModal(el)) return;
  const tab = e.key === 'Tab';
  const arrows = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  if (!tab && !arrows) return;
  const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
  const backward = e.key === 'Tab' ? e.shiftKey : e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  const at = items.indexOf(document.activeElement as HTMLElement);
  const dest = items[nextFocusIndex(items.length, at, backward)];
  e.preventDefault();
  dest?.focus();
}
