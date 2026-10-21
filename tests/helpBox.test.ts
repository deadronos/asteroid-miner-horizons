import { describe, expect, it } from 'vitest';
import { HELP_AUTO_HIDE_SEC, shouldAutoHideHelp } from '../src/ui/helpBox';

describe('shouldAutoHideHelp', () => {
  it('hides once the run crosses the auto-hide threshold', () => {
    expect(HELP_AUTO_HIDE_SEC).toBe(180);
    expect(shouldAutoHideHelp(179.9, true, false)).toBe(false);
    expect(shouldAutoHideHelp(180, true, false)).toBe(true);
  });

  it('never auto-hides when already hidden or already auto-hidden once', () => {
    expect(shouldAutoHideHelp(220, false, false)).toBe(false);
    expect(shouldAutoHideHelp(220, true, true)).toBe(false);
  });
});
