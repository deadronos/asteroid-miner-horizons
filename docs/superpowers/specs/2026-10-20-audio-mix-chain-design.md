# Audio mix chain — Design

**Issue:** #167 (child of #154) · **Branch:** `feat/audio-mix-chain`

## Problem

The three audio layers are individually reasonable but do not share a space or a peak
ceiling:

- `AudioEngine` connects `master` straight to `ctx.destination`, so a full fleet of
  one-shots plus the music can sum past 0 dBFS and clip.
- `spatial()` returns gain and pan only. A crack from the far edge of the screen is
  quieter than one at the cursor, but just as bright, so distance is only half-modelled.
- SFX are completely dry while the music has its own feedback delay. Explosions, docking
  chimes and collects have no room around them and sound pasted on top of the mix.

The issue asks for one mix: a master limiter, a distance/zoom lowpass per voice, and one
shared reverb send fed by explosions, docking chimes and collects.

## Decisions

### Master limiter

`master` feeds a `DynamicsCompressorNode` acting as a limiter, then the destination:

```
sfx one-shots ─→ sfx bus ─┐
                          ├─ master ─ limiter ─ destination
music ─────────→ music bus┘
reverb convolver ─────────→ sfx bus (wet return)
```

Settings live in the new pure `src/audio/mix.ts` so the numbers are testable and shared:

| Parameter | Value   | Meaning                                         |
| --------- | ------- | ----------------------------------------------- |
| threshold | -6 dB   | starts catching peaks just below full scale     |
| knee      | 0 dB    | hard knee: limiter, not a gentle bus compressor |
| ratio     | 20:1    | effectively a ceiling at this threshold         |
| attack    | 0.003 s | fast enough to catch a transient                |
| release   | 0.25 s  | recovers between one-shots without pumping      |

A `DynamicsCompressorNode` is the issue's requested limiter and needs no lookahead or
worklet. It cannot make a clipped signal un-clipped after the fact, but it stops the sum
of many voices from reaching the destination above full scale.

### Distance and zoom lowpass

`spatial(pos, view)` returns `[gain, pan, cutoff]`; the third value is a lowpass cutoff in
Hz. It uses the same normalised screen distance `r` as gain, plus the existing zoom
factor, so a source that is quieter because it is far away or because the camera is zoomed
out is also darker:

```ts
cutoff = clamp(
  CENTER_CUTOFF * (EDGE_CUTOFF / CENTER_CUTOFF) ** min(r, 1) * zoom ** 1.5,
  MIN_CUTOFF,
  CENTER_CUTOFF,
);
```

| Constant       | Value | Where it applies                              |
| -------------- | ----- | --------------------------------------------- |
| `CENTER_CUTOFF` | 18000 | screen centre; effectively open               |
| `EDGE_CUTOFF`   | 3200  | screen edge and beyond; audibly darker        |
| `MIN_CUTOFF`    | 900   | floor when zoomed far out                     |
| `zoom`          | 0.4–1 | `sqrt(REF_HALF_H / view.halfH)`, already used for gain |

The curve is geometric, so equal screen steps darken by equal ratios rather than by equal
Hz. The extra `1.5` exponent on zoom makes the whole-system overview read as genuinely
distant (about 4.6 kHz at the centre and the 900 Hz floor at the edge), while the default
top-down zoom is unchanged. `voiceFor` copies the cutoff onto every positional `Voice`; non-positional sounds
(warp, hazard stings, UI clicks, alarm) use `CENTER_CUTOFF`. `beamHums` copies it onto
`BeamHum`, and the hum's existing lowpass becomes `min(freq * 6, cutoff)` so a distant
beam also dulls without changing its pitch.

`AudioEngine.play` inserts one `BiquadFilterNode` (`lowpass`, `Q = 0.7`) per one-shot
between the panner and the SFX bus, set to the voice's cutoff before the source starts.
The filter is disconnected with the rest of the voice when the source ends. The voice cap
is unchanged: the filter is part of the same per-voice chain and is cleaned up with it.

