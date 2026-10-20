// Sound presets and the pure rules for turning sim state into sound: which
// preset, how loud, where in the stereo field and at what pitch. Also the rules
// for the continuous layer (beam hums, danger alarm) and a rate limiter so a
// fleet of drones can't turn the mix into noise.

import { len, type Vec2 } from '../core/vec';
import { flareExposure } from '../sim/hazards';
import { isAlive, selectedShip, shipStats } from '../sim/ships';
import type { Fx, LogEntry, LogEvent, Profile, Run } from '../sim/types';
import type { ZzfxParams } from './zzfx';

export type SoundId =
  | 'crack'
  | 'collect'
  | 'dock'
  | 'impact'
  | 'explode'
  | 'warp'
  | 'uiClick'
  | 'uiDeny'
  | 'alarm'
  | 'research'
  | 'achievement'
  | 'contractDone'
  | 'contractFail'
  | 'outpost'
  | 'loss';

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
  // Gentle two-tone chime, low enough to sit under the mix and repeat without grating.
  alarm: [0.5, 0, 320, 0.01, 0.07, 0.26, 0, 1.3, 0, 0, 150, 0.07, 0, 0, 0, 0, 0.1, 0.9],
  // Short rising three-note arpeggio (660 → 880 → 1100) for research buys.
  research: [0.5, 0, 660, 0.01, 0.05, 0.14, 0, 1.4, 0, 0, 220, 0.06, 0.075, 0, 0, 0, 0.09, 0.7],
  // Bright fanfare: two notes up a fourth with an echo tail.
  achievement: [0.7, 0, 880, 0.01, 0.1, 0.42, 0, 1.1, 0, 0, 330, 0.09, 0.16, 0, 0, 0, 0.15, 0.8],
  // Major-key two-note "paid" chime, brighter and faster than the achievement fanfare.
  contractDone: [0.6, 0, 740, 0.01, 0.08, 0.3, 0, 1.2, 0, 0, 370, 0.09, 0.12, 0, 0, 0, 0.12, 0.75],
  // Clean falling minor pair: the opposite of "paid".
  contractFail: [0.45, 0, 440, 0.01, 0.06, 0.32, 0, 1, 0, 0, -110, 0.08],
  // Thud plus a short confirming tone: something placed.
  outpost: [0.55, 0, 130, 0.005, 0.03, 0.22, 0, 1.5, -2, 0, 260, 0.07, 0, 0.35],
  // Low mourning tone layered under the positional explosion.
  loss: [0.7, 0, 90, 0.02, 0.12, 0.55, 0, 1, -1.1, 0, 45, 0.16, 0, 0.12, 0, 0.04],
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
  // Short, because the alarm itself paces its ~1.1 s repeats.
  alarm: 0.3,
  research: 0.15,
  achievement: 0.5,
  contractDone: 0.3,
  contractFail: 0.3,
  outpost: 0.3,
  loss: 0.4,
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

export type CueKey = LogEvent | 'achievement';

/** One preset and its pinned gain for an event identity. */
export interface Cue {
  id: SoundId;
  gain: number;
}

/** Which preset and how loud per event identity; placement is always centre. */
export const CUES: Readonly<Record<CueKey, Cue>> = Object.freeze({
  research: { id: 'research', gain: 0.5 },
  achievement: { id: 'achievement', gain: 0.7 },
  contractDone: { id: 'contractDone', gain: 0.6 },
  contractFail: { id: 'contractFail', gain: 0.45 },
  outpost: { id: 'outpost', gain: 0.55 },
  shipLoss: { id: 'loss', gain: 0.7 },
});

/** Warn lines and one cue voice per event identity found in a log batch. */
export function cueBatch(log: readonly LogEntry[]): { deny: boolean; cues: CueKey[] } {
  const cues = new Set<CueKey>();
  let deny = false;
  for (const l of log) {
    if (l.level === 'warn') deny = true;
    if (l.achievement) cues.add('achievement');
    if (l.event) cues.add(l.event);
  }
  return { deny, cues: [...cues] };
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
  /** Lowpass cutoff (Hz) for this voice. */
  cutoff: number;
}

/** Lowpass cutoff (Hz) at the screen centre: effectively open. */
export const CENTER_CUTOFF = 18000;
/** Lowpass cutoff (Hz) at the screen edge and beyond: audibly darker. */
export const EDGE_CUTOFF = 3200;
/** Cutoff floor when the camera is zoomed far out. */
export const MIN_CUTOFF = 900;
/** Gain at the screen edge relative to the centre: on-screen sources still fall off gently. */
export const EDGE_GAIN = 0.6;
/** Widest stereo position, reached at the left/right screen edge. */
export const PAN_WIDTH = 0.8;
/** View half-height (world units) at the default zoom; zooming out past it attenuates everything. */
const REF_HALF_H = 420;
/** Quietest the zoom factor gets, at whole-system overview. */
const MIN_ZOOM_GAIN = 0.4;

/**
 * Positional mix from the source's place relative to the camera centre and
 * zoom: full volume at the centre, EDGE_GAIN at the screen edge, silent half a
 * screen beyond it; zooming out past the default makes everything quieter.
 * Pan follows the horizontal screen position. Returns [gain, pan, cutoff].
 */
