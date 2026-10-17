// Web Audio mixer: master ← (sfx, music) gain buses bound to the volume
// settings. The AudioContext is created on the first user gesture (so the
// browser never blocks autoplay) and suspended while the tab is hidden.
// Sounds are ZzFX buffers rendered once per preset and replayed at any pitch.

import type { SettingsStore } from '../settings';
import type { Fx, LogEntry } from '../sim/types';
import { PRESETS, RateLimiter, type SoundId, Streak, type View, type Voice, voiceFor } from './sfx';
import { ZZFX_RATE, zzfxSamples } from './zzfx';

/** Headroom: ZzFX presets are authored hot, so the SFX bus starts lower. */
const SFX_TRIM = 0.35;

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

  /** Rejected commands (warn-level log lines) get a deny buzz. Read-only. */
  consumeLog(log: readonly LogEntry[]): void {
    if (log.some((l) => l.level === 'warn')) this.ui('uiDeny');
  }
}
