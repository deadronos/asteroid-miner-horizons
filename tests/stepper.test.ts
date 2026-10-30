import { describe, expect, it } from 'vitest';
import { MAX_BACKLOG, MAX_STEPS_PER_FRAME, newStepper, takeSteps } from '../src/core/stepper';

const STEP = 1 / 60;

/** Feeds `frames` frames of `dt` seconds and returns the sim time those frames ran. */
function run(dt: number, frames: number, s = newStepper()): number {
  let steps = 0;
  for (let i = 0; i < frames; i++) steps += takeSteps(s, dt, STEP);
  return steps * STEP;
}

describe('takeSteps', () => {
  it('tracks wall time within 1% at 5 fps', () => {
    const s = newStepper();
    const sim = run(0.2, 100, s);
    expect(Math.abs(sim - 20) / 20).toBeLessThan(0.01);
    expect(s.dropped).toBe(0);
  });

  it('covers a full 0.25 s frame in one go', () => {
    expect(MAX_STEPS_PER_FRAME * STEP).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(takeSteps(newStepper(), 0.25, STEP)).toBe(15);
  });

  it('carries a backlog across frames instead of dropping it', () => {
    const s = newStepper();
    expect(takeSteps(s, 0.5, STEP)).toBe(MAX_STEPS_PER_FRAME);
    expect(takeSteps(s, 0, STEP)).toBe(MAX_STEPS_PER_FRAME);
    expect(s.dropped).toBe(0);
  });

  it('drops and reports a stall longer than the backlog limit', () => {
    const s = newStepper();
    const steps = takeSteps(s, 30, STEP);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(s.acc).toBeLessThan(STEP);
    expect(s.dropped).toBeCloseTo(30 - steps * STEP - s.acc, 9);
    expect(MAX_BACKLOG).toBeGreaterThan(0.25);
  });

  it('runs nothing and drops nothing when the frame is short', () => {
    const s = newStepper();
    expect(takeSteps(s, STEP / 2, STEP)).toBe(0);
    expect(s.dropped).toBe(0);
  });
});
