// Audio tab: master, effects and music volume. Changes apply live.

import type { SettingsStore } from '../../settings';
import { h } from '../dom';
import { rangeRow } from './form';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function renderAudio(settings: SettingsStore): Node[] {
  return [
    rangeRow(settings, 'volMaster', 'Master volume', 0, 1, 0.05, pct),
    rangeRow(settings, 'volSfx', 'Effects', 0, 1, 0.05, pct),
    rangeRow(settings, 'volMusic', 'Music', 0, 1, 0.05, pct, true),
    h('p', { class: 'dim', text: "There's no music yet; the music level is saved for when it arrives." }),
  ];
}
