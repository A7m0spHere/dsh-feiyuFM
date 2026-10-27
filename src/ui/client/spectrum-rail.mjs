import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, renderSpectrumText, spectrumEnergy, hashSeed, RAIL_DEFAULT_LEFT, RAIL_WIDTH, RAIL_MARGIN, BAND_MAX, BAND_MIN } from './spectrum-bars.mjs';

// 与 FloatingPlayer 相同的边界读取：槽位包装层可能是零尺寸元素，
// 真实的绝对定位与停靠边界属于 shell 的 [data-shell-overlay] 框架。
const frameOf = root => (root?.closest?.('[data-shell-overlay]') ?? root?.parentElement)?.getBoundingClientRect();

let charCanvas = null;
function measureCharWidth(sample) {
  try {
    charCanvas = charCanvas ?? document.createElement('canvas');
    const context = charCanvas.getContext('2d');
    context.font = getComputedStyle(sample).font;
    const width = context.measureText('█').width;
    return width > 0 ? width : 6.6;
  } catch { return 6.6; }
}

export function SpectrumRail({ controller, usePanelInfo }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const rootRef = React.useRef(null);
  const textRef = React.useRef(null);
  const engineRef = React.useRef(null);
  const columnsRef = React.useRef(8);
  const progressRef = React.useRef(0);
  const drag = React.useRef(null);
  const [dragLeft, setDragLeft] = React.useState(null);
  const [bands, setBands] = React.useState(24);
  const [columns, setColumns] = React.useState(8);
  const [rowPixels, setRowPixels] = React.useState(13);
  const snapshot = state.snapshot;
  const current = snapshot?.current;
  const presentation = playbackPresentation(snapshot, state.connected);
  const playing = presentation.active;
  const left = dragLeft ?? state.spectrumLeft?.left ?? RAIL_DEFAULT_LEFT;
  const seedSource = current
    ? `${current.playInstanceId ?? ''}:${current.track?.provider ?? ''}:${current.track?.providerTrackId ?? ''}`
    : 'standby';
  React.useEffect(() => { progressRef.current = progressPercent(current) / 100; });
  // 尺寸变化决定频段数与列数；块字符宽度按当前字体实测，避免等宽假设失真。
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) return;
      const nextRows = Math.max(BAND_MIN, Math.min(BAND_MAX, Math.floor((rect.height - 20) / ROW_HEIGHT)));
      const nextColumns = Math.max(5, Math.min(12, Math.floor((rect.width - 14) / measureCharWidth(textRef.current ?? root))));
      // 行距随高度伸展，让 ASCII 条铺满整条竖带而不是缩在中间。
      const nextRowPixels = Math.round(Math.max(ROW_HEIGHT, Math.min(22, (rect.height - 20) / nextRows)) * 10) / 10;
      columnsRef.current = nextColumns;
      setBands(previous => (previous === nextRows ? previous : nextRows));
      setColumns(previous => (previous === nextColumns ? previous : nextColumns));
      setRowPixels(previous => (previous === nextRowPixels ? previous : nextRowPixels));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [activePanelId, state.spectrumVisible]);
  // 动画时钟：完整→每帧，轻量→160ms，关闭→静态呼吸基线（预积分一次）。
  // 系统减少动态设置与面板内"轻量"同等对待。
  React.useEffect(() => {
    const seed = hashSeed(seedSource);
    if (!engineRef.current || engineRef.current.bands !== bands) {
      engineRef.current = createSpectrumEngine({ bands, seed });
    } else engineRef.current.reseed(seed);
    const engine = engineRef.current;
    const prefersReduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const level = state.motion === 'off' ? 'off'
      : state.motion === 'reduced' || prefersReduced ? 'reduced' : 'full';
    const render = frame => {
      if (textRef.current) textRef.current.textContent = renderSpectrumText(frame.values, frame.peaks, columnsRef.current);
    };
    if (level === 'off') {
      // 静态呼吸基线：预积分到稳定相位后停表，"关闭"仍保留一个安静的常驻形态。
      let frame = null;
      for (let warm = 0; warm < 48; warm++) {
        frame = engine.step(0.05, { energy: spectrumEnergy(progressRef.current), active: false });
      }
      render(frame);
      return undefined;
    }
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const frame = engine.step(Math.min(0.1, (now - last) / 1000),
        { energy: spectrumEnergy(progressRef.current), active: playing });
      last = now;
      render(frame);
    };
    if (level === 'full') {
      let animationFrame = requestAnimationFrame(function loop() { tick(); animationFrame = requestAnimationFrame(loop); });
      return () => cancelAnimationFrame(animationFrame);
    }
    const timer = setInterval(tick, 160);
    return () => clearInterval(timer);
  }, [playing, bands, columns, seedSource, state.motion, state.snapshot?.revision]);
  // 窗口变窄时把条收回可见范围，和悬浮条的 keepInFrame 同一策略。
  React.useEffect(() => {
    const keepInFrame = () => {
      const root = rootRef.current;
      const frame = frameOf(root), rect = root?.getBoundingClientRect();
      if (!frame || !rect || frame.height <= 0) return;
      const preferred = controller.getSnapshot().spectrumLeft?.left ?? RAIL_DEFAULT_LEFT;
      const clamped = Math.max(RAIL_MARGIN, Math.min(frame.width - rect.width - RAIL_MARGIN, preferred));
      if (clamped !== preferred) controller.setSpectrumLeft(clamped);
    };
    keepInFrame();
    window.addEventListener('resize', keepInFrame);
    return () => window.removeEventListener('resize', keepInFrame);
  }, [controller, state.spectrumLeft, activePanelId, state.spectrumVisible]);
  function dragStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = rootRef.current?.getBoundingClientRect(), frame = frameOf(rootRef.current);
    if (!rect || !frame) return;
    drag.current = { startX: event.clientX, left: rect.left - frame.left, maxLeft: frame.width - rect.width - RAIL_MARGIN };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* PointerCapture is optional */ }
    event.preventDefault();
  }
  function dragMove(event) {
    if (!drag.current) return;
    const next = drag.current;
    next.left = Math.max(RAIL_MARGIN, Math.min(next.maxLeft, next.left + event.clientX - next.startX));
    next.startX = event.clientX;
    setDragLeft(next.left);
  }
  function dragEnd() {
    if (!drag.current) return;
    controller.setSpectrumLeft(drag.current.left);
    drag.current = null;
    setDragLeft(null);
  }
  function nudge(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect(), frame = frameOf(rootRef.current);
    const maxLeft = frame && rect ? Math.max(RAIL_MARGIN, frame.width - rect.width - RAIL_MARGIN) : RAIL_DEFAULT_LEFT;
    const from = controller.getSnapshot().spectrumLeft?.left ?? RAIL_DEFAULT_LEFT;
    const next = event.key === 'Home' ? RAIL_MARGIN : event.key === 'End' ? maxLeft
      : Math.max(RAIL_MARGIN, Math.min(maxLeft, from + (event.key === 'ArrowRight' ? 16 : -16)));
    controller.setSpectrumLeft(next);
  }
  if (!state.spectrumVisible || activePanelId === 'fishfm') return null;
  const status = playing ? '正在跳舞' : snapshot?.paused ? '已暂停' : '待机呼吸';
  return h('div', { ref: rootRef, className: 'fm-spectrum', 'data-active': playing, 'data-motion': state.motion || 'full',
    role: 'img', tabIndex: 0, title: '左右拖动调整位置；方向键微调',
    'aria-label': `ASCII 频谱律动条 · ${status} · 模拟律动，非音频测量`,
    onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd, onKeyDown: nudge,
    style: { left: `${left}px`, width: `${RAIL_WIDTH}px`, '--fm-row': `${rowPixels}px` } },
    h('pre', { ref: textRef, 'aria-hidden': true }));
}
