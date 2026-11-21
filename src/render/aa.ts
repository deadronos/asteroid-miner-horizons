// Antialiasing routing: which frames go through the bloom composer and which
// draw straight to the canvas. Kept apart from Renderer.ts so it tests in node.

/**
 * Whether the WebGL context is created with `antialias`. With a bloom preset at startup the composer's
 * MSAA target carries the antialiasing, so the context skips its own MSAA backbuffer.
 */
export function contextAntialias(antialias: boolean, startupBloom: number): boolean {
  return antialias && startupBloom === 0;
}

/**
 * Whether a frame renders through the composer. Low quality bypasses the composer entirely so struggling GPUs
 * avoid the half-float MSAA target. Otherwise bloom on always uses it, and bloom off still needs it when AA is
 * wanted but the context has none (a runtime switch to a no-bloom preset).
 */
export function useComposer(bloomOn: boolean, wantAA: boolean, contextAA: boolean, lowQuality = false): boolean {
  return !lowQuality && (bloomOn || (wantAA && !contextAA));
}
