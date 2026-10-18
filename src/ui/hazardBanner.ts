// HUD hazard banner text: one pure function so the Hud only has to set it.

import type { Run } from '../sim/types';

const secs = (t: number): number => Math.max(0, Math.ceil(t));

/**
 * Text for pending hazards, or null when none. Flare first (it is the one to
 * react to), then the comet, joined by ' · ' when both are pending.
 */
export function hazardBanner(run: Run): string | null {
  const { flare, comet } = run.hazards;
  if (!flare && !comet) return null;
  const parts: string[] = [];
  if (flare) {
    parts.push(
      flare.phase === 'active'
        ? `☀ SOLAR FLARE · ${secs(flare.timeLeft)}s`
        : `☀ Flare building · ${secs(flare.timeLeft)}s`,
    );
  }
  if (comet) parts.push(`☄ Comet inbound · ${secs(comet.timeLeft)}s`);
  return parts.length ? parts.join(' · ') : null;
}
