// ASCII 频谱条：本地动画时钟驱动的模拟频谱，不是 WPF 音频的测量值。
// 音频由原生宿主进程播放，媒体句柄不进 UI（见 ARCHITECTURE），网页端拿不到
// 真实 FFT，也没有歌词数据流；观感借鉴 audioMotion-analyzer 的对数分频、
// 峰值保持与重力下落、快起慢落包络，以及 soundscape 静默时的"呼吸"待机，
// 全部离线生成。引擎与渲染为纯函数便于离线测试；组件只负责计时和写 DOM。

export const RAIL_DEFAULT_LEFT = 348; // 常见 DSH 侧栏宽度之后；宿主未提供布局 API，允许拖动微调
export const RAIL_WIDTH = 76;
export const RAIL_MARGIN = 4;
export const BAND_MIN = 8;
export const BAND_MAX = 64;
export const ROW_HEIGHT = 13;
const TIPS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const PEAK_MARK = '▒';
const BEAT_PERIOD = 0.6; // 约 100 BPM 的固定律动；歌曲节拍不可测，只求观感稳定
const PEAK_HOLD_S = 0.42;
const PEAK_GRAVITY = 2.9;
const RISE_RATE = 15;
const FALL_RATE = 4.4;

export function hashSeed(text) {
  let hash = 0x811c9dc5;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = value => Math.max(0, Math.min(1, value));
const lerp = (from, to, weight) => from + (to - from) * weight;

// 歌曲进度 → 整体能量弧：首尾稍 calm、中段更满，避免匀速假感。
export function spectrumEnergy(progress) {
  const bounded = Math.max(0, Math.min(1, Number(progress) || 0));
  return clamp01(0.62 + 0.3 * Math.sin(Math.PI * bounded));
}

export function createSpectrumEngine({ bands = 24, seed = 0 } = {}) {
  const count = Math.max(BAND_MIN, Math.min(BAND_MAX, Math.round(bands) || BAND_MIN));
  const randoms = [], band = [];
  for (let index = 0; index < count; index++) {
    randoms.push(mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0));
    band.push({ value: 0, peak: 0, peakVel: 0, holdUntil: 0, target: 0, nextAt: 0 });
  }
  let beatRandom = mulberry32((seed ^ 0x5f356495) >>> 0);
  const values = new Array(count).fill(0);
  const peaks = new Array(count).fill(0);
  let time = 0, beatPhase = 0, beatAccent = 1;

  // 换曲换种子：同一种子序列确定可复现，不同曲目呈现不同的律动纹样。
  function reseed(nextSeed) {
    for (let index = 0; index < count; index++) {
      randoms[index] = mulberry32((nextSeed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
      const state = band[index];
      state.target = 0; state.nextAt = 0; state.peakVel = 0; state.holdUntil = 0;
    }
    beatRandom = mulberry32((nextSeed ^ 0x5f356495) >>> 0);
    beatAccent = 1; beatPhase = 0;
  }

  function step(dt, { energy = 0.8, active = true } = {}) {
    const delta = Math.max(0, Math.min(0.1, Number(dt) || 0));
    time += delta;
    if (active) {
      beatPhase += delta / BEAT_PERIOD;
      while (beatPhase >= 1) { beatPhase -= 1; beatAccent = 0.7 + 0.6 * beatRandom(); }
    }
    for (let index = 0; index < count; index++) {
      const state = band[index];
      const position = count === 1 ? 0 : index / (count - 1); // 0=低频 … 1=高频
      const base = 0.78 - 0.5 * Math.pow(position, 0.75); // 低频基底高、高频基底低，接近真实频谱的能量分布
      if (time >= state.nextAt) {
        state.target = base * (0.55 + 0.6 * randoms[index]());
        // 低频目标更新更慢：模拟低频段平滑、高频段细碎的动态差异
        state.nextAt = time + (0.16 + 0.5 * randoms[index]()) * (1.4 - 0.9 * position);
      }
      const swell = 1 + 0.1 * Math.sin(time * 0.55 + index * 0.6);
      const pulse = active ? beatAccent * Math.exp(-4.6 * beatPhase) * Math.pow(1 - position, 1.7) * 0.55 : 0;
      const goal = active
        ? clamp01(state.target * (0.55 + 0.6 * energy) * swell + pulse)
        : clamp01(0.05 + 0.05 * (0.5 + 0.5 * Math.sin(time * 0.9 + index * 0.45)));
      const rate = goal > state.value ? RISE_RATE : FALL_RATE;
      state.value = clamp01(lerp(state.value, goal, 1 - Math.exp(-rate * delta)));
      if (state.value >= state.peak) {
        state.peak = state.value; state.peakVel = 0; state.holdUntil = time + PEAK_HOLD_S;
      } else if (time >= state.holdUntil) {
        state.peakVel += PEAK_GRAVITY * delta;
        state.peak = Math.max(state.value, state.peak - state.peakVel * delta);
      }
      values[index] = state.value;
      peaks[index] = state.peak;
    }
    return { values, peaks };
  }

  return { bands: count, reseed, step };
}

// 一行一个频段：█ 主体 + 八分块尖端字符表达亚字符精度，▒ 为重力下落的峰值标记。
// 返回按频段（低→高）排列的行数组；竖条内由调用方决定显示顺序。
export function renderSpectrumRows(values, peaks, columns) {
  const width = Math.max(1, Math.round(Number(columns) || 1));
  return (values ?? []).map((value, index) => {
    const cells = new Array(width).fill(' ');
    const eighths = Math.round(clamp01(Number(value) || 0) * width * 8);
    const full = Math.min(width, Math.floor(eighths / 8));
    for (let cell = 0; cell < full; cell++) cells[cell] = '█';
    const tip = eighths % 8;
    if (tip && full < width) cells[full] = TIPS[tip];
    const occupied = full + (tip ? 1 : 0);
    const peakColumn = Math.ceil(clamp01(Number(peaks?.[index]) || 0) * width);
    if (peakColumn > occupied && peakColumn <= width) cells[peakColumn - 1] = PEAK_MARK;
    return cells.join('');
  });
}

// 条内显示顺序：低频在底、高频在顶（频谱仪侧向放置的习惯方向）。
export function renderSpectrumText(values, peaks, columns) {
  return renderSpectrumRows(values, peaks, columns).reverse().join('\n');
}