export function spatial(pos: Vec2, view: View): [number, number, number] {
  const dx = (pos.x - view.center.x) / view.halfW;
  const dz = (pos.z - view.center.z) / view.halfH;
  const r = Math.max(Math.abs(dx), Math.abs(dz));
  const place = r <= 1 ? 1 - (1 - EDGE_GAIN) * r : EDGE_GAIN * Math.max(0, 1 - (r - 1) * 2);
  const zoom = Math.max(MIN_ZOOM_GAIN, Math.min(1, Math.sqrt(REF_HALF_H / view.halfH)));
  const cutoff = Math.max(
    MIN_CUTOFF,
    Math.min(CENTER_CUTOFF, CENTER_CUTOFF * (EDGE_CUTOFF / CENTER_CUTOFF) ** Math.min(1, r) * zoom ** 1.5),
  );
  return [place * zoom, Math.max(-1, Math.min(1, dx)) * PAN_WIDTH, cutoff];
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
  if (fx.t === 'warp') return { id: 'warp', gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF };
  if (fx.t === 'hazard') {
    if (fx.phase === 'warn') return { id: 'alarm', gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF };
    return fx.kind === 'flare' ? { id: 'impact', gain: 0.9, pan: 0, rate: 1, cutoff: CENTER_CUTOFF } : null;
  }
  const [g, pan, cutoff] = spatial(fx.pos, view);
  if (g <= 0.02) return null;
  const jitter = 0.94 + Math.random() * 0.12;
  switch (fx.t) {
    case 'crack': {
      // Bigger rocks: louder and lower.
      const size = Math.min(1, fx.radius / 40);
      return { id: 'crack', gain: g * (0.45 + 0.65 * size), pan, rate: (1.5 - 0.75 * size) * jitter, cutoff };
    }
    case 'collect':
      return { id: 'collect', gain: g * 0.8, pan, rate: streak.next(now), cutoff };
    case 'dock':
      return { id: 'dock', gain: g, pan, rate: 1, cutoff };
    case 'impact':
      return { id: 'impact', gain: g, pan, rate: jitter, cutoff };
    case 'explode':
      return { id: 'explode', gain: g, pan, rate: jitter, cutoff };
  }
}

/** Which continuous layers may sound this frame. */
export interface ContinuousPolicy {
  readonly hums: boolean;
  readonly alarm: boolean;
}

/** Nothing gates the continuous layer. */
export const LIVE_CONTINUOUS: ContinuousPolicy = Object.freeze({ hums: true, alarm: true });

/** Hard cap on simultaneous beam hums: past this the mix turns to mush anyway. */
export const MAX_HUMS = 4;

/** A continuous laser hum for one ship's active mining beam. */
export interface BeamHum {
  shipId: number;
  /** Linear gain into the SFX bus (spatial falloff already applied). */
  gain: number;
  /** Stereo position -1..1. */
  pan: number;
  /** Oscillator pitch in Hz, derived from the beam's DPS. */
  freq: number;
  /** Lowpass cutoff (Hz) for this hum's filter. */
  cutoff: number;
}

/**
 * One hum per alive ship with an active beam, loudest first, capped at `max`.
 * Deterministic (no randomness) so it is unit-testable.
 */
export function beamHums(run: Run, profile: Profile, view: View, max = MAX_HUMS): BeamHum[] {
  const hums: BeamHum[] = [];
  for (const ship of run.ships) {
    if (!isAlive(ship) || !ship.beamOn || ship.beamTargetId == null) continue;
    const [gain, pan, cutoff] = spatial(ship.pos, view);
    if (gain <= 0.02) continue;
    // Mine harder, hum higher: the pitch lets a mixed fleet be told apart by ear.
    const dps = shipStats(ship, profile).dps;
    hums.push({ shipId: ship.id, gain, pan, freq: Math.min(320, Math.max(60, 70 + 2.2 * dps)), cutoff });
  }
  // Loudest first; ties by id so a fleet keeps a stable voice assignment frame to frame.
  hums.sort((a, b) => b.gain - a.gain || a.shipId - b.shipId);
  return hums.slice(0, max);
}

/**
 * Urgency 0..1 of the selected ship's danger state for the repeating alarm.
 * 0 when quiet.
 */
export function alarmLevel(run: Run, profile: Profile): number {
  const ship = selectedShip(run);
  if (!ship || !isAlive(ship)) return 0;
  const st = shipStats(ship, profile);
  const hullFrac = st.maxHull > 0 ? ship.hull / st.maxHull : 0;
  const hullSev = hullFrac < 0.25 ? (0.25 - hullFrac) / 0.25 : 0;
  const dStar = len(ship.pos);
  let heatSev = 0;
  // Mirrors the star-heat ramp in sim/update so the alarm follows the damage being taken.
  if (dStar < run.system.heatRadius) {
    const k = 1 - (dStar - run.system.starRadius) / (run.system.heatRadius - run.system.starRadius);
    heatSev = Math.min(1, Math.max(0.2, k));
  }
  // Inside an active flare's reach and not safe in the station: a steady moderate urgency.
  const flareSev = flareExposure(run, ship) > 0 ? 0.5 : 0;
  return Math.max(hullSev, heatSev, flareSev);
}
