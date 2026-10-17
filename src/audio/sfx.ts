// Sound presets and the pure rules for turning sim fx into sounds: which
// preset, how loud, where in the stereo field and at what pitch, plus a rate
// limiter so a fleet of drones can't turn the mix into noise.

import type { Vec2 } from '../core/vec';
import type { Fx } from '../sim/types';
import type { ZzfxParams } from './zzfx';

export type SoundId = 'crack' | 'collect' | 'dock' | 'impact' | 'explode' | 'warp' | 'uiClick' | 'uiDeny';

/** ZzFX presets. Randomness is 0 so each renders once and is cached; variety comes from `rate`. */
export const PRESETS: Record<SoundId, ZzfxParams> = {
  // Crunchy rock break: noisy, falling, bit-crushed tail.
  crack: [1.1, 0, 150, 0, 0.04, 0.35, 4, 1.4, -2, 0, 0, 0, 0, 1.2, 0, 0.08, 0, 0.6, 0.05],
  // Short bright blip with a quick upward jump.
  collect: [0.45, 0, 900, 0, 0.015, 0.07, 0, 1.6, 0, 0, 500, 0.025],
  // Two-note chime (up a fifth) with a little echo.
  dock: [0.6, 0, 660, 0.01, 0.09, 0.35, 0, 1.2, 0, 0, 330, 0.11, 0, 0, 0, 0, 0.12, 0.7],
  // Dull low thump.
  impact: [1, 0, 95, 0, 0.03, 0.2, 0, 2.2, -6, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0.02],
  // Long noisy boom.
  explode: [1.3, 0, 55, 0, 0.25, 0.9, 4, 1, -0.4, 0, 0, 0, 0, 1.6, 0, 0.12, 0.1, 0.55, 0.12],
  // Rising whoosh.
  warp: [0.8, 0, 160, 0.25, 0.35, 0.6, 1, 1, 24, 0, 0, 0, 0, 0.2, 8, 0, 0, 0.8, 0.1, 0, 2400],
  // Soft tick for UI buttons.
  uiClick: [0.22, 0, 1500, 0, 0, 0.025, 1, 2],
  // Low falling buzz for rejected commands.
  uiDeny: [0.35, 0, 220, 0, 0.05, 0.1, 2, 1, -4, 0, -60, 0.05, 0, 0, 0, 0, 0, 0.7, 0, 0, 1800],
};

/** Minimum seconds between two plays of the same sound. */
const MIN_GAP: Record<SoundId, number> = {
  crack: 0.05,
  collect: 0.06,
  dock: 0.25,
  impact: 0.08,
  explode: 0.15,
  warp: 0.5,
  uiClick: 0.03,
  uiDeny: 0.2,
};

export const MAX_VOICES = 12;

/** Per-sound minimum spacing plus a global cap on sounds playing at once. */
export class RateLimiter {
  private last = new Map<SoundId, number>();
  voices = 0;

  /** True if `id` may start at time `now` (seconds); reserves a voice if so. */
  allow(id: SoundId, now: number): boolean {
    if (this.voices >= MAX_VOICES) return false;
    const prev = this.last.get(id);
    if (prev != null && now - prev < MIN_GAP[id]) return false;
    this.last.set(id, now);
    this.voices++;
    return true;
  }

  /** Call when a voice started by `allow` finishes. */
  release(): void {
    this.voices = Math.max(0, this.voices - 1);
  }
}

/** What part of the world is on screen: center and half extents in world units. */
export interface View {
  center: Vec2;
  halfW: number;
  halfH: number;
}

export interface Voice {
  id: SoundId;
  /** Linear gain before the SFX bus (0..~1.5). */
  gain: number;
  /** Stereo position -1..1. */
  pan: number;
  /** Playback rate (pitch): 1 = as rendered. */
  rate: number;
}

/**
 * Distance falloff: full volume on screen, fading to silence half a screen
 * beyond the edge. Returns [gain, pan].
 */
export function spatial(pos: Vec2, view: View): [number, number] {
  const dx = (pos.x - view.center.x) / view.halfW;
  const dz = (pos.z - view.center.z) / view.halfH;
  const out = Math.max(Math.abs(dx), Math.abs(dz)) - 1;
  const gain = out <= 0 ? 1 : Math.max(0, 1 - out * 2);
  return [gain, Math.max(-1, Math.min(1, dx)) * 0.6];
}

/** Tracks quick runs of pickups so each blip in a streak climbs in pitch. */
export class Streak {
  private count = 0;
  private lastAt = -Infinity;

  /** Returns the pitch rate for a pickup at `now`: up to an octave above base. */
  next(now: number): number {
    this.count = now - this.lastAt < 0.6 ? Math.min(this.count + 1, 12) : 0;
    this.lastAt = now;
    return 2 ** (this.count / 12);
  }
}

/** Maps one sim fx to a sound, or null if it's inaudible from here. */
export function voiceFor(fx: Fx, view: View, streak: Streak, now: number): Voice | null {
  if (fx.t === 'warp') return { id: 'warp', gain: 1, pan: 0, rate: 1 };
  const [g, pan] = spatial(fx.pos, view);
  if (g <= 0.02) return null;
  const jitter = 0.94 + Math.random() * 0.12;
  switch (fx.t) {
    case 'crack': {
      // Bigger rocks: louder and lower.
      const size = Math.min(1, fx.radius / 40);
      return { id: 'crack', gain: g * (0.45 + 0.65 * size), pan, rate: (1.5 - 0.75 * size) * jitter };
    }
    case 'collect':
      return { id: 'collect', gain: g * 0.8, pan, rate: streak.next(now) };
    case 'dock':
      return { id: 'dock', gain: g, pan, rate: 1 };
    case 'impact':
      return { id: 'impact', gain: g, pan, rate: jitter };
    case 'explode':
      return { id: 'explode', gain: g, pan, rate: jitter };
  }
}
