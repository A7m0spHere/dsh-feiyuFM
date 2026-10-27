import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, renderSpectrumFieldText, spectrumEnergy, hashSeed, STRIP_BANDS, ROW_HEIGHT } from './spectrum-bars.mjs';

// 工作区背景层：DSH 没有会话背景插槽（0.2.1-rc.3 的 slot 只有 main／
// conversation.content／shell.*），因此挂在本插件可用的 shell.overlay 条目上，
// 但几何完全由宿主真实容器推导：目标为 [data-conversation-content]（会话正文
// 容器，带稳定语义属性），左缘留白取自 [data-width-handle=left]（会话宽度
// 手柄）与正文的 24px 间距，并随窗口缩放、侧栏拖动、正文宽度拖动重新测量。
// 不使用固定屏幕坐标，不在没有会话正文时渲染。
const OVERLAY = '[data-shell-overlay]';
const TARGET = '[data-conversation-content]';
const MAX_WIDTH = 160; // 参考截图的初始宽度；容器更窄时按留白自适应
const MIN_WIDTH = 72; // 小于此宽度会压到正文，直接不渲染
const FRAME_INTERVAL = 1000 / 12; // 背景层 12fps 足够，避免无意义的逐帧 DOM 写入

let charCanvas = null;
function measureCharWidth(sample) {
  try {
    charCanvas = charCanvas ?? document.createElement('canvas');
    const context = charCanvas.getContext('2d');
    context.font = getComputedStyle(sample).font;
    const width = context.measureText('█').width;
    return width > 0 ? width : 6;
  } catch { return 6; }
}

function readGeometry(root, target) {
  const overlay = root?.closest?.(OVERLAY);
  if (!overlay || !target || !target.isConnected) return null;
  const frame = overlay.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  if (rect.width < 240 || rect.height < 200) return null;
  // 左缘留白：优先用会话宽度手柄（存在时）右缘 + 24px 内容间距；空会话没有
  // 手柄时退回 [data-composer-card]（宿主按正文宽度 + 32px 渲染的输入卡片）；
  // 两者都缺时用宿主正文宽度公式 clamp(680px, 64%, 920px)。
  const handle = target.querySelector('[data-width-handle="left"]');
  const card = target.querySelector('[data-composer-card]');
  let gutter = handle ? handle.getBoundingClientRect().right - rect.left + 24 : NaN;
  if (!(gutter > 0) && card) gutter = card.getBoundingClientRect().left - rect.left + 16;
  if (!(gutter > 0)) {
    const contentWidth = Math.max(680, Math.min(920, rect.width * 0.64));
    gutter = (rect.width - contentWidth) / 2;
  }
  const width = Math.min(MAX_WIDTH, gutter - 12);
  if (width < MIN_WIDTH) return null;
  return { left: Math.round(rect.left - frame.left), top: Math.round(rect.top - frame.top),
    width: Math.round(width), height: Math.round(rect.height) };
}

const sameGeometry = (a, b) => (a === b) || (a && b
  && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

export function SpectrumBackdrop({ controller, usePanelInfo }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const rootRef = React.useRef(null);
  const textRef = React.useRef(null);
  const engineRef = React.useRef(null);
  const columnsRef = React.useRef(24);
  const rowsRef = React.useRef(48);
  const progressRef = React.useRef(0);
  const geometryRef = React.useRef(null);
  const [geometry, setGeometry] = React.useState(null);
  const [columns, setColumns] = React.useState(24);
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
  // 真实容器测量：目标出现／消失、侧栏拖动、正文宽度拖动和窗口缩放都会重算。
  React.useEffect(() => {
    if (!state.spectrumVisible) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    let scheduled = 0;
    let observed = null;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
    function schedule() {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        const target = document.querySelector(TARGET);
        if (observer && target !== observed) {
          if (observed) observer.unobserve(observed);
          observed = target;
          if (target) observer.observe(target);
        }
        const next = readGeometry(root, target);
        if (!sameGeometry(next, geometryRef.current)) {
          geometryRef.current = next;
          setGeometry(next);
        }
        if (next) {
          const charWidth = measureCharWidth(textRef.current ?? root);
          const nextColumns = Math.max(8, Math.min(40, Math.floor((next.width - 4) / charWidth)));
          const nextRows = Math.max(10, Math.min(96, Math.floor(next.height / ROW_HEIGHT)));
          const nextRowPixels = Math.round(next.height / nextRows * 10) / 10;
          columnsRef.current = nextColumns;
          rowsRef.current = nextRows;
          setColumns(previous => (previous === nextColumns ? previous : nextColumns));
          setRows(previous => (previous === nextRows ? previous : nextRows));
          setRowPixels(previous => (previous === nextRowPixels ? previous : nextRowPixels));
        }
      });
    }
    schedule();
    window.addEventListener('resize', schedule);
    // 目标挂载／卸载与宽度偏好变化不都会触发 ResizeObserver，低频巡检兜底。
    const poll = setInterval(schedule, 800);
    return () => {
      cancelAnimationFrame(scheduled);
      clearInterval(poll);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [activePanelId, state.spectrumVisible]);
  // 动画时钟：完整→12fps，轻量→240ms，关闭→静态呼吸基线（预积分一次）。
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
    const render = (frame, phase = 0) => {
      if (textRef.current) {
        textRef.current.textContent = renderSpectrumFieldText(frame.values, frame.peaks,
          columnsRef.current, rowsRef.current, { phase });
      }
    };
    if (level === 'off') {
      let frame = null;
      for (let warm = 0; warm < 48; warm++) {
        frame = engine.step(0.05, { energy: spectrumEnergy(progressRef.current), active: false });
      }
      render(frame);
      return undefined;
    }
    let phase = 0, last = Date.now(), lastDraw = 0, animationFrame = 0;
    const draw = () => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now;
      phase += dt;
      const frame = engine.step(dt, { energy: spectrumEnergy(progressRef.current), active: playing });
      render(frame, phase);
    };
    if (level === 'full') {
      animationFrame = requestAnimationFrame(function loop() { draw(); animationFrame = requestAnimationFrame(loop); });
      return () => cancelAnimationFrame(animationFrame);
    }
    const timer = setInterval(() => { last = Date.now() - 240; draw(); }, 240);
    return () => clearInterval(timer);
  }, [playing, columns, rows, seedSource, state.motion, state.snapshot?.revision]);
  if (!state.spectrumVisible || activePanelId === 'fishfm') return null;
  const style = geometry
    ? { left: `${geometry.left}px`, top: `${geometry.top}px`, width: `${geometry.width}px`, height: `${geometry.height}px`, '--fm-row': `${rowPixels}px` }
    : { display: 'none' };
  return h('div', { ref: rootRef, className: 'fm-spectrum-bg', 'data-active': playing,
    'data-ready': geometry ? 'true' : undefined, 'data-motion': state.motion || 'full',
    'aria-hidden': 'true', style: { ...style, pointerEvents: 'none' } }, h('pre', { ref: textRef }));
}
