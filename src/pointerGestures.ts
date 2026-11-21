// Canvas pointer, touch and wheel gestures (#194). Translates multi-touch
// pinch-zoom, drag-pan, wheel zoom, tap, long-press and mouse click events into
// high-level callbacks while tracking hover pointer position and tap-tooltip lifetime.

import { type Point, pinchStep } from './core/gesture';

/** How long a still finger must stay down to count as a long-press (the right click), in ms. */
const LONG_PRESS_MS = 450;
/** How far a press may wander and still be a click or tap, in pixels: mouse, then touch. */
const CLICK_SLOP = 6;
const TAP_SLOP = 10;
/** How far a pinch's midpoint must get from where it started before it also pans (dropping camera follow), in px. */
const PINCH_PAN_SLOP = 12;
/** How long a tap keeps the hover tooltip up for what was tapped, in ms. */
const TAP_TIP_MS = 2500;

export interface PointerGestureCallbacks {
  onPan: (dx: number, dy: number) => void;
  onZoom: (factor: number, cx: number, cy: number) => void;
  onClick: (x: number, y: number, keepSelection?: boolean) => void;
  onTap: (x: number, y: number) => void;
  zoomSpeed: () => number;
}

/** Tracks active pointers, drag/pinch gestures, long-press timer and hover coordinates on a canvas. */
export class PointerGestures {
  mouse = { x: -1, y: -1, inside: false };
  private drag: { x: number; y: number; button: number; moved: boolean; touch: boolean; long: boolean } | null = null;
  /** Every pointer currently down on the canvas, by `pointerId`. */
  private pointers = new Map<number, Point>();
  /** The current pinch's net midpoint movement, until it passes the pan slop; null once the pinch pans. */
  private pinchDrift: Point | null = null;
  private longPress: ReturnType<typeof setTimeout> | undefined;
  /** While a tap's tooltip shows: when it hides, from `performance.now()`. 0 otherwise. */
  private tipUntil = 0;

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const touch = e.pointerType === 'touch';
    if (touch) this.hideTapTip();
    if (this.pointers.size > 1) {
      // A second finger turns the gesture into a pinch: no tap, long-press or one-finger pan.
      this.drag = null;
      this.pinchDrift = { x: 0, y: 0 };
      this.clearLongPress();
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, touch, long: false };
    if (touch) this.longPress = setTimeout(() => this.onLongPress(), LONG_PRESS_MS);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    const prev = this.pointers.get(e.pointerId);
    const next = { x: e.clientX, y: e.clientY };
    if (prev) this.pointers.set(e.pointerId, next);
    if (prev && this.pointers.size === 2) {
      const other = [...this.pointers].find(([id]) => id !== e.pointerId)![1];
      const step = pinchStep(prev, other, next, other);
      // Fingers report one at a time, so the midpoint jitters during a plain pinch; only net drift pans.
      const drift = this.pinchDrift;
      if (drift) {
        drift.x += step.dx;
        drift.y += step.dy;
        if (Math.hypot(drift.x, drift.y) > PINCH_PAN_SLOP) this.pinchDrift = null;
      } else this.cb.onPan(step.dx, step.dy);
      if (step.zoom !== 1) this.cb.onZoom(step.zoom, step.cx, step.cy);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < (d.touch ? TAP_SLOP : CLICK_SLOP)) return;
    // Right/middle drag always pans; left drag (or one finger) pans too once it moves.
    d.moved = true;
    this.clearLongPress();
    this.cb.onPan(dx, dy);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.release(e, false);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.release(e, true);
  };

  // A lifted finger also leaves the canvas; only the mouse leaving ends the hover.
  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') this.mouse.inside = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.cb.onZoom(Math.exp(e.deltaY * 0.0012 * this.cb.zoomSpeed()), e.clientX, e.clientY);
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cb: PointerGestureCallbacks,
  ) {
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Whether a single-pointer press or drag is currently active. */
  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** Whether the active drag has moved past the click/tap slop threshold. */
  get isMovedDrag(): boolean {
    return !!this.drag?.moved;
  }

  /** Whether a tap-triggered hover tooltip is currently active. */
  get hasTapTip(): boolean {
    return this.tipUntil !== 0;
  }

  /** Pins the hover coordinates to a tapped point for `TAP_TIP_MS`. */
  showTapTip(clientX: number, clientY: number): void {
    this.mouse = { x: clientX, y: clientY, inside: true };
    this.tipUntil = performance.now() + TAP_TIP_MS;
  }

  /** Clears the tap tooltip once its lifetime expires. */
  expireTapTip(): void {
    if (this.tipUntil && performance.now() > this.tipUntil) this.hideTapTip();
  }

  /** Removes all canvas listeners and clears any active long-press timer or gesture state. */
  dispose(): void {
    this.clearLongPress();
    this.pointers.clear();
    this.drag = null;
    this.pinchDrift = null;
    this.tipUntil = 0;
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private clearLongPress(): void {
    clearTimeout(this.longPress);
    this.longPress = undefined;
  }

  private release(e: PointerEvent, cancelled: boolean): void {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    const d = this.drag;
    this.drag = null;
    if (cancelled || !d || d.moved || d.long) return;
    if (d.touch) this.cb.onTap(e.clientX, e.clientY);
    else if (d.button === 0) this.cb.onClick(e.clientX, e.clientY);
    else if (d.button === 2) this.cb.onClick(e.clientX, e.clientY, true);
  }

  /** A still finger held down: the right click at the press point, unless the finger moved or another landed. */
  private onLongPress(): void {
    const d = this.drag;
    if (!d || d.moved) return;
    d.long = true;
    navigator.vibrate?.(12);
    this.cb.onClick(d.x, d.y, true);
  }

  private hideTapTip(): void {
    if (!this.tipUntil) return;
    this.tipUntil = 0;
    this.mouse.inside = false;
  }
}
