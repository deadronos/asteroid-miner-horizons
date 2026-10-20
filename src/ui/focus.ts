// Focus-trap index maths for modals. Pure so it can be tested without a DOM.

/** Elements that take part in the modal's Tab cycle. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Index to focus after Tab (`shift` false) or Shift+Tab (`shift` true), wrapping at both ends.
 * A current index outside the list enters at the matching end; `count` 0 returns -1.
 */
export function nextFocusIndex(count: number, currentIndex: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= count) return shift ? count - 1 : 0;
  return (currentIndex + (shift ? -1 : 1) + count) % count;
}
