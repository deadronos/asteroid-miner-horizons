// HUD density rules (#161): when the help box shows, which side panels are collapsed and whether the touch
// controls show (#194). Pure, so tests can check them without a DOM; Hud applies the results as classes.

import { HUD_PANEL_IDS, type HelpMode, type HudCollapse, type HudPanelId, type TouchMode } from '../settings';
import type { GameState } from '../sim/types';

/** Lifetime play time, in seconds, after which `auto` help hides itself. */
export const HELP_AUTO_HIDE_SEC = 180;

/** Whether the help box shows for `mode` after `playSec` seconds of lifetime play. */
export function helpVisible(mode: HelpMode, playSec: number): boolean {
  if (mode === 'auto') return playSec < HELP_AUTO_HIDE_SEC;
  return mode === 'on';
}

/** Whether the touch controls show for `mode` on a device whose primary pointer is (or is not) coarse. */
export function touchControlsShown(mode: TouchMode, coarse: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && coarse);
}

/**
 * A panel's state with no explicit choice. On a narrow (phone) screen every panel starts folded; otherwise the
 * refinery folds away while its queue is empty.
 */
export function autoCollapsed(id: HudPanelId, state: GameState, narrow = false): boolean {
  return narrow || (id === 'refinery' && state.run.refinery.queue.length === 0);
}

/** Whether `id` is collapsed: the player's explicit choice, else its automatic state. */
export function isCollapsed(id: HudPanelId, prefs: HudCollapse, state: GameState, narrow = false): boolean {
  return prefs[id] ?? autoCollapsed(id, state, narrow);
}

/**
 * The collapse choices after toggling `id`. A new state equal to the automatic one drops the stored choice, so
 * the panel follows its automatic state again. On a narrow screen the panels are an accordion: opening one drops
 * the other panels' explicit open choices, so only one covers the playfield at a time.
 */
export function toggledCollapse(id: HudPanelId, prefs: HudCollapse, state: GameState, narrow = false): HudCollapse {
  const next = !isCollapsed(id, prefs, state, narrow);
  const out = { ...prefs };
  if (narrow && !next) for (const other of HUD_PANEL_IDS) if (other !== id && out[other] === false) delete out[other];
  if (next === autoCollapsed(id, state, narrow)) delete out[id];
  else out[id] = next;
  return out;
}
