import React from 'react';
import { h, progressPercent } from './shared.mjs';
import { playbackPresentation } from './presentation.mjs';
import { createSpectrumEngine, createSpectrumDriver, renderSpectrumScene, spectrumWhaleLine, spectrumEnergy, hashSeed, STRIP_BANDS, ROW_HEIGHT } from './spectrum-bars.mjs';
import { createWhaleDirector, stampWhale } from './spectrum-whale.mjs';
import { createSpectrumPainter } from './spectrum-canvas.mjs';

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
const FRAME_INTERVAL = 1000 / 24; // 完整档：亚字符运动，固定模拟步长仍为 1/60s
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
    const width = context.measureText('M').width;
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

// 柱群与鲸鱼共用合成路径：先生成亮度场，再将鲸鱼写进同一张字符矩阵，
// 最后用一个透明 Canvas 绘制。尺寸变化
// 后的重画也要经过这里，否则鲸鱼会在重画后凭空消失一帧。
function composeField(painter, frame, whale, columns, rows, phase, fluid = true) {
  if (!painter || !frame) return;
  const strength = whale ? whale.phase === 'lurk' ? 0.65 : whale.phase === 'ripple' ? whale.ripple.fade * 0.35 : 0.4 : 0;
  const fieldOptions = { phase, fluid, ramp: painter.ramp };
  let scene = renderSpectrumScene(frame.values, frame.peaks, columns, rows, fieldOptions);
  if (whale) {
    // 选定一个纵向频段带，从该带的右端附近浮出。行带不随条长变化；同次事件
    // 固定行/列比例，避免被伸缩的条端拖着跳；缩窗仍在同一张字符网格内重画。
    if (!Number.isFinite(whale.waterLineRatio)) whale.waterLineRatio = spectrumWhaleLine(scene, whale) / rows;
    const line = Math.round(whale.waterLineRatio * rows);
    const width = whale.frame?.[0]?.length ?? 8;
    if (!Number.isFinite(whale.columnRatio)) {
      const band = scene.bars.reduce((closest, item) => Math.abs(item.center - line) < Math.abs(closest.center - line) ? item : closest,
        scene.bars[0]);
      whale.columnRatio = Math.max(1, Math.min(columns - width - 1, Math.round((band?.end ?? columns * 0.6) - width * 0.65))) / columns;
    }
    const column = Math.max(1, Math.min(columns - width - 1, Math.round(whale.columnRatio * columns)));
    scene = renderSpectrumScene(frame.values, frame.peaks, columns, rows, { ...fieldOptions,
      disturbance: { center: line, width: (whale.frame?.length ?? 5) * 1.6, strength } });
    stampWhale(scene.grid, { ...whale, column }, { waterLine: line, columns, offsets: scene.offsets });
  }
  painter.paint(scene);
}

