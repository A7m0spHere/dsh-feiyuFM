import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, createSpectrumDriver, renderSpectrumFieldText, spectrumEnergy, hashSeed, STRIP_BANDS, ROW_HEIGHT } from './spectrum-bars.mjs';

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
const REDUCED_INTERVAL = 240; // “轻量”档的绘制节拍；模拟时钟仍按真实时间推进

// performance.now 与 rAF 时间戳同一时间基准；缺失时退回 Date.now。
const performanceNow = () => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  } catch { /* 某些嵌入环境屏蔽 performance */ }
  return Date.now();
};

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
  const frameRef = React.useRef(null);
  const phaseRef = React.useRef(0);
  const activeRef = React.useRef(false);
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
  // 播放状态与进度都走 ref：它们每几秒就变一次，写进 effect 依赖会让整条
  // 动画循环重启。模拟循环在下一帧自己读取最新值。
  React.useEffect(() => { progressRef.current = progressPercent(current) / 100; });
  React.useEffect(() => { activeRef.current = playing; });
  // 面板打开或用户关闭背景时整层不渲染，动画循环也随之停止，不留后台空转。
  const visible = Boolean(state.spectrumVisible) && activePanelId !== 'fishfm';
  // 真实容器测量：目标出现／消失、侧栏拖动、正文宽度拖动和窗口缩放都会重算。
  React.useEffect(() => {
    if (!visible) return undefined;
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
  }, [activePanelId, visible]);
  // 引擎与种子：reseed 自己判断种子是否真变了，普通快照刷新不会重置频段目标。
  React.useEffect(() => {
    const seed = hashSeed(seedSource);
    if (!engineRef.current || engineRef.current.bands !== STRIP_BANDS) {
      engineRef.current = createSpectrumEngine({ bands: STRIP_BANDS, seed });
    } else {
      engineRef.current.reseed(seed);
    }
  }, [seedSource]);
  // 动画循环：时间推进与绘制节拍分开。模拟按固定步长由真实时间驱动，绘制
  // 只做采样，因此 60Hz／144Hz 屏幕和 12fps／240ms 两档得到的运动速度一致；
  // 标签页挂起后靠驱动层的追赶上限平滑恢复，不补画整段空档。
  React.useEffect(() => {
    if (!visible) return undefined;
    const engine = engineRef.current;
    if (!engine) return undefined;
    const prefersReduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const level = state.motion === 'off' ? 'off'
      : state.motion === 'reduced' || prefersReduced ? 'reduced' : 'full';
    const driver = createSpectrumDriver({ engine,
      initialFrame: frameRef.current, initialPhase: phaseRef.current });
    const paint = () => {
      const { frame, phase } = driver;
      frameRef.current = frame;
      phaseRef.current = phase;
      if (textRef.current) {
        textRef.current.textContent = renderSpectrumFieldText(frame.values, frame.peaks,
          columnsRef.current, rowsRef.current, { phase });
      }
    };
    const options = () => ({ energy: spectrumEnergy(progressRef.current), active: activeRef.current });
    if (level === 'off') {
      // 关闭动效：预积分一段静默时间，只画一张静态呼吸基线。
      driver.settle(2.4, { energy: spectrumEnergy(progressRef.current), active: false });
      paint();
      return undefined;
    }
    // 从当前时刻起算，并先积一步，避免第一帧 rAF 前出现空白字符场。
    driver.reset(performanceNow());
    if (!frameRef.current) driver.settle(0, options());
    paint();
    let animationFrame = 0, timer = 0, lastDraw = 0;
    const tick = () => {
      const now = performanceNow();
      driver.advance(now, options());
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now;
      paint();
    };
    const onVisibility = () => {
      // 后台期间不推进模拟；回到前台从当前时刻重新计时，避免整段追赶。
      driver.reset(performanceNow());
      lastDraw = 0;
    };
    // 页面隐藏时 rAF 本就不派发；这里只为 setInterval 档和恢复时刻兜底。
    const hidden = () => typeof document !== 'undefined' && document.hidden === true;
    if (level === 'full') {
      animationFrame = requestAnimationFrame(function loop() {
        if (!hidden()) tick();
        animationFrame = requestAnimationFrame(loop);
      });
    } else {
      timer = setInterval(() => { if (!hidden()) tick(); }, REDUCED_INTERVAL);
    }
    document.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(animationFrame);
      clearInterval(timer);
      document.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, [visible, state.motion]);
  // 网格尺寸变化只影响采样分辨率，不重启动画：用最近一帧按新列数／行数重画。
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !textRef.current) return;
    textRef.current.textContent = renderSpectrumFieldText(frame.values, frame.peaks,
      columnsRef.current, rowsRef.current, { phase: phaseRef.current });
  }, [columns, rows, rowPixels, visible]);
  if (!visible) return null;
  const style = geometry
    ? { left: `${geometry.left}px`, top: `${geometry.top}px`, width: `${geometry.width}px`, height: `${geometry.height}px`, '--fm-row': `${rowPixels}px` }
    : { display: 'none' };
  return h('div', { ref: rootRef, className: 'fm-spectrum-bg', 'data-active': playing,
    'data-ready': geometry ? 'true' : undefined, 'data-motion': state.motion || 'full',
    'aria-hidden': 'true', style: { ...style, pointerEvents: 'none' } }, h('pre', { ref: textRef }));
}
