import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, renderSpectrumStripText, spectrumEnergy, hashSeed, STRIP_BANDS, ROW_HEIGHT } from './spectrum-bars.mjs';

// 位置固定在对话区左缘（见 styles.mjs 的 .fm-spectrum-strip），不参与互动；
// 列数按实际宽度与等宽字符宽度测量，行距随高度伸展铺满整列。
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

export function SpectrumStrip({ controller, usePanelInfo }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const rootRef = React.useRef(null);
  const textRef = React.useRef(null);
  const engineRef = React.useRef(null);
  const columnsRef = React.useRef(9);
  const rowsRef = React.useRef(48);
  const progressRef = React.useRef(0);
  const [rows, setRows] = React.useState(48);
  const [rowPixels, setRowPixels] = React.useState(ROW_HEIGHT);
  const snapshot = state.snapshot;
  const current = snapshot?.current;
  const presentation = playbackPresentation(snapshot, state.connected);
  const playing = presentation.active;
  const seedSource = current
    ? `${current.playInstanceId ?? ''}:${current.track?.provider ?? ''}:${current.track?.providerTrackId ?? ''}`
    : 'standby';
  React.useEffect(() => { progressRef.current = progressPercent(current) / 100; });
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) return;
      const nextRows = Math.max(8, Math.min(STRIP_BANDS, Math.floor(rect.height / ROW_HEIGHT)));
      const nextColumns = Math.max(2, Math.min(24, Math.floor(rect.width / measureCharWidth(textRef.current ?? root))));
      const nextRowPixels = Math.round(rect.height / nextRows * 10) / 10;
      columnsRef.current = nextColumns;
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
      if (textRef.current) textRef.current.textContent = renderSpectrumStripText(frame.values, frame.peaks, rowsRef.current, columnsRef.current);
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
  if (!state.spectrumVisible || activePanelId === 'fishfm') return null;
  return h('div', { ref: rootRef, className: 'fm-spectrum-strip', 'data-active': playing,
    'data-motion': state.motion || 'full', 'aria-hidden': 'true', style: { '--fm-row': `${rowPixels}px` } },
    h('pre', { ref: textRef }));
}
