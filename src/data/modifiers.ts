// System modifiers: seeded per-system twists on belt density, belt mix, pickup
// radius and belt regrow. Pure data; the sim reads the multipliers.

import type { RawResource } from './resources';

export type ModifierId = 'dense' | 'metalRich' | 'icePoor' | 'nebula';

export interface ModifierDef {
  id: ModifierId;
  /** Short display name for the top bar chip and the warp log. */
  name: string;
  /** × every belt's rock count (initial count, and so the regrow target). */
  beltCount?: number;
  /** × belt mix weight per raw kind, applied to every belt. */
  mix?: Partial<Record<RawResource, number>>;
  /** × every ship's pickup (tractor) radius. */
  magnet?: number;
  /** × the belt regrow interval (< 1 regrows faster). */
  regrowInterval?: number;
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  dense: { id: 'dense', name: 'Dense belt', beltCount: 1.4 },
  metalRich: { id: 'metalRich', name: 'Metal-rich', mix: { ore: 1.6 } },
  icePoor: { id: 'icePoor', name: 'Ice-poor', mix: { ice: 0.55 } },
  nebula: { id: 'nebula', name: 'Nebula', magnet: 0.7, regrowInterval: 0.5 },
};

export const MODIFIER_IDS: readonly ModifierId[] = Object.keys(MODIFIERS) as ModifierId[];
