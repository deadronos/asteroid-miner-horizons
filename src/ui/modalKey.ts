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

/** The last `.modal` in the document that is not `.hidden`: the dialog on top, or null when none is open. */
export function topModal(): HTMLElement | null {
  const modals = [...document.querySelectorAll<HTMLElement>('.modal')];
  for (let i = modals.length - 1; i >= 0; i--) if (!modals[i]!.classList.contains('hidden')) return modals[i]!;
  return null;
}

/** True when `el` is the dialog on top, so Esc and the gamepad act on it rather than one underneath. */
export function isTopModal(el: HTMLElement): boolean {
  return !el.classList.contains('hidden') && topModal() === el;
}

/**
 * Closes the topmost visible `.modal` when it is one of `dialogs`.
 * Esc and the gamepad's B share this, so they close what is drawn on top.
 */
export function closeTopModal(dialogs: readonly { el: HTMLElement; close: () => void }[]): boolean {
  const top = topModal();
  const hit = top ? dialogs.find((d) => d.el === top) : undefined;
  if (!hit) return false;
  hit.close();
  return true;
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
