// On-screen controls for touch screens (#194): a virtual thrust stick and a strip of buttons for the actions that
// otherwise need a key. The buttons call back through `onAction`, so they run exactly what the keys run; Outpost
// instead arms a one-shot mode that the next tap on an asteroid uses.

import { stickVector } from '../core/gesture';
import type { Vec2 } from '../core/vec';
import type { KeyAction } from '../settings';
import { h, setText } from './dom';

/** Strip actions that run the same code as their key. */
export type TouchAction = Extract<KeyAction, 'map' | 'follow' | 'cycleShip' | 'research' | 'pause' | 'ping'>;

const BUTTONS: { action: TouchAction; text: string; label: string }[] = [
  { action: 'map', text: 'Map', label: 'System map' },
  { action: 'follow', text: 'Follow', label: 'Follow selected ship' },
  { action: 'cycleShip', text: 'Ship ▸', label: 'Select next ship' },
  { action: 'research', text: 'Research', label: 'Research panel' },
  { action: 'ping', text: 'Ping', label: 'Sensor ping' },
  { action: 'pause', text: 'Pause', label: 'Pause' },
];

export class TouchControls {
  readonly el = h('div', { class: 'touch-ctl hidden' });
  private base = h('div', { class: 'stick' });
  private knob = h('div', { class: 'knob' });
  private outpost: HTMLButtonElement;
  private buttons = new Map<TouchAction, HTMLButtonElement>();
  private stickId: number | null = null;
  private vec: Vec2 = { x: 0, z: 0 };
  /** Runs a strip action; Input wires this to the same code its keys run. */
  onAction: (action: TouchAction) => void = () => {};
  /** Set by the Outpost button: the next tap on an asteroid deploys an outpost there. */
  outpostArmed = false;

  constructor(root: HTMLElement) {
    this.base.setAttribute('aria-label', 'Thrust stick');
    this.base.append(this.knob);
    const strip = h('div', { class: 'touch-actions' });
    for (const b of BUTTONS) {
      const btn = h('button', { text: b.text, onclick: () => this.onAction(b.action) });
      btn.setAttribute('aria-label', b.label);
      this.buttons.set(b.action, btn);
      strip.append(btn);
    }
    this.outpost = h('button', { text: 'Outpost', onclick: () => this.setArmed(!this.outpostArmed) });
    this.outpost.setAttribute('aria-label', 'Deploy outpost: tap an asteroid next');
    strip.append(this.outpost);
    this.el.append(this.base, strip);
    root.append(this.el);

    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.moveStick(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.vec = { x: 0, z: 0 };
      this.knob.style.transform = '';
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);
  }

  private moveStick(e: PointerEvent): void {
    const r = this.base.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    this.vec = stickVector(dx, dy, radius);
    // The knob stops at the rim even when the finger slides past it.
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      dx *= radius / d;
      dy *= radius / d;
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }

  get shown(): boolean {
    return !this.el.classList.contains('hidden');
  }

  setShown(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.setArmed(false);
  }

  /** The stick's thrust vector (screen down = +z), zero while hidden or untouched. */
  get thrust(): Vec2 {
    return this.shown ? this.vec : { x: 0, z: 0 };
  }

  setArmed(on: boolean): void {
    this.outpostArmed = on;
    this.outpost.classList.toggle('on', on);
    this.outpost.setAttribute('aria-pressed', String(on));
  }

  /** Mirrors camera follow and manual pause on their buttons. */
  sync(follow: boolean, paused: boolean): void {
    const f = this.buttons.get('follow')!;
    if (f.classList.contains('on') !== follow) f.classList.toggle('on', follow);
    f.setAttribute('aria-pressed', String(follow));
    setText(this.buttons.get('pause')!, paused ? 'Resume' : 'Pause');
  }
}
