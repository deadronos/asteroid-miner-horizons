// Fixed-step accumulator: turns variable frame time into whole sim steps, carrying the remainder.

/** Most steps run in one frame; at 60 Hz this covers the loop's full 0.25 s frame clamp. */
export const MAX_STEPS_PER_FRAME = 15;

/** Backlog (seconds) carried between frames. Beyond it the device has stalled and the excess is dropped. */
export const MAX_BACKLOG = 1;

export interface Stepper {
  /** Frame time not yet turned into steps, in seconds. */
  acc: number;
  /** Total sim seconds discarded because of stalls. */
  dropped: number;
}

export function newStepper(): Stepper {
  return { acc: 0, dropped: 0 };
}

/** Adds `dt` seconds and returns how many `step`-sized ticks to run now; drops backlog past MAX_BACKLOG. */
export function takeSteps(s: Stepper, dt: number, step: number): number {
  s.acc += dt;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(s.acc / step));
  s.acc -= steps * step;
  if (s.acc > MAX_BACKLOG) {
    const keep = s.acc % step;
    s.dropped += s.acc - keep;
    s.acc = keep;
  }
  return steps;
}
