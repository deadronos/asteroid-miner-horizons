// The single source of truth for "why the sim is frozen" and "which continuous
// audio may sound". `main.ts` hands the same `PauseKind` to the pause banner and
// to the audio layer, so the two can never disagree about the cause. Pure and
// DOM-free: no three.js, no AudioEngine, no `document`.

import { LIVE_CONTINUOUS, type ContinuousPolicy } from './audio/sfx';

export type PauseKind = 'manual' | 'menu' | 'unfocused';

/** Everything that can freeze the sim: the manual toggle, the menus, the focus. */
export interface PauseInput {
  manual: boolean;
  pauseInMenus: boolean;
  pauseUnfocused: boolean;
  menuOpen: boolean;
  researchOpen: boolean;
  focused: boolean;
}

/** Banner text per kind. A Record, so a new kind is a type error, not a fallthrough. */
const BANNERS: Record<PauseKind, string> = Object.freeze({
  manual: 'PAUSED: press P to resume',
  menu: 'PAUSED: menu open',
  unfocused: 'PAUSED: window not focused',
});

/** Explicit pause: nothing is changing, so the hum and the alarm are both lies. */
const SILENT_CONTINUOUS: ContinuousPolicy = Object.freeze({ hums: false, alarm: false });

/** Unfocused: the player's attention is elsewhere, which is when the alarm earns its keep. */
const ALARM_CONTINUOUS: ContinuousPolicy = Object.freeze({ hums: false, alarm: true });

/**
 * The highest-priority reason the sim is frozen, or null while it runs: manual,
 * then an open menu (either panel), then an unfocused window, each reason gated
 * by its own setting.
 */
export function pauseKind(i: PauseInput): PauseKind | null {
  if (i.manual) return 'manual';
  if (i.pauseInMenus && (i.menuOpen || i.researchOpen)) return 'menu';
  if (i.pauseUnfocused && !i.focused) return 'unfocused';
  return null;
}

/** The pause banner for `kind`, or null while the sim runs. */
export function pauseBanner(kind: PauseKind | null): string | null {
  return kind ? BANNERS[kind] : null;
}

/** Which continuous layers may sound while the sim is frozen by `kind`. */
export function pauseAudio(kind: PauseKind | null): ContinuousPolicy {
  if (kind === 'manual' || kind === 'menu') return SILENT_CONTINUOUS;
  if (kind === 'unfocused') return ALARM_CONTINUOUS;
  return LIVE_CONTINUOUS;
}
