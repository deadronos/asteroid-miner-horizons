// Audio tab: volume levels (stored ahead of the audio engine).

import type { SettingsStore } from '../../settings';
import { h } from '../dom';
import { rangeRow } from './form';

export function renderAudio(settings: SettingsStore): Node[] {
  return [
    h('p', {
      class: 'dim',
      text: "Sound isn't in the game yet. These levels are saved now and will apply once audio arrives.",
    }),
    rangeRow(settings, 'volMaster', 'Master volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
    rangeRow(settings, 'volSfx', 'Effects', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
    rangeRow(settings, 'volMusic', 'Music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true),
  ];
}
