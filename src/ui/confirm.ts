// Lightweight accessible in-app confirmation modal (#273). Replaces native
// window.confirm() so keyboard (Tab/Arrows/Esc), touch and gamepad (D-pad/A/B)
// all work through the same .modal overlay conventions.

import { h } from './dom';
import { closeTopModal, isTopModal, previousFocus, trapModalTab } from './modalKey';

export interface ConfirmOptions {
  /** Heading shown at the top of the dialog. Defaults to "Confirm". */
  title?: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as destructive (`.danger`). Defaults to true. */
  danger?: boolean;
}

interface ActiveConfirm {
  el: HTMLElement;
  finish: (ok: boolean) => void;
}

let active: ActiveConfirm | null = null;
let seq = 0;

/** True while an in-app confirmation dialog is open. */
export function confirmOpen(): boolean {
  return active !== null && !active.el.classList.contains('hidden');
}

/** Closes the active confirmation dialog (as Cancel) when it is the topmost modal. */
export function closeConfirm(): boolean {
  if (!active) return false;
  const cur = active;
  return closeTopModal([{ el: cur.el, close: () => cur.finish(false) }]);
}

/**
 * Shows an accessible in-app confirmation modal and resolves to true if confirmed
 * or false if cancelled (via Cancel button, backdrop click, Esc, or gamepad B).
 */
export function confirmAction(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (active) active.finish(false);
  const id = ++seq;
  const titleId = `confirm-title-${id}`;
  const msgId = `confirm-msg-${id}`;
  const returnTo = previousFocus(document.activeElement);

  return new Promise<boolean>((resolve) => {
    const el = h('div', { class: 'modal confirm-modal' });
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', titleId);
    el.setAttribute('aria-describedby', msgId);

    const heading = h('h2', { text: opts.title ?? 'Confirm' });
    heading.id = titleId;
    const body = h('p', { text: message });
    body.id = msgId;

    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      if (active?.el === el) active = null;
      window.removeEventListener('keydown', onKey);
      el.classList.add('hidden');
      el.remove();
      if (returnTo?.isConnected) returnTo.focus();
      resolve(ok);
    };

    const cancelBtn = h('button', {
      text: opts.cancelLabel ?? 'Cancel',
      onclick: () => finish(false),
    });
    cancelBtn.type = 'button';

    const okBtn = h('button', {
      class: opts.danger === false ? '' : 'danger',
      text: opts.confirmLabel ?? 'Confirm',
      onclick: () => finish(true),
    });
    okBtn.type = 'button';

    const box = h(
      'div',
      { class: 'hud box confirm-box' },
      heading,
      body,
      h('div', { class: 'row end' }, cancelBtn, okBtn),
    );
    el.append(box);
    el.addEventListener('click', (e) => {
      if (e.target === el) finish(false);
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isTopModal(el)) {
        e.preventDefault();
        finish(false);
        return;
      }
      trapModalTab(el, e);
    };
    window.addEventListener('keydown', onKey);

    active = { el, finish };
    document.body.append(el);
    cancelBtn.focus();
  });
}
