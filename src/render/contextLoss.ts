// WebGL context loss: the browser may drop the canvas context at any time. The
// listener prevents the default so the browser may restore it, and reports the
// first loss only; the app recovers by reloading, not by rebuilding GPU state.

/** Calls `onLost` on the first `webglcontextlost` event from `target`. Returns an unsubscribe function. */
export function watchContextLoss(target: EventTarget, onLost: () => void): () => void {
  let fired = false;
  const listener = (e: Event): void => {
    e.preventDefault();
    if (fired) return;
    fired = true;
    onLost();
  };
  target.addEventListener('webglcontextlost', listener);
  return () => target.removeEventListener('webglcontextlost', listener);
}
