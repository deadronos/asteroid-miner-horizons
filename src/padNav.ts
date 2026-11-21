// Gamepad navigation for open modal overlays and the title screen (#209).
// Moves focus with the D-pad, steps focused range sliders with Left/Right,
// clicks with A, and closes the topmost overlay with B or Start.

import { PAD } from './gamepad';
import { FOCUSABLE, nextFocusIndex } from './ui/focus';

/** Topmost open overlay that captures gamepad navigation: `.modal` takes precedence over `#boot`. */
export function activeOverlay(doc: Document = document): HTMLElement | null {
  return (
    [...doc.querySelectorAll<HTMLElement>('.modal:not(.hidden)')].pop() ??
    [...doc.querySelectorAll<HTMLElement>('#boot:not([hidden])')].pop() ??
    null
  );
}

/** Steps an `<input type="range">` by one step in `dir`, clamping to min/max and dispatching input/change. */
export function stepRange(input: HTMLInputElement, dir: -1 | 1): void {
  const min = input.min !== '' ? Number(input.min) : 0;
  const max = input.max !== '' ? Number(input.max) : 100;
  const step = input.step && input.step !== 'any' ? Number(input.step) : 1;
  const cur = Number(input.value);
  if (!Number.isFinite(cur) || !Number.isFinite(step) || step <= 0) return;
  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length);
  const next = Math.min(max, Math.max(min, Number((cur + dir * step).toFixed(decimals))));
  if (next === cur) return;
  input.value = String(next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Pad control of an open overlay: D-pad steps focus (or adjusts range sliders), A presses, B/Start close. */
export function padNavigate(overlay: HTMLElement, edges: number[], canClose: boolean, onClose: () => void): void {
  const items = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
  for (const b of edges) {
    document.body.dataset.pad = '1';
    const cur = items.indexOf(document.activeElement as HTMLElement);
    if (b === PAD.LEFT || b === PAD.RIGHT) {
      const active = cur >= 0 ? items[cur] : null;
      if (active && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'range') {
        stepRange(active as HTMLInputElement, b === PAD.LEFT ? -1 : 1);
        continue;
      }
    }
    if (b === PAD.UP || b === PAD.DOWN || b === PAD.LEFT || b === PAD.RIGHT) {
      const prev = b === PAD.UP || b === PAD.LEFT;
      items[nextFocusIndex(items.length, cur, prev)]?.focus();
    } else if (b === PAD.A) {
      if (cur < 0) items[0]?.focus();
      else items[cur].click();
    } else if ((b === PAD.B || b === PAD.START) && canClose) {
      onClose();
    }
  }
}
