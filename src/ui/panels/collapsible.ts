// Shared tiny heading builder for panels that can collapse to their title row.

import { h } from '../dom';

/** A panel heading with a chevron button that toggles collapsed/open state. */
export function collapsibleHeading(title: string, collapsed: boolean, onToggle: () => void): HTMLElement {
  const btn = h('button', {
    class: 'icon collapse-toggle',
    text: collapsed ? '▸' : '▾',
    title: `${collapsed ? 'Expand' : 'Collapse'} ${title}`,
    onclick: (e) => {
      e.stopPropagation();
      onToggle();
    },
  });
  btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title} panel`);
  return h('h3', { class: 'panel-head' }, h('span', { class: 'panel-title', text: title }), btn);
}
