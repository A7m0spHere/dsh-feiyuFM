// 对话区左缘 ASCII 频谱背景带：本地动画时钟驱动的模拟频谱，不是 WPF 音频
// 的测量值，也不是歌词或节拍识别。音频由原生宿主进程播放，媒体句柄不进 UI
// （见 ARCHITECTURE），网页端拿不到真实 FFT，也没有歌词数据流；观感借鉴
// audioMotion-analyzer 的峰值保持与重力下落、快起慢落包络，以及
// soundscape 静默时的"呼吸"待机，全部离线生成。柱体字符按亮度映射到经典
// ASCII 字符集（参考 ASCIIText 的 asciify 思路，不引入 Three.js 或第三方
// 代码）。引擎与亮度场为纯函数；Canvas 只负责按网格与连续位移绘字。

export const STRIP_BANDS = 28;
export const ROW_HEIGHT = 12;
export const BAND_MIN = 8;
export const BAND_MAX = 64;
// 少量可读的密度级；Canvas 启动时按实际等宽字体的墨量校准，而非照搬参考
// 代码的长字符表下标。鲸鱼的 @ % o - 是字形，不参与密度排序。
export const FIELD_RAMP = ' .:;irsX#%@';
const BEAT_PERIOD = 0.6; // 约 100 BPM 的固定律动；歌曲节拍不可测，只求观感稳定
const PEAK_HOLD_S = 0.42;
const PEAK_GRAVITY = 2.9;
const RISE_RATE = 15;
const FALL_RATE = 4.4;

// 模拟时钟：频谱形态必须由真实时间推进，而不是由绘制节拍推进。固定步长积分
// 让 60Hz／144Hz 屏幕和 12fps／24fps／240ms 绘制拿到同一条轨迹；绘制频率只影响
// 采样疏密，不改变速度。单次追赶上限用于标签页挂起后恢复，避免一次性补齐
// 整段空档造成突变。
export const SIM_STEP = 1 / 60;
export const MAX_CATCH_UP_S = 0.25;

