// Drag the sidebar's right edge to resize it. Width is saved; double-click the edge to reset.
import { S, save } from '../core/settings.js';

const DEFAULT_W = 330, MIN_W = 260;
const maxW = () => Math.max(MIN_W, Math.min(720, window.innerWidth * 0.6));
const clamp = w => Math.round(Math.min(maxW(), Math.max(MIN_W, w)));

export function initSidebarResize() {
  const app = document.querySelector('.app');
  const handle = document.createElement('div');
  handle.className = 'side-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize the panel · double-click to reset';
  app.appendChild(handle);

  const apply = w => app.style.setProperty('--side-w', clamp(w) + 'px');
  apply(S.sidebarWidth ?? DEFAULT_W);

  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const left = app.getBoundingClientRect().left;
    const move = ev => apply(ev.clientX - left);
    const up = ev => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      S.sidebarWidth = clamp(ev.clientX - left); save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  handle.addEventListener('dblclick', () => { apply(DEFAULT_W); S.sidebarWidth = DEFAULT_W; save(); });
  addEventListener('resize', () => apply(S.sidebarWidth ?? DEFAULT_W));   // keep within limits on window resize
}
