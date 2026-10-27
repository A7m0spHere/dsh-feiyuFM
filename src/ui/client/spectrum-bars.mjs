// 对话区左缘 ASCII 频谱背景带：本地动画时钟驱动的模拟频谱，不是 WPF 音频
// 的测量值，也不是歌词或节拍识别。音频由原生宿主进程播放，媒体句柄不进 UI
// （见 ARCHITECTURE），网页端拿不到真实 FFT，也没有歌词数据流；观感借鉴
// audioMotion-analyzer 的对数分频、峰值保持与重力下落、快起慢落包络，以及
// soundscape 静默时的"呼吸"待机，全部离线生成。柱体字符按亮度映射到经典
// ASCII 字符集（参考 ASCIIText 的 asciify 思路，不引入 Three.js 或第三方
// 代码）。引擎与渲染为纯函数便于离线测试；组件只负责计时和写 DOM。

export const STRIP_BANDS = 28;
export const ROW_HEIGHT = 12;
export const BAND_MIN = 8;
export const BAND_MAX = 64;
export const FIELD_RAMP = ' .\'`^",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
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

// 把频段值铺成竖向 ASCII 频谱场：每列一个频段（低频在左），柱体围绕中部
// 基线向上生长，下方是更暗的倒影；柱内字符沿高度由疏到密，悬空的峰值用
// 最亮字符标记。phase 给低频柱体加一层缓慢的波浪起伏（参考顶点着色器的
// 轻微形变），只动一两行，保持克制。
export function renderSpectrumField(values, peaks, columns, rows,
  { phase = 0, baseline = 0.54, reflection = 0.5, ramp = FIELD_RAMP } = {}) {
  const cols = Math.max(4, Math.min(64, Math.round(Number(columns) || 0)));
  const rowCount = Math.max(8, Math.min(120, Math.round(Number(rows) || 0)));
  const bands = values?.length ?? 0;
  if (!bands) return [];
  const rampMax = Math.max(1, ramp.length - 1);
  const pick = brightness => ramp[Math.min(rampMax, Math.max(0, Math.floor(brightness * rampMax)))];
  const baselineRow = Math.max(2, Math.min(rowCount - 2, Math.round(rowCount * baseline)));
  const maxBar = baselineRow - 1;
  const sample = (series, band) => {
    const lower = Math.floor(band), upper = Math.min(bands - 1, lower + 1);
    return series[lower] + (series[upper] - series[lower]) * (band - lower);
  };
  const lines = [];
  for (let row = 0; row < rowCount; row++) {
    const cells = new Array(cols).fill(' ');
    for (let column = 0; column < cols; column++) {
      const band = cols === 1 ? 0 : column / (cols - 1) * (bands - 1);
      const value = clamp01(sample(values, band));
      const peak = clamp01(sample(peaks ?? values, band));
      const wave = Math.sin(phase + column * 0.42) * 0.6;
      const bar = Math.max(0, value * maxBar + wave);
      const heightAbove = baselineRow - row;
      if (heightAbove > 0) {
        if (heightAbove <= bar) {
          const towardTip = bar <= 1 ? 1 : (heightAbove - 1) / (bar - 1);
          cells[column] = pick(0.30 + 0.58 * towardTip);
        } else if (peak > value + 0.04 && Math.abs(heightAbove - (peak * maxBar + wave)) < 0.5) {
          cells[column] = ramp[rampMax];
        }
      } else {
        const mirrored = row - baselineRow + 1;
        const reflected = Math.min(maxBar, bar * reflection);
        if (mirrored <= reflected) {
          const towardBase = 1 - (reflected <= 1 ? 1 : mirrored / reflected);
          cells[column] = pick(0.08 + 0.24 * towardBase);
        }
      }
    }
    lines.push(cells.join(''));
  }
  return lines;
}

export function renderSpectrumFieldText(values, peaks, columns, rows, options) {
  return renderSpectrumField(values, peaks, columns, rows, options).join('\n');
}