### Shared reverb send

One `ConvolverNode` is created with `start()` and shared by every voice:

- The impulse is generated at runtime from decorrelated stereo noise with a power decay —
  no audio files and no fetch. `reverbImpulse(sampleRate, seconds, decay, rand)` in
  `src/audio/mix.ts` is pure and takes an injected RNG so tests can replay it.
- Impulse length 1.8 s, decay exponent 2.6: a short room rather than a cathedral tail.
- A per-voice send gain taps the **post-lowpass** signal, so the reverb is as dark as the
  dry sound. The send amount is looked up from `REVERB_SEND`:
  `explode` 0.32, `dock` 0.22, `collect` 0.12; every other sound stays fully dry.
- The send is a gain node per voice and is disconnected when the source ends. There is no
  feedback path, so no voice can leave the graph running.
- The convolver output returns through a fixed 0.9 gain into the **SFX bus**, so the
  effects slider and mute also control the reverb tail.

Music keeps its own internal feedback delay. Routing music through the SFX reverb would
make one slider control another layer's space; that is out of scope for #167.

## What can go wrong (and where it is caught)

1. **Distant sounds get quieter but stay bright.** Task 1 pins the cutoff at centre, edge
   and zoomed-out views, and that a voice further from the centre has a lower cutoff than
   one at the centre.
2. **The cutoff mutes loud near sounds** (e.g. a typo sets the centre cutoff to 900 Hz).
   Task 1 asserts the centre cutoff is `CENTER_CUTOFF` and that every value stays inside
   `[MIN_CUTOFF, CENTER_CUTOFF]`.
3. **The limiter is configured but not wired**, or the reverb never gets an impulse.
   Task 4 checks the live graph in the browser (`masterLimiter` settings, non-null
   convolver buffer with the expected duration) and renders the same limiter settings in
   an `OfflineAudioContext` to prove a deliberately hot 12-voice mix peaks at or below
   full scale where the uncompressed control exceeds it.
4. **A reverb send is added to every sound** (mud on UI clicks and alarms) or a tail
   leaks after a voice ends. Task 2 pins the send table (unlisted sounds are dry) and
   Task 3 disconnects the send with the voice.
5. **A full fleet plus alarm plus music still clips.** Task 4's offline mix is the peak
   test; the live probe additionally plays overlapping one-shots through
   `AudioEngine.play` and checks the limiter output.
6. **The voice cap or pause policy regresses.** Tasks 1–3 leave `RateLimiter`, `MAX_VOICES`,
   `MAX_HUMS` and `pauseAudio` untouched; `npm run check` is the gate and Task 4 repeats
   the pause smoke from the #67 run log (hums stop in a menu, alarm follows the policy).

## Blast radius

- `src/audio/sfx.ts`: `spatial` return value, `Voice.cutoff`, `BeamHum.cutoff`,
  `voiceFor`/`beamHums`.
- `src/audio/mix.ts` (new): limiter settings, reverb send table, impulse generator.
- `src/audio/AudioEngine.ts`: master limiter, reverb convolver + return, per-voice
  lowpass and send.
- `tests/audio.test.ts`, `tests/mix.test.ts` (new).
- `README.md` audio bullet.
- `docs/superpowers/{specs,plans}/` + a run log.

Not touched: `src/sim/**`, save format, settings shape, `MusicPlayer`/`music.ts`,
ZzFX presets, the pause policy, the bot and balance report.

## Acceptance criteria mapping (issue #167)

- **A full fleet mining + alarm + music does not clip.** Master limiter (Task 3) plus the
  offline 12-voice peak test (Task 4).
- **Distant cracks are audibly darker.** `spatial` cutoff (Task 1) and the per-voice
  lowpass (Task 3); browser probe in Task 4.
- **The voice cap and pause policy still hold.** Untouched code, existing tests, plus the
  Task 4 live pause check.
