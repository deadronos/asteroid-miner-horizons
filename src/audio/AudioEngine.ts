// Web Audio mixer: master ← (sfx, music) gain buses bound to the volume
// settings. The AudioContext is created on the first user gesture (so the
// browser never blocks autoplay) and suspended while the tab is hidden.
// One-shots are ZzFX buffers rendered once per preset and replayed at any
// pitch; continuous states (beam hums, the danger alarm) come from
// `updateContinuous`, which is called every frame.

import type { SettingsStore } from '../settings';
import type { Fx, GameState, LogEntry } from '../sim/types';
import {
  alarmLevel,
  beamHums,
  MAX_HUMS,
  PRESETS,
  RateLimiter,
  type SoundId,
  Streak,
  type View,
  type Voice,
  voiceFor,
} from './sfx';
import { ZZFX_RATE, zzfxSamples } from './zzfx';

/** Headroom: ZzFX presets are authored hot, so the SFX bus starts lower. */
const SFX_TRIM = 0.35;

/** Beam hums can stack, so each is quiet; ramps keep starts and stops click-free. */
const HUM_TRIM = 0.12;
const HUM_ATTACK = 0.04;
const HUM_RELEASE = 0.12;
/** Seconds between repeats of the danger alarm (far above MIN_GAP.alarm). */
const ALARM_INTERVAL = 1.1;

/** One persistent oscillator chain per active beam, faded in and out over its life. */
interface HumVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