export function createSpectrumClock({ step = SIM_STEP, maxCatchUp = MAX_CATCH_UP_S } = {}) {
  const fixed = Math.max(1 / 240, Math.min(0.1, Number(step) || SIM_STEP));
  const cap = Math.max(fixed, Number(maxCatchUp) || MAX_CATCH_UP_S);
  let origin = null, pending = 0;
  // 丢弃已缓存的时间：标签页恢复、切歌或重置状态时用，避免把空档算进模拟。
  const reset = now => { origin = Number.isFinite(now) ? now : null; pending = 0; };
  const advance = now => {
    if (!Number.isFinite(now)) return { steps: 0, seconds: 0, skipped: 0 };
    if (origin === null) { origin = now; return { steps: 0, seconds: 0, skipped: 0 }; }
    const real = Math.max(0, (now - origin) / 1000);
    origin = now;
    const usable = Math.min(real, cap);
    pending += usable;
    const steps = Math.floor(pending / fixed + 1e-9);
    const seconds = steps * fixed;
    pending = Math.max(0, pending - seconds);
    return { steps, seconds, skipped: real - usable };
  };
  return { advance, reset, step: fixed, get pending() { return pending; } };
}

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

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
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
  let time = 0, beatPhase = 0, beatAccent = 1, currentSeed = seed >>> 0;

  // 换曲换种子：同一种子序列确定可复现，不同曲目呈现不同的律动纹样。同一种子
  // 重复调用不做事并返回 false——普通快照刷新不该清掉当前目标。
  function reseed(nextSeed) {
    const value = Number(nextSeed) >>> 0;
    if (value === currentSeed) return false;
    currentSeed = value;
    for (let index = 0; index < count; index++) {
      randoms[index] = mulberry32((value ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
      const state = band[index];
      state.target = 0; state.nextAt = 0; state.peakVel = 0; state.holdUntil = 0;
    }
    beatRandom = mulberry32((value ^ 0x5f356495) >>> 0);
    beatAccent = 1; beatPhase = 0;
    return true;
  }

  // frequencyBands 为将来宿主 FFT 留下的归一化输入口；当前组件不传，仍为
  // 本地模拟。输入只有 0..1 幅度，不接收媒体 URL、PCM 或凭据。
  function step(dt, { energy = 0.8, active = true, frequencyBands = null } = {}) {
    const delta = Math.max(0, Math.min(0.1, Number(dt) || 0));
    time += delta;
    if (active) {
      beatPhase += delta / BEAT_PERIOD;
      while (beatPhase >= 1) { beatPhase -= 1; beatAccent = 0.7 + 0.6 * beatRandom(); }
    }
    for (let index = 0; index < count; index++) {
      const state = band[index];
      const position = count === 1 ? 0 : index / (count - 1); // 0=低频 … 1=高频
      const base = 0.38 + 0.14 * Math.sin(index * 1.71 + currentSeed % 31);
      if (time >= state.nextAt) {
        state.target = base * (0.35 + 1.25 * randoms[index]());
        // 低频目标更新更慢：模拟低频段平滑、高频段细碎的动态差异
        state.nextAt = time + (0.16 + 0.5 * randoms[index]()) * (1.4 - 0.9 * position);
      }
      // 相邻频段共享缓慢流动的能量包，但有各自的峰谷与响应；不再是固定斜坡。
      const swell = 0.78 + 0.26 * Math.sin(time * 1.7 - index * 0.59)
        + 0.14 * Math.sin(time * (2.1 + position * 2.6) + index * 1.37);
      const pulse = active ? beatAccent * Math.exp(-5.5 * beatPhase) * (1 - position) * 0.28 : 0;
      const input = frequencyBands?.length ? sampleSpectrumBand(frequencyBands, position) : null;
      const goal = active
        ? input === null ? clamp01(state.target * (0.65 + 0.65 * clamp01(energy)) * swell + pulse) : input
        : clamp01(0.05 + 0.05 * (0.5 + 0.5 * Math.sin(time * 0.9 + index * 0.45)));
      const rate = goal > state.value ? RISE_RATE * (0.75 + position * 0.8) : FALL_RATE * (0.7 + position * 0.9);
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

// 帧快照：引擎每步复用同一组数组，重绘（例如窗口尺寸变化）需要一份不随
// 引擎继续推进而变化的副本。
export function snapshotFrame(frame) {
  return { values: [...(frame?.values ?? [])], peaks: [...(frame?.peaks ?? [])] };
}

// 驱动层：把"时间推进"和"绘制节拍"分开。clock 只认真实时间，按固定步长
// 产出可结算的模拟步；driver 把步数喂给引擎并维护波浪相位。绘制方可以按任意
// 频率采样，采样频率不再改变运动速度。
export function createSpectrumDriver({ engine, step = SIM_STEP, maxCatchUp = MAX_CATCH_UP_S,
  initialFrame = null, initialPhase = 0 } = {}) {
  if (!engine || typeof engine.step !== 'function') throw new TypeError('spectrum driver needs an engine');
  const clock = createSpectrumClock({ step, maxCatchUp });
  // 接管上一档绘制留下的画面与相位：切换"完整／轻量"时不该闪一帧空白。
  let phase = Number.isFinite(initialPhase) ? initialPhase : 0;
  let frame = initialFrame ?? { values: [], peaks: [] };
  function advance(now, options = {}) {
    const tick = clock.advance(now);
    for (let index = 0; index < tick.steps; index++) {
      frame = engine.step(clock.step, options);
      phase += clock.step;
    }
    return { steps: tick.steps, skipped: tick.skipped, frame, phase, changed: tick.steps > 0 };
  }
  // 静态基线：预积分一段静默时间，供"关闭动效"时一次画完。
  function settle(seconds, options = {}) {
    const steps = Math.max(1, Math.round((Number(seconds) || 0) / clock.step));
    for (let index = 0; index < steps; index++) frame = engine.step(clock.step, options);
    return snapshotFrame(frame);
  }
  return {
    advance, settle, engine, step: clock.step,
    reset: now => clock.reset(now),
    get phase() { return phase; },
    get frame() { return frame; },
  };
}

// 连续亮度场 → 正向可读字符网格：Y 排列频段，X 表示从左基线起的长度。
export function sampleSpectrumBand(series, position) {
  if (!series?.length) return 0;
  const at = clamp01(position) * (series.length - 1);
  const lo = Math.floor(at), hi = Math.min(series.length - 1, lo + 1);
  return lerp(clamp01(series[lo]), clamp01(series[hi]), at - lo);
}

const smoothUnit = value => { const x = clamp01(value); return x * x * (3 - 2 * x); };
// 仅是鲸鱼在频段中的局部活动行，不参与频谱的左侧基线计算。
export function spectrumWaterLine(rows) { return Math.max(2, Math.round((Number(rows) || 8) * 0.5)); }

// offsets 是上下方向的亚字符位移。左端恒为 0，沿条长平滑增加；不旋转字形。
export function spectrumBend(bar, relativeLength, phase, fluid = true) {
  if (!fluid) return 0;
  return Math.pow(clamp01(relativeLength), 1.7) * (0.24 * Math.sin(phase * 1.15 + bar * 0.64)
    + 0.1 * Math.sin(phase * 1.83 - bar * 0.91));
}

export function renderSpectrumScene(values, peaks, columns, rows,
  { phase = 0, ramp = FIELD_RAMP, fluid = true, disturbance = null } = {}) {
  const cols = Math.max(4, Math.min(64, Math.round(Number(columns) || 0)));
  const rowCount = Math.max(8, Math.min(120, Math.round(Number(rows) || 0)));
  const grid = Array.from({ length: rowCount }, () => new Array(cols).fill(' '));
  const offsets = Array.from({ length: rowCount }, () => new Array(cols).fill(0));
  const baseline = 0; // Sidebar 右边界对应容器最左列，与画布底部无关。
  const bars = [];
  if (!values?.length) return { grid: [], offsets: [], bars, baseline };
  // 每条两行，至少空一行；上下各留一行防止弯曲裁切。条数仅随高度/频段数变化。
  const count = Math.min(values.length, 32, Math.max(1, Math.floor((rowCount - 2) / 3)));
  const pitch = (rowCount - 2) / count;
  const densityRamp = ramp?.length > 1 ? ramp : FIELD_RAMP;
  for (let b = 0; b < count; b++) {
    const position = count === 1 ? 0.5 : b / (count - 1);
    const value = sampleSpectrumBand(values, position);
    const peak = Math.max(value, sampleSpectrumBand(peaks ?? values, position));
    const startRow = 1 + Math.floor(b * pitch + (pitch - 2) / 2);
    const endRow = startRow + 1;
    const center = startRow + 1;
    const local = disturbance ? Math.exp(-(((center - disturbance.center) / Math.max(2, disturbance.width * 0.55)) ** 2)) : 0;
    const lift = local * (Number(disturbance?.strength) || 0);
    const length = Math.min(cols, Math.max(0, value * cols + lift * 2));
    bars.push({ center, startRow, endRow, length, end: baseline + length, value, peak });
    for (let x = baseline; x < Math.ceil(length); x++) {
      const relative = clamp01(x / Math.max(1, length - 1));
      const bend = spectrumBend(b, relative, phase, fluid) + local * lift * 0.06 * relative;
      const tip = smoothUnit((length - x) / 2.2);
      for (let y = startRow; y <= endRow; y++) {
        const flow = Math.sin(x * 0.38 + b * 0.63 - phase * 0.55) * 0.055
          + Math.sin(x * 0.7 + (y - startRow) * 1.9 - b * 0.81 + phase * 0.31) * 0.025;
        const brightness = clamp01((0.66 + value * 0.12 + flow) * (0.22 + tip * 0.78));
        grid[y][x] = densityRamp[Math.max(1, Math.round(brightness * (densityRamp.length - 1)))];
        offsets[y][x] = bend;
      }
    }
    // 峰值点留在右端前方的一格，峰值回落沿 X 轴向左，不改变条体起点。
    if (peak > value + 0.055) {
      const x = Math.min(cols - 1, Math.floor(peak * cols));
      if (x > Math.ceil(length)) {
        grid[startRow][x] = ':';
        offsets[startRow][x] = spectrumBend(b, 1, phase, fluid);
      }
    }
  }
  return { grid, offsets, bars, baseline };
}

// 鲸鱼选择中部某个频段作为活动带，不再从竖柱 top/height 计算水位。
export function spectrumWhaleLine(scene, whale) {
  if (!whale || !scene.bars.length) return spectrumWaterLine(scene.grid.length);
  const cols = scene.grid[0]?.length || 1;
  const ratio = 0.32 + 0.3 * clamp01((whale.column + (whale.frame?.[0]?.length ?? 8) / 2) / cols);
  const index = Math.min(scene.bars.length - 1, Math.floor(scene.bars.length * ratio));
  return scene.bars[index].endRow;
}

export function renderSpectrumGrid(values, peaks, columns, rows, options) {
  return renderSpectrumScene(values, peaks, columns, rows, options).grid;
}
export function renderSpectrumField(values, peaks, columns, rows, options) {
  return renderSpectrumGrid(values, peaks, columns, rows, options).map(line => line.join(''));
}
export function renderSpectrumFieldText(values, peaks, columns, rows, options) {
  return renderSpectrumField(values, peaks, columns, rows, options).join('\n');
}
