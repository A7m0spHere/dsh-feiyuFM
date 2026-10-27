import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, renderSpectrumStripText, spectrumEnergy, hashSeed, INSET_DEFAULT, STRIP_WIDTH, STRIP_BANDS, ROW_HEIGHT } from './spectrum-bars.mjs';

// 与 FloatingPlayer 相同的边界读取：槽位包装层可能是零尺寸元素，
// 真实的绝对定位与停靠边界属于 shell 的 [data-shell-overlay] 框架。
const frameOf = root => (root?.closest?.('[data-shell-overlay]') ?? root?.parentElement)?.getBoundingClientRect();
const MIN_GAP = 40; // 拖到最右也保留一点可见宽度

export function SpectrumStrip({ controller, usePanelInfo }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const rootRef = React.useRef(null);
  const textRef = React.useRef(null);
  const engineRef = React.useRef(null);
  const rowsRef = React.useRef(48);
  const progressRef = React.useRef(0);
  const drag = React.useRef(null);
  const [dragInset, setDragInset] = React.useState(null);
  const [rows, setRows] = React.useState(48);
  const [rowPixels, setRowPixels] = React.useState(ROW_HEIGHT);
  const snapshot = state.snapshot;
  const current = snapshot?.current;
  const presentation = playbackPresentation(snapshot, state.connected);
  const playing = presentation.active;
  const inset = dragInset ?? state.spectrumInset?.left ?? INSET_DEFAULT;
  const seedSource = current
    ? `${current.playInstanceId ?? ''}:${current.track?.provider ?? ''}:${current.track?.providerTrackId ?? ''}`
    : 'standby';
  React.useEffect(() => { progressRef.current = progressPercent(current) / 100; });
  // 行数随视口高度变化，行距随之伸展，让细带铺满对话区左缘。
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      if (rect.height <= 0) return;
      const nextRows = Math.max(8, Math.min(STRIP_BANDS, Math.floor(rect.height / ROW_HEIGHT)));
      const nextRowPixels = Math.round(rect.height / nextRows * 10) / 10;
      rowsRef.current = nextRows;
      setRows(previous => (previous === nextRows ? previous : nextRows));
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
    if (!engineRef.current || engineRef.current.bands !== STRIP_BANDS) {
      engineRef.current = createSpectrumEngine({ bands: STRIP_BANDS, seed });
    } else engineRef.current.reseed(seed);
    const engine = engineRef.current;
    const prefersReduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const level = state.motion === 'off' ? 'off'
      : state.motion === 'reduced' || prefersReduced ? 'reduced' : 'full';
    const render = frame => {
      if (textRef.current) textRef.current.textContent = renderSpectrumStripText(frame.values, frame.peaks, rowsRef.current);
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
  }, [playing, rows, seedSource, state.motion, state.snapshot?.revision]);
  // 窗口变窄时把细带收回可见范围，和悬浮条的 keepInFrame 同一策略。
  React.useEffect(() => {
    const keepInFrame = () => {
      const frame = frameOf(rootRef.current);
      if (!frame || frame.width <= 0) return;
      const preferred = controller.getSnapshot().spectrumInset?.left ?? INSET_DEFAULT;
      const clamped = Math.max(0, Math.min(frame.width - MIN_GAP, preferred));
      if (clamped !== preferred) controller.setSpectrumInset(clamped);
    };
    keepInFrame();
    window.addEventListener('resize', keepInFrame);
    return () => window.removeEventListener('resize', keepInFrame);
  }, [controller, state.spectrumInset, activePanelId, state.spectrumVisible]);
  function dragStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = rootRef.current?.getBoundingClientRect(), frame = frameOf(rootRef.current);
    if (!rect || !frame) return;
    drag.current = { startX: event.clientX, inset: rect.left - frame.left, maxInset: Math.max(0, frame.width - MIN_GAP) };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* PointerCapture is optional */ }
    event.preventDefault();
  }
  function dragMove(event) {
    if (!drag.current) return;
    const next = drag.current;
    next.inset = Math.max(0, Math.min(next.maxInset, next.inset + event.clientX - next.startX));
    next.startX = event.clientX;
    setDragInset(next.inset);
  }
  function dragEnd() {
    if (!drag.current) return;
    controller.setSpectrumInset(drag.current.inset);
    drag.current = null;
    setDragInset(null);
  }
  function nudge(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const frame = frameOf(rootRef.current);
    const maxInset = frame ? Math.max(0, frame.width - MIN_GAP) : INSET_DEFAULT;
    const from = controller.getSnapshot().spectrumInset?.left ?? INSET_DEFAULT;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? maxInset
      : Math.max(0, Math.min(maxInset, from + (event.key === 'ArrowRight' ? 16 : -16)));
    controller.setSpectrumInset(next);
  }
  if (!state.spectrumVisible || activePanelId === 'fishfm') return null;
  const status = playing ? '正在律动' : snapshot?.paused ? '已暂停' : '待机呼吸';
  return h('div', { ref: rootRef, className: 'fm-spectrum-strip', role: 'slider', tabIndex: 0,
    'aria-label': '频谱细带左边界', 'aria-orientation': 'horizontal',
    'aria-valuemin': 0, 'aria-valuemax': 4096, 'aria-valuenow': Math.round(inset),
    'aria-valuetext': `距左侧 ${Math.round(inset)} 像素`,
    title: `ASCII 频谱细带 · ${status} · 模拟律动，非音频测量；拖动或用方向键调整位置`,
    'data-active': playing, 'data-motion': state.motion || 'full',
    style: { left: `${inset}px`, width: `${STRIP_WIDTH}px`, '--fm-row': `${rowPixels}px` },
    onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd, onKeyDown: nudge },
    h('pre', { ref: textRef, 'aria-hidden': true }));
}
