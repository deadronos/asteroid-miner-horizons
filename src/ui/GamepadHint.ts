// Small controller cheat-sheet (#209), shown only while a gamepad is connected.

import { h } from './dom';

const LINES = [
  ['Left stick / D-pad', 'Fly'],
  ['A', 'Mine nearest · dock'],
  ['B', 'Stop · back'],
  ['RT', 'Sensor ping'],
  ['X', 'Next ship'],
  ['Y', 'Warp routes'],
  ['LB / RB · right stick', 'Zoom'],
  ['Select · Start', 'Map · menu'],
];

export class GamepadHint {
  readonly el = h(
    'div',
    { class: 'pad-hint hidden' },
    ...LINES.map(([k, v]) => h('div', {}, h('b', { text: k }), ` ${v}`)),
  );

  constructor(root: HTMLElement) {
    this.el.setAttribute('aria-label', 'Controller bindings');
    root.append(this.el);
  }

  setShown(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}
