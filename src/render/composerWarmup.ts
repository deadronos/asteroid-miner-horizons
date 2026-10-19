// Shader warm-up for the bloom composer. One off-screen render compiles its programs before the player sees
// them. Imports nothing from three, so it tests in node.

/** The part of EffectComposer the warm-up uses. */
export interface WarmableComposer {
  renderToScreen: boolean;
  render(deltaTime?: number): void;
}

/** 'bloom' is the full chain; 'present' is the bloom-off composer, which covers the #117 runtime fallback. */
export type WarmKey = 'present' | 'bloom';

/**
 * Renders the composer once with its last pass drawing into a target, never the canvas. Program keys depend on
 * the target's colour space, so compiling against the canvas would build variants these targets never use.
 */
export function warmComposer(composer: WarmableComposer): void {
  const toScreen = composer.renderToScreen;
  composer.renderToScreen = false;
  try {
    composer.render(0);
  } finally {
    composer.renderToScreen = toScreen;
  }
}

/**
 * The warm-up a settings state needs: null when frames skip the composer, 'bloom' with bloom on, and 'present'
 * for bloom off. The composer is built with bloom on first in every current path, so 'present' is reached
 * only after 'bloom' has covered it.
 */
export function composerWarmKey(viaComposer: boolean, bloomOn: boolean): WarmKey | null {
  if (!viaComposer) return null;
  return bloomOn ? 'bloom' : 'present';
}

/**
 * Claims the warm-up for `key`. Returns true and records the key when it still needs warming. A warmed 'bloom'
 * covers 'present', so neither is claimed again after 'bloom' has run.
 */
export function claimWarm(key: WarmKey | null, warmed: Set<WarmKey>): boolean {
  if (key === null || warmed.has(key) || warmed.has('bloom')) return false;
  warmed.add(key);
  return true;
}
