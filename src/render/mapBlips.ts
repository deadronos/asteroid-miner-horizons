// What the zoomed-out map marks besides the station and planets: the fleet, outposts, incoming hazards and
// each belt's dominant resource. Pure, so the choice of blips and belt labels is testable without a DOM.

import { RAW_RESOURCES, RESOURCE_INFO, type RawResource } from '../data/resources';
import { isAlive } from '../sim/ships';
import type { Belt, Run } from '../sim/types';

export type BlipKind = 'selected' | 'ship' | 'outpost' | 'comet' | 'flare';

/** A map marker in world space. Objects are reused between calls, so read them before the next `collectBlips`. */
export interface Blip {
  kind: BlipKind;
  x: number;
  z: number;
}

/** Glyph per blip kind. */
export const BLIP_GLYPH: Record<BlipKind, string> = {
  selected: '▲',
  ship: '▴',
  outpost: '⌂',
  comet: '☄',
  flare: '✹',
};

/** The raw resource with the largest share of the belt's mix; ties go to the earlier kind in `RAW_RESOURCES`. */
export function dominantResource(belt: Belt): RawResource {
  let best: RawResource = RAW_RESOURCES[0]!;
  for (const r of RAW_RESOURCES) if (belt.mix[r] > belt.mix[best]) best = r;
  return best;
}

/** "Belt A ⬢": letter by index, then the dominant resource's icon so colour is not the only cue. */
export const beltLabel = (belt: Belt, index: number): string =>
  `Belt ${String.fromCharCode(65 + (index % 26))} ${RESOURCE_INFO[dominantResource(belt)].icon}`;

/**
 * Fills `out` with this frame's blips and returns the count (the array may be longer; entries past the count
 * are stale). Dead ships are skipped; an active or warned flare is marked at the star.
 */
export function collectBlips(run: Run, out: Blip[]): number {
  let n = 0;
  const push = (kind: BlipKind, x: number, z: number): void => {
    const b = (out[n] ??= { kind, x, z });
    b.kind = kind;
    b.x = x;
    b.z = z;
    n++;
  };
  for (const s of run.ships) {
    if (!isAlive(s)) continue;
    push(s.id === run.selectedId ? 'selected' : 'ship', s.pos.x, s.pos.z);
  }
  for (const o of run.automation.outposts) push('outpost', o.pos.x, o.pos.z);
  const c = run.hazards.comet;
  if (c) push('comet', c.from.x, c.from.z);
  if (run.hazards.flare) push('flare', 0, 0);
  return n;
}
