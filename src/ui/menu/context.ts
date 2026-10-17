// What the Menu shell hands to its tabs.

import type { SettingsStore } from '../../settings';

export interface MenuCtx {
  settings: SettingsStore;
  /** Re-renders the current tab (no-op while the menu is closed). */
  rerender(): void;
  /** Closes the whole menu. */
  close(): void;
  /** Shows a text window over the menu, replacing any open one. */
  showOverlay(el: HTMLElement): void;
  closeOverlay(): void;
}
