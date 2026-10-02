import { css } from './styles.mjs';
import { h } from './shared.mjs';
import { createController } from './controller.mjs';
import { Panel } from './panel.mjs';
import { FloatingPlayer } from './floating.mjs';
function Icon() {
  return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
    h('path', { d: 'M9 18V5l12-2v13M9 18c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Zm12-2c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Z' }));
}

export function apply(ctx) {
  const controller = createController(ctx.connection);
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = 'fishfm'; style.textContent = css; document.head.appendChild(style);
    return () => { controller.dispose(); style.remove(); };
  });
  // DSH 0.2.0-rc.1 maps null to the Conversation; 'conversation' is not a
  // registered third-party main panel key.
  const inject = () => ({ controller, back: () => ctx.layout.selectPanel(null) });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'fishfm', inject }, Panel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'fishfm', order: 25, label: () => '肥鱼电台' }, Icon));
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'fishfm', order: 65, label: () => '肥鱼电台', inject }, Panel));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'fishfm.player', order: 30,
    inject: () => ({ controller, layout: ctx.layout }) }, FloatingPlayer));
}
