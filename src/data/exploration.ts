// Exploration content: anomaly labels, scanner glyphs and derelict salvage. Pure data.

import type { ComponentId } from './components';
import type { Cost } from './resources';

export type AnomalyKind = 'rich' | 'derelict';

export interface AnomalyInfo {
  /** User-facing name. */
  label: string;
  /** Short non-colour glyph for the scanner and map. */
  glyph: string;
}

export const ANOMALY_INFO: Record<AnomalyKind, AnomalyInfo> = {
  rich: { label: 'Rich deposit', glyph: '◆' },
  derelict: { label: 'Derelict', glyph: '⌖' },
};

export const ANOMALY_KINDS: readonly AnomalyKind[] = ['rich', 'derelict'];

export interface SalvageDef {
  /** Wreck description for the log. */
  label: string;
  /** Resources paid once when a ship reaches the wreck. */
  reward: Cost;
  /** Chance a component is recovered as well; 0 means resources only. */
  componentChance: number;
  /** Components that can drop, when components fit the reward. */
  components: readonly ComponentId[];
}

/** One derelict salvage payout; an anomaly's `salvage` indexes this list. */
export const DERELICT_SALVAGE: readonly SalvageDef[] = [
  { label: 'Ore freighter', reward: { ore: 120, alloy: 6 }, componentChance: 0.35, components: ['cargo', 'engine'] },
  { label: 'Survey ship', reward: { ice: 80, crystal: 6 }, componentChance: 0.4, components: ['sensor', 'laser'] },
  { label: 'Armoured hauler', reward: { ore: 60, alloy: 12 }, componentChance: 0.3, components: ['armor', 'shield'] },
];
