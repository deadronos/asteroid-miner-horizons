// Tooltip positioning helper: keeps the popup off the cursor/target and on-screen.

import { clamp } from '../core/vec';

export interface TooltipPlacementInput {
  x: number;
  y: number;
  tooltipW: number;
  tooltipH: number;
  viewportW: number;
  viewportH: number;
  gap?: number;
  margin?: number;
}

/** Start of a `size`-long span placed `gap` after `p`, else `gap` before it, or null when neither side fits. */
function offset(p: number, size: number, view: number, gap: number, margin: number): number | null {
  if (p + gap + size <= view - margin) return p + gap;
  if (p - gap - size >= margin) return p - gap - size;
  return null;
}

/**
 * Places a tooltip below-right of the cursor, flipping an axis only when that
 * side would overflow, and clamps it to the viewport. While one axis still fits
 * beside the cursor, the clamped other axis cannot put the tooltip over it.
 */
export function placeTooltip({
  x,
  y,
  tooltipW,
  tooltipH,
  viewportW,
  viewportH,
  gap = 20,
  margin = 8,
}: TooltipPlacementInput): { x: number; y: number } {
  const w = Math.max(0, tooltipW);
  const h = Math.max(0, tooltipH);
  // Neither side fits: lean towards the roomier side and let the clamp pull it in.
  const rawX = offset(x, w, viewportW, gap, margin) ?? (x < viewportW / 2 ? x + gap : x - w - gap);
  const rawY = offset(y, h, viewportH, gap, margin) ?? (y < viewportH / 2 ? y + gap : y - h - gap);
  const maxX = Math.max(margin, viewportW - w - margin);
  const maxY = Math.max(margin, viewportH - h - margin);
  return {
    x: Math.round(clamp(rawX, margin, maxX)),
    y: Math.round(clamp(rawY, margin, maxY)),
  };
}