/** Slider position → gain. Squared so the low end of the slider is usable. */
const curve = (v: number): number => v * v;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private buffers = new Map<SoundId, AudioBuffer>();
  private limiter = new RateLimiter();
  private streak = new Streak();
  private hums = new Map<number, HumVoice>();
  private nextAlarm = 0;

  constructor(private readonly settings: SettingsStore) {
    const unlock = (): void => {
      this.start();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    settings.onChange(() => this.applyVolumes());
  }

  /** The context's state, or 'locked' before the first user gesture. */
  get state(): AudioContextState | 'locked' {
    return this.ctx?.state ?? 'locked';
  }

  private start(): void {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes(true);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  private applyVolumes(instant = false): void {
    const { ctx, master, sfx, music } = this;
    if (!ctx || !master || !sfx || !music) return;
    const s = this.settings.value;
    const set = (node: GainNode, v: number): void => {
      if (instant) node.gain.value = v;
      else node.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    };
    set(master, curve(s.volMaster));
    set(sfx, curve(s.volSfx) * SFX_TRIM);
    set(music, curve(s.volMusic));
  }

  private buffer(id: SoundId): AudioBuffer {
    let b = this.buffers.get(id);
    if (!b) {
      const data = zzfxSamples(PRESETS[id]);
      b = this.ctx!.createBuffer(1, Math.max(1, data.length), ZZFX_RATE);
      b.copyToChannel(data, 0);
      this.buffers.set(id, b);
    }
    return b;
  }

  play(v: Voice): void {
    const { ctx, sfx } = this;
    if (!ctx || !sfx || ctx.state !== 'running' || v.gain <= 0) return;
    if (!this.limiter.allow(v.id, ctx.currentTime)) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(v.id);
    src.playbackRate.value = v.rate;
    const gain = ctx.createGain();
    gain.gain.value = v.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = v.pan;
    src.connect(gain).connect(pan).connect(sfx);
    src.addEventListener(
      'ended',
      () => {
        this.limiter.release();
        src.disconnect();
        gain.disconnect();
        pan.disconnect();
      },
      { once: true },
    );
    src.start();
  }

  ui(id: 'uiClick' | 'uiDeny'): void {
    this.play({ id, gain: 1, pan: 0, rate: 1 });
  }

  /** Plays sounds for this frame's sim fx. Read-only: the renderer drains the list. */
  consumeFx(fx: readonly Fx[], view: View): void {
    if (!this.ctx || this.ctx.state !== 'running' || fx.length === 0) return;
    const now = this.ctx.currentTime;
    for (const f of fx) {
      const v = voiceFor(f, view, this.streak, now);
      if (v) this.play(v);
    }
  }

  /**
   * Continuous layer: a looping hum per active mining beam and a repeating alarm
   * while the selected ship is in danger. Called every frame; read-only on `state`.
   */
  updateContinuous(state: GameState, view: View): void {
    const { ctx, sfx } = this;
    // Locked or suspended: never start a voice, just fade out whatever is left.
    if (!ctx || !sfx || ctx.state !== 'running') {
      this.silenceHums();
      this.nextAlarm = 0;
      return;
    }
    const now = ctx.currentTime;
    const hums = beamHums(state.run, state.profile, view);
    const live = new Set(hums.map((h) => h.shipId));
    // Release dropped voices first: a beam that newly fits the cap isn't left silent for a frame.
    for (const [shipId, voice] of this.hums) {
      if (live.has(shipId)) continue;
      this.hums.delete(shipId);
      this.releaseHum(voice, now);
    }
    for (const hum of hums) {
      let voice = this.hums.get(hum.shipId);
      if (!voice) {
        // Hard cap: a beam beyond MAX_HUMS simply stays silent (beamHums already trims to it).
        if (this.hums.size >= MAX_HUMS) continue;
        voice = this.makeHumVoice(ctx, sfx, hum.freq, hum.pan);
        this.hums.set(hum.shipId, voice);
      }
      voice.gain.gain.setTargetAtTime(hum.gain * HUM_TRIM, now, HUM_ATTACK);
      voice.osc.frequency.setTargetAtTime(hum.freq, now, HUM_ATTACK);
      voice.filter.frequency.setTargetAtTime(hum.freq * 6, now, HUM_ATTACK);
      voice.pan.pan.value = hum.pan;
    }
    this.updateAlarm(state, now);
  }

  /** Builds a silent osc → lowpass → gain → panner chain and starts the oscillator. */
  private makeHumVoice(ctx: AudioContext, sfx: GainNode, freq: number, pan: number): HumVoice {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = freq * 6;
    gain.gain.value = 0; // silent until the per-frame ramp fades it in
    panner.pan.value = pan;
    osc.connect(filter).connect(gain).connect(panner).connect(sfx);
    osc.start();
    return { osc, filter, gain, pan: panner };
  }

  /** Fades a voice to silence, then stops and disconnects it once the tail is done. */
  private releaseHum(voice: HumVoice, now: number): void {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, HUM_RELEASE);
    // Four release time constants is ≈e^-4 of the target: inaudible when we stop.
    voice.osc.stop(now + HUM_RELEASE * 4);
    voice.osc.addEventListener(
      'ended',
      () => {
        voice.osc.disconnect();
        voice.filter.disconnect();
        voice.gain.disconnect();
        voice.pan.disconnect();
      },
      { once: true },
    );
  }

  /** Fades out and drops every hum, e.g. when the context stops being audible. */
  private silenceHums(): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.hums.clear();
      return;
    }
    const now = ctx.currentTime;
    for (const voice of this.hums.values()) this.releaseHum(voice, now);
    this.hums.clear();
  }

  /** Plays the danger alarm on its own cadence; resets the timer once the ship is safe. */
  private updateAlarm(state: GameState, now: number): void {
    const level = alarmLevel(state.run, state.profile);
    if (level <= 0) {
      this.nextAlarm = 0;
      return;
    }
    if (now < this.nextAlarm) return;
    this.play({ id: 'alarm', gain: 0.35 + 0.5 * level, pan: 0, rate: 1 });
    this.nextAlarm = now + ALARM_INTERVAL;
  }

  /** Rejected commands (warn-level log lines) get a deny buzz. Read-only. */
  consumeLog(log: readonly LogEntry[]): void {
    if (log.some((l) => l.level === 'warn')) this.ui('uiDeny');
  }
}
