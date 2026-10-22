import { describe, expect, it } from 'vitest';
import { LIVE_CONTINUOUS } from '../src/audio/sfx';
import { PAUSED_FRAME_INTERVAL, pauseAudio, pauseBanner, pauseKind, renderDue, type PauseInput } from '../src/pause';

const running: PauseInput = {
  manual: false,
  pauseInMenus: true,
  pauseUnfocused: true,
  menuOpen: false,
  researchOpen: false,
  warpOpen: false,
  focused: true,
};

describe('pauseKind', () => {
  it('is null while the sim runs', () => {
    expect(pauseKind(running)).toBeNull();
  });

  it('reports a manual pause first', () => {
    expect(pauseKind({ ...running, manual: true, menuOpen: true, focused: false })).toBe('manual');
  });

  it('reports an open menu, research panel or warp route picker only when pauseInMenus is on', () => {
    expect(pauseKind({ ...running, menuOpen: true })).toBe('menu');
    expect(pauseKind({ ...running, researchOpen: true })).toBe('menu');
    expect(pauseKind({ ...running, warpOpen: true })).toBe('menu');
    expect(pauseKind({ ...running, menuOpen: true, pauseInMenus: false })).toBeNull();
    // Pins the parens: an open Research panel alone must not bypass the gate.
    expect(pauseKind({ ...running, researchOpen: true, pauseInMenus: false })).toBeNull();
    expect(pauseKind({ ...running, warpOpen: true, pauseInMenus: false })).toBeNull();
  });

  it('reports unfocused only when pauseUnfocused is on', () => {
    expect(pauseKind({ ...running, focused: false })).toBe('unfocused');
    expect(pauseKind({ ...running, focused: false, pauseUnfocused: false })).toBeNull();
  });

  it('prefers menu over unfocused', () => {
    expect(pauseKind({ ...running, menuOpen: true, focused: false })).toBe('menu');
  });
});

describe('pauseBanner', () => {
  it('is null while running and names each pause kind exactly', () => {
    expect(pauseBanner(null)).toBeNull();
    expect(pauseBanner('manual')).toBe('PAUSED: press P to resume');
    expect(pauseBanner('menu')).toBe('PAUSED: menu open');
    expect(pauseBanner('unfocused')).toBe('PAUSED: window not focused');
  });
});

describe('pauseAudio', () => {
  it('leaves both layers live while running', () => {
    expect(pauseAudio(null)).toBe(LIVE_CONTINUOUS);
    expect(Object.isFrozen(LIVE_CONTINUOUS)).toBe(true);
  });

  it('silences hums and the alarm for explicit pauses', () => {
    expect(pauseAudio('manual')).toEqual({ hums: false, alarm: false });
    expect(pauseAudio('menu')).toEqual({ hums: false, alarm: false });
  });

  it('keeps only the alarm while the window is unfocused', () => {
    expect(pauseAudio('unfocused')).toEqual({ hums: false, alarm: true });
  });
});

describe('renderDue', () => {
  it('renders every frame while running', () => {
    expect(renderDue(null, 0, false)).toBe(true);
  });

  it('throttles a frozen sim to its interval', () => {
    expect(renderDue('manual', 1 / 60, false)).toBe(false);
    expect(renderDue('manual', PAUSED_FRAME_INTERVAL.manual, false)).toBe(true);
    expect(renderDue('menu', 1 / 30, false)).toBe(false);
    expect(renderDue('unfocused', PAUSED_FRAME_INTERVAL.manual, false)).toBe(false);
    expect(renderDue('unfocused', PAUSED_FRAME_INTERVAL.unfocused, false)).toBe(true);
  });

  it('renders at once while busy, whatever the pause', () => {
    expect(renderDue('manual', 0, true)).toBe(true);
    expect(renderDue('unfocused', 0, true)).toBe(true);
  });

  it('never renders an unfocused pause more often than a manual one', () => {
    expect(PAUSED_FRAME_INTERVAL.unfocused).toBeGreaterThanOrEqual(PAUSED_FRAME_INTERVAL.manual);
  });
});
