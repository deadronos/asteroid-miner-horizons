// Web Audio mixer: master ← (sfx, music → musicDuck) gain buses bound to the
// volume settings, then through a master limiter into the destination. The
// AudioContext is created on the first user gesture (so the browser never
// blocks autoplay) and suspended while the tab is hidden. One-shots are ZzFX
// buffers rendered once per preset and replayed at any pitch; each runs
// through a per-voice lowpass so distant sounds dull, and a send into a shared
// generated reverb for the wet sounds. Continuous states (beam hums, the
// danger alarm) come from `updateContinuous`, which is called every frame with
// a `ContinuousPolicy` selecting which layers may sound that frame (see
// `pauseAudio`). Generative ambient music (`MusicPlayer`) plays into the music
// bus via `updateMusic`; the alarm, explosions, ship losses and warp briefly
// duck it (see `Ducker`) so they read over the music. Every ~0.1 s
// `consumeLog` collapses the new log lines and fires one rate-limited cue per
// event identity in the batch, after the deny buzz for rejected-command warn
// lines.

import type { SettingsStore } from '../settings';
import type { Fx, GameState, LogEntry } from '../sim/types';
import { Ducker, LIMITER, REVERB_RETURN, REVERB_SEND, reverbImpulse } from './mix';
import { musicIntensity } from './music';
import { MusicPlayer } from './MusicPlayer';
import {
  alarmLevel,
  beamHums,
  CENTER_CUTOFF,
  cueBatch,
  cueVoice,
  type ContinuousPolicy,
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
/** Smoothing time constant for the per-frame music-duck target: removes zipper noise without lag. */
const DUCK_SMOOTH = 0.015;

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
  private musicDuck: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private reverb: ConvolverNode | null = null;
  private player: MusicPlayer | null = null;
  private buffers = new Map<SoundId, AudioBuffer>();
  private limiter = new RateLimiter();
  private streak = new Streak();
  private hums = new Map<number, HumVoice>();
  private nextAlarm = 0;
  private ducker = new Ducker();

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
      this.musicDuck = this.ctx.createGain();

      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      limiter.attack.value = LIMITER.attack;
      limiter.release.value = LIMITER.release;
      this.masterLimiter = limiter;

      const reverb = this.ctx.createConvolver();
      reverb.buffer = this.impulseBuffer(this.ctx);
      const reverbReturn = this.ctx.createGain();
      reverbReturn.gain.value = REVERB_RETURN;
      reverb.connect(reverbReturn).connect(this.sfx);
      this.reverb = reverb;

      this.sfx.connect(this.master);
      this.music.connect(this.musicDuck).connect(this.master);
      this.master.connect(limiter).connect(this.ctx.destination);
      this.player = new MusicPlayer(this.ctx, this.music);
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

  /** Builds the shared stereo reverb impulse once per AudioContext. */
  private impulseBuffer(ctx: AudioContext): AudioBuffer {
    const [left, right] = reverbImpulse(ctx.sampleRate);
    const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
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
    this.ducker.trigger(v.id, v.gain, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(v.id);
    src.playbackRate.value = v.rate;
    const gain = ctx.createGain();
    gain.gain.value = v.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = v.pan;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = v.cutoff;
    filter.Q.value = 0.7;
    src.connect(gain).connect(pan).connect(filter).connect(sfx);
    const send = REVERB_SEND[v.id] ?? 0;
    let wet: GainNode | null = null;
    if (send > 0 && this.reverb) {
      wet = ctx.createGain();
      wet.gain.value = send;
      filter.connect(wet).connect(this.reverb);
    }
    src.addEventListener(
      'ended',
      () => {
        this.limiter.release();
        src.disconnect();
        gain.disconnect();
        pan.disconnect();
        filter.disconnect();
        wet?.disconnect();
      },
      { once: true },
    );
    src.start();
  }

  ui(id: 'uiClick' | 'uiDeny'): void {
    this.play({ id, gain: 1, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
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
   * while the selected ship is in danger. `policy` selects which layers may sound
   * this frame (see `pauseAudio`). Called every frame; read-only on `state`.
   */
  updateContinuous(state: GameState, view: View, policy: ContinuousPolicy): void {
    const { ctx, sfx } = this;
    // Locked or suspended: never start a voice, just fade out whatever is left.
    if (!ctx || !sfx || ctx.state !== 'running') {
      this.silenceHums();
      this.nextAlarm = 0;
      return;
    }
    const now = ctx.currentTime;
    if (policy.hums) {
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
          voice = this.makeHumVoice(ctx, sfx, hum.freq, hum.pan, hum.cutoff);
          this.hums.set(hum.shipId, voice);
        }
        voice.gain.gain.setTargetAtTime(hum.gain * HUM_TRIM, now, HUM_ATTACK);
        voice.osc.frequency.setTargetAtTime(hum.freq, now, HUM_ATTACK);
        voice.filter.frequency.setTargetAtTime(Math.min(hum.freq * 6, hum.cutoff), now, HUM_ATTACK);
        voice.pan.pan.value = hum.pan;
      }
    } else {
      this.silenceHums();
    }
    // Suppressed alarm: leave nextAlarm alone so a due alarm fires right after resume.
    if (policy.alarm) this.updateAlarm(state, now);
  }

  /** Builds a silent osc → lowpass → gain → panner chain and starts the oscillator. */
  private makeHumVoice(ctx: AudioContext, sfx: GainNode, freq: number, pan: number, cutoff: number): HumVoice {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(freq * 6, cutoff);
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
    this.play({ id: 'alarm', gain: 0.35 + 0.5 * level, pan: 0, rate: 1, cutoff: CENTER_CUTOFF });
    this.nextAlarm = now + ALARM_INTERVAL;
  }

  /**
   * Ambient music in the current system's variant of its star-class mood, crossfading on warp and
   * following the flare/comet danger and fleet mining activity, ducked under the loud cues. Keeps playing through pauses; silent
   * until the context runs. Read-only on `state`.
   */
  updateMusic(state: GameState): void {
    const { ctx, player, musicDuck } = this;
    if (!ctx || !player || !musicDuck || ctx.state !== 'running') return;
    musicDuck.gain.setTargetAtTime(this.ducker.level(ctx.currentTime), ctx.currentTime, DUCK_SMOOTH);
    const s = this.settings.value;
    const { system } = state.run;
    const audible = s.volMaster > 0 && s.volMusic > 0;
    player.update(system.starClass, state.profile.seed, system.number, audible, musicIntensity(state.run));
  }

  /** Rejected commands buzz, and each event identity in the batch gets one cue. Read-only. */
  consumeLog(log: readonly LogEntry[]): void {
    const batch = cueBatch(log);
    if (batch.deny) this.ui('uiDeny');
    for (const key of batch.cues) this.play(cueVoice(key));
  }
}