// whaleEager 只给预览 harness 与回归用：生产注册不传，彩蛋保持默认的低频
// 节奏。用布尔 props 而不是 window 开关，避免页面脚本能改写彩蛋频率。
export function SpectrumBackdrop({ controller, usePanelInfo, whaleEager = false, spectrumFluid = true }) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
  const rootRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const painterRef = React.useRef(null);
  const engineRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const phaseRef = React.useRef(0);
  const activeRef = React.useRef(false);
  const listeningRef = React.useRef(false);
  const whaleVisualRef = React.useRef(null);
  const seedSourceRef = React.useRef('standby');
  const columnsRef = React.useRef(24);
  const rowsRef = React.useRef(48);
  const progressRef = React.useRef(0);
  const geometryRef = React.useRef(null);
  const [geometry, setGeometry] = React.useState(null);
  const [columns, setColumns] = React.useState(24);
  const [rows, setRows] = React.useState(48);
  const [rowPixels, setRowPixels] = React.useState(ROW_HEIGHT);
  const [systemReduced, setSystemReduced] = React.useState(() =>
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  React.useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = event => setSystemReduced(event.matches);
    query?.addEventListener?.('change', changed);
    return () => query?.removeEventListener?.('change', changed);
  }, []);
  const snapshot = state.snapshot;
  const current = snapshot?.current;
  const presentation = playbackPresentation(snapshot, state.connected);
  // 彩蛋的"在听"判据比界面播放态更宽松：切歌时 Core 会短暂进入 resolving，
  // 界面因此掉出 active。如果按界面状态推进，每次换歌都会把冷却清零，彩蛋
  // 永远攒不够时间。暂停、停止、出错才是用户真的不想听了，必须立刻取消。
  const listening = Boolean(state.connected && snapshot) && !snapshot.paused
    && !snapshot.lastError && snapshot.status !== 'idle';
  // 已开始的音乐跨 resolving 间隙保持背景能量，避免水平条突然全部缩回左端。
  // 首次准备不提前启动，暂停/停止仍取消。
  const playing = presentation.active || (listening && activeRef.current);
  const seedSource = current
    ? `${current.playInstanceId ?? ''}:${current.track?.provider ?? ''}:${current.track?.providerTrackId ?? ''}`
    : 'standby';
  // 播放状态与进度都走 ref：它们每几秒就变一次，写进 effect 依赖会让整条
  // 动画循环重启。模拟循环在下一帧自己读取最新值。
  React.useEffect(() => { progressRef.current = progressPercent(current) / 100; });
  React.useEffect(() => { activeRef.current = playing; });
  React.useEffect(() => { listeningRef.current = listening; });
  React.useEffect(() => { seedSourceRef.current = seedSource; }, [seedSource]);
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
          const charWidth = measureCharWidth(canvasRef.current ?? root);
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
  // 只做采样，因此 60Hz／144Hz 屏幕和 24fps／240ms 两档得到的运动速度一致；
  // 标签页挂起后靠驱动层的追赶上限平滑恢复，不补画整段空档。
  React.useEffect(() => {
    if (!visible) return undefined;
    const engine = engineRef.current;
    if (!engine) return undefined;
    const level = state.motion === 'off' ? 'off'
      : state.motion === 'reduced' || systemReduced ? 'reduced' : 'full';
    painterRef.current = createSpectrumPainter(canvasRef.current);
    const driver = createSpectrumDriver({ engine,
      initialFrame: frameRef.current, initialPhase: phaseRef.current });
    const whale = createWhaleDirector({
      seed: hashSeed(`whale:${seedSourceRef.current}`),
      // 预览里点了「鲸鱼彩蛋」就跳过长冷却，方便截图；生产不传这个 prop。
      ...(whaleEager ? { cooldown: 0, firstDelay: 0, chance: 1 } : {}),
    });
    const paint = () => {
      const { frame, phase } = driver;
      frameRef.current = frame;
      phaseRef.current = phase;
      if (!canvasRef.current || !geometryRef.current) return;
      composeField(painterRef.current, frame, whaleVisualRef.current,
        columnsRef.current, rowsRef.current, phase, spectrumFluid);
      // 只给验收与排障读：彩蛋此刻的阶段，不参与渲染决策。
      if (rootRef.current) rootRef.current.dataset.whale = whaleVisualRef.current?.phase ?? 'none';
    };
    const options = () => ({ energy: spectrumEnergy(progressRef.current), active: activeRef.current });
    // 静态档也响应宿主主题：Canvas 的字色烘进像素，不能只靠 CSS 换透明度。
    const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(paint) : null;
    for (const target of [document.documentElement, document.body]) if (target) themeObserver?.observe(target,
      { attributes: true, attributeFilter: ['class', 'data-theme', 'data-ds-dark-theme'] });
    if (level === 'off') {
      // 关闭动效：预积分一段静默时间，只画一张静态呼吸基线，鲸鱼不出现。
      driver.settle(2.4, { energy: spectrumEnergy(progressRef.current), active: false });
      whaleVisualRef.current = null;
      paint();
      return () => { themeObserver?.disconnect(); painterRef.current = null; };
    }
    // 从当前时刻起算，并先积一步，避免第一帧 rAF 前出现空白字符场。
    driver.reset(performanceNow());
    if (!frameRef.current) driver.settle(0, options());
    paint();
    let animationFrame = 0, timer = 0, lastDraw = 0;
    let activeSeconds = 0;
    const tick = () => {
      const now = performanceNow();
      if (!geometryRef.current) {
        driver.reset(now); whale.cancel(); whaleVisualRef.current = null;
        return;
      }
      const ticked = driver.advance(now, options());
      // 彩蛋只在完整动效、真实播放且网格够宽时推进；任何一条不满足都会
      // 立刻取消当前动画（暂停、停止、关闭效果、减少动态都由这里兜住）。
      const motion = level === 'full';
      const delta = ticked.changed ? ticked.steps * driver.step : 0;
      const listening = listeningRef.current && motion;
      const visual = whale.advance(delta, {
        active: listening,
        allowed: motion && Boolean(geometryRef.current),
        columns: columnsRef.current,
        rows: rowsRef.current,
      });
      if (listening) activeSeconds += delta;
      if (visual) {
        visual.waterLineRatio = whaleVisualRef.current?.waterLineRatio;
        visual.columnRatio = whaleVisualRef.current?.columnRatio;
      }
      whaleVisualRef.current = visual ?? null;
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now - ((now - lastDraw) % FRAME_INTERVAL);
      paint();
      // 只给验收与排障读：彩蛋导演累计推进了多久（暂停期间不增长）。
      if (rootRef.current) rootRef.current.dataset.whaleAge = activeSeconds.toFixed(1);
    };
    const onVisibility = () => {
      // 后台期间不推进模拟；回到前台从当前时刻重新计时，避免整段追赶。
      driver.reset(performanceNow());
      // 后台期间彩蛋也停掉，避免回到前台看到半截鲸鱼。
      whale.cancel();
      whaleVisualRef.current = null;
      lastDraw = 0;
      paint();
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
      themeObserver?.disconnect();
      whale.cancel();
      whaleVisualRef.current = null;
      painterRef.current = null;
    };
  }, [visible, state.motion, whaleEager, spectrumFluid, systemReduced]);
  // 网格尺寸变化只影响采样分辨率，不重启动画：用最近一帧按新列数／行数重画。
  // 这里必须带上当前鲸鱼，否则改窗口宽度的瞬间鲸鱼会从画面里消失。
  React.useEffect(() => {
    composeField(painterRef.current, frameRef.current, whaleVisualRef.current,
      columnsRef.current, rowsRef.current, phaseRef.current, spectrumFluid);
  }, [columns, rows, rowPixels, visible]);
  if (!visible) return null;
  const style = geometry
    ? { left: `${geometry.left}px`, top: `${geometry.top}px`, width: `${geometry.width}px`, height: `${geometry.height}px`, '--fm-row': `${rowPixels}px` }
    : { display: 'none' };
  return h('div', { ref: rootRef, className: 'fm-spectrum-bg', 'data-active': playing,
    'data-ready': geometry ? 'true' : undefined, 'data-motion': state.motion || 'full',
    'data-columns': columns, 'data-rows': rows,
    'aria-hidden': 'true', style: { ...style, pointerEvents: 'none' } }, h('canvas', { ref: canvasRef }));
}
