// HUD density rules (#161): when the help box shows and which side panels are collapsed. Pure, so tests can
// check them without a DOM; Hud applies the results as classes.

import type { HelpMode, HudCollapse, HudPanelId } from '../settings';
import type { GameState } from '../sim/types';

/** Lifetime play time, in seconds, after which `auto` help hides itself. */
export const HELP_AUTO_HIDE_SEC = 180;

/** Whether the help box shows for `mode` after `playSec` seconds of lifetime play. */
export function helpVisible(mode: HelpMode, playSec: number): boolean {
  if (mode === 'auto') return playSec < HELP_AUTO_HIDE_SEC;
  return mode === 'on';
}

/** A panel's state with no explicit choice: the refinery folds away while its queue is empty. */
export function autoCollapsed(id: HudPanelId, state: GameState): boolean {
  return id === 'refinery' && state.run.refinery.queue.length === 0;
}

/** Whether `id` is collapsed: the player's explicit choice, else its automatic state. */
export function isCollapsed(id: HudPanelId, prefs: HudCollapse, state: GameState): boolean {
  return prefs[id] ?? autoCollapsed(id, state);
}

/**
 * The collapse choices after toggling `id`. A new state equal to the automatic one drops the stored choice, so
 * the panel follows its automatic state again.
 */
export function toggledCollapse(id: HudPanelId, prefs: HudCollapse, state: GameState): HudCollapse {
  const next = !isCollapsed(id, prefs, state);
  const out = { ...prefs };
  if (next === autoCollapsed(id, state)) delete out[id];
  else out[id] = next;
  return out;
}
