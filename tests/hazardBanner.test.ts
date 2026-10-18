import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/create';
import { hazardBanner } from '../src/ui/hazardBanner';

const run = () => newGame(3).run;

describe('hazardBanner', () => {
  it('is null when nothing is pending', () => {
    expect(hazardBanner(run())).toBeNull();
  });

  it('describes a comet warning, rounding seconds up', () => {
    const r = run();
    r.hazards.comet = { from: { x: 0, z: 0 }, vel: { x: 1, z: 0 }, belt: 0, timeLeft: 5.2 };
    expect(hazardBanner(r)).toBe('☄ Comet inbound · 6s');
  });

  it('describes flare warning and active phases', () => {
    const r = run();
    r.hazards.flare = { phase: 'warning', timeLeft: 7.5 };
    expect(hazardBanner(r)).toBe('☀ Flare building · 8s');
    r.hazards.flare = { phase: 'active', timeLeft: 4 };
    expect(hazardBanner(r)).toBe('☀ SOLAR FLARE · 4s');
  });

  it('lists the flare first when both are pending', () => {
    const r = run();
    r.hazards.flare = { phase: 'active', timeLeft: 2 };
    r.hazards.comet = { from: { x: 0, z: 0 }, vel: { x: 1, z: 0 }, belt: 0, timeLeft: 3 };
    expect(hazardBanner(r)).toBe('☀ SOLAR FLARE · 2s · ☄ Comet inbound · 3s');
  });
});
