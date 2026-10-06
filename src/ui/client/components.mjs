import React from 'react';
import { h } from './shared.mjs';
import { interpolatedPosition } from './presentation.mjs';
export function Svg({ type }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (type === 'headphones') return h('svg', common, h('path', { d: 'M4 13v-1a8 8 0 0 1 16 0v1' }), h('path', { d: 'M4 13h3v7H5a1 1 0 0 1-1-1v-6Zm16 0h-3v7h2a1 1 0 0 0 1-1v-6Z' }));
  if (type === 'more') return h('svg', common, h('circle', { cx: 5, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 19, cy: 12, r: 1, fill: 'currentColor' }));
  if (type === 'play') return h('svg', common, h('path', { d: 'm8 5 11 7-11 7V5Z', fill: 'currentColor', stroke: 'none' }));
  if (type === 'pause') return h('svg', common, h('path', { d: 'M8 5v14M16 5v14', strokeWidth: 2.7 }));
  if (type === 'next') return h('svg', common, h('path', { d: 'M6 5v14l10-7L6 5Z', fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M19 5v14' }));
  if (type === 'close') return h('svg', common, h('path', { d: 'm6 6 12 12M18 6 6 18' }));
  if (type === 'grip') return h('svg', common, h('circle', { cx: 8, cy: 6, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 6, r: 1, fill: 'currentColor' }), h('circle', { cx: 8, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 8, cy: 18, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 18, r: 1, fill: 'currentColor' }));
  return h('svg', common, h('path', { d: 'M5 12h14M12 5l7 7-7 7' }));
}

export function StatusMark({ active }) {
  return active ? h('span', { className: 'fm-wave', 'aria-hidden': true }, h('i'), h('i'), h('i'))
    : h('i', { className: 'fm-dot', 'data-off': true, 'aria-hidden': true });
}

export function PlaybackArtwork({ art, alt = '' }) {
  const base = '/fishfm/assets/';
  // Public packages only ship the project's three generated state images.
  return h('picture', null, h('img', { src: base + `${art}.png`, alt }));
}

/**
 * 播放进度平滑显示：状态每 ~2.2 秒轮询一次，直接渲染会在界面上"跳格"。
 * 以最近一次服务端进度为锚点，播放中按本地时钟插值推进；暂停、切歌或
 * 收到新快照时重新锚定。首次渲染与无锚点时返回服务端原值。
 */
export function useSmoothProgress(current, active) {
  const anchor = React.useRef(null);
  const [, tick] = React.useState(0);
  const id = current?.playInstanceId ?? null;
  const positionMs = current?.positionMs ?? 0;
  React.useEffect(() => {
    anchor.current = { id, at: Date.now(), ms: positionMs };
    if (!active || !id) return undefined;
    const timer = setInterval(() => tick(value => value + 1), 500);
    return () => clearInterval(timer);
  }, [id, positionMs, active]);
  return interpolatedPosition({
    anchor: anchor.current, playInstanceId: id, positionMs,
    durationMs: current?.track?.durationMs, now: Date.now(), active,
  });
}

export function usePresence(open, level) {
  const [retained, setRetained] = React.useState(open);
  React.useEffect(() => {
    if (open) { setRetained(true); return undefined; }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced || level === 'off' ? 0 : level === 'reduced' ? 88 : 160;
    // CSS starts on the next frame. Give its animationend event ownership;
    // the extra margin is a fallback for interrupted/disabled animations.
    const timer = setTimeout(() => setRetained(false), duration ? duration + 80 : 0);
    return () => clearTimeout(timer);
  }, [open, level]);
  return { mounted: open || retained, phase: open ? 'enter' : 'exit',
    onAnimationEnd: event => { if (!open && event.target === event.currentTarget) setRetained(false); } };
}

// Adapted from dsh-api-dashboard v1.4.5 client/client.js:92-135 under MIT.
// Pointer-driven downward swipe closes the quick-control drawer; Escape and
// the close button remain available to keyboard users.
export function SwipeHandle({ onClose }) {
  const st = React.useRef({ y0: 0, dy: 0, t0: 0, drawer: null, dragging: false });
  const setT = (el, dy, anim) => {
    if (!el) return;
    el.style.transition = anim ? 'transform var(--fm-base) var(--fm-ease)' : 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  const down = (e) => {
    const s = st.current;
    s.y0 = e.clientY; s.dy = 0; s.t0 = Date.now(); s.dragging = true;
    s.drawer = e.currentTarget.closest('.fm-float-drawer');
    if (s.drawer) s.drawer.style.transition = 'none';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* PointerCapture is optional */ }
  };
  const move = (e) => {
    const s = st.current;
    if (!s.dragging) return;
    s.dy = Math.max(0, e.clientY - s.y0);
    setT(s.drawer, s.dy, false);
  };
  const end = () => {
    const s = st.current;
    if (!s.dragging) return;
    s.dragging = false;
    const elapsed = Math.max(1, Date.now() - s.t0);
    const fast = s.dy > 24 && s.dy / elapsed > .55;
    if (s.dy > 72 || fast) {
      // The shared presence transition owns exit and its reduced-motion timing.
      if (s.drawer) { s.drawer.style.transition = ''; s.drawer.style.transform = ''; }
      onClose();
    } else setT(s.drawer, 0, true);
  };
  return h('button', { type: 'button', className: 'fm-handle', 'aria-label': '向下滑动或按下收起快捷控制', title: '向下滑动收起',
    onPointerDown: down, onPointerMove: move, onPointerUp: end, onPointerCancel: end,
    onClick: (e) => { if (e.detail === 0) onClose(); } }, h('span', { className: 'fm-handle-bar' }));
}
