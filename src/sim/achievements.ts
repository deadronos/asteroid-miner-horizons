// Lifetime stats and achievement unlocks. Counters are bumped where the event
// happens; `updateAchievements` runs once per tick and unlocks any threshold
// reached, announcing it through a log line the HUD turns into a toast. Nothing
// here touches an RNG, so the feature cannot move the run's random sequence.

import { ACHIEVEMENTS, ACHIEVEMENT_IDS, STAT_KEYS, type AchievementId, type LifetimeStats } from '../data/achievements';
import type { GameState, Profile } from './types';

export function newStats(): LifetimeStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as LifetimeStats;
}

/** Unlocks every achievement whose threshold is reached. Allocates only on an unlock. */
export function updateAchievements(state: GameState): void {
  const { stats, achievements } = state.profile;
  for (let i = 0; i < ACHIEVEMENT_IDS.length; i++) {
    const id = ACHIEVEMENT_IDS[i]!;
    const a = ACHIEVEMENTS[id];
    if (stats[a.stat] < a.at || achievements.includes(id)) continue;
    achievements.push(id);
    state.out.log.push({ level: 'major', text: `Achievement unlocked: ${a.name}. ${a.desc}`, achievement: id });
  }
}

/** Progress toward one achievement, capped at its threshold. */
export function achievementProgress(profile: Profile, id: AchievementId): { value: number; target: number } {
  const a = ACHIEVEMENTS[id];
  return { value: Math.min(profile.stats[a.stat], a.at), target: a.at };
}
