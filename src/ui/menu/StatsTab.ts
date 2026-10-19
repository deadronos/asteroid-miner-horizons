// Stats tab: this save's lifetime stats and its achievements with progress.
// Rows come from pure helpers so tests can check the text without a DOM.

import { ACHIEVEMENTS, ACHIEVEMENT_IDS, STAT_KEYS, STAT_LABELS } from '../../data/achievements';
import { achievementProgress } from '../../sim/achievements';
import type { Profile } from '../../sim/types';
import { h } from '../dom';
import { row, section } from './form';

/** Whole units with thousands separators, independent of the browser locale. */
export function groupDigits(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Play time as `Xm` under an hour, `Xh YYm` from there. */
export function formatPlayTime(sec: number): string {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** One `[label, value]` per lifetime stat, in table order. */
export function statRows(profile: Profile): [string, string][] {
  return STAT_KEYS.map((k) => [
    STAT_LABELS[k],
    k === 'time' ? formatPlayTime(profile.stats.time) : groupDigits(profile.stats[k]),
  ]);
}

export interface AchievementRow {
  name: string;
  desc: string;
  unlocked: boolean;
  /** `Unlocked`, or progress such as `37 / 500` (play time in the time format). */
  status: string;
}

/** Every achievement, unlocked ones first in unlock order, then locked ones in table order. */
export function achievementRows(profile: Profile): AchievementRow[] {
  const locked = ACHIEVEMENT_IDS.filter((id) => !profile.achievements.includes(id));
  return [...profile.achievements, ...locked].map((id) => {
    const a = ACHIEVEMENTS[id];
    const unlocked = profile.achievements.includes(id);
    const { value, target } = achievementProgress(profile, id);
    const fmt = a.stat === 'time' ? formatPlayTime : groupDigits;
    return { name: a.name, desc: a.desc, unlocked, status: unlocked ? 'Unlocked' : `${fmt(value)} / ${fmt(target)}` };
  });
}

export function renderStats(profile: Profile): Node[] {
  const achievements = achievementRows(profile);
  const got = achievements.filter((a) => a.unlocked).length;
  return [
    section('Lifetime stats'),
    ...statRows(profile).map(([label, value]) => row(label, '', h('span', { class: 'val', text: value }))),
    section(`Achievements (${got}/${achievements.length})`),
    ...achievements.map((a) => {
      const el = row(a.unlocked ? `★ ${a.name}` : a.name, a.desc, h('span', { class: 'val', text: a.status }));
      el.classList.toggle('locked', !a.unlocked);
      return el;
    }),
    h('p', { class: 'dim', text: 'Stats belong to this save and carry across warps.' }),
  ];
}
