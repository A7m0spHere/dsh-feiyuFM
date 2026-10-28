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
// 浪线专用的斜线：反斜杠不在亮度梯度里，但浪脊要它才读得出水面起伏。
// 渲染只输出 FIELD_RAMP ∪ FIELD_WAVE，测试按这个并集校验字符集。
export const FIELD_WAVE = '\\';
const BEAT_PERIOD = 0.6; // 约 100 BPM 的固定律动；歌曲节拍不可测，只求观感稳定
const PEAK_HOLD_S = 0.42;
const PEAK_GRAVITY = 2.9;
const RISE_RATE = 15;
const FALL_RATE = 4.4;

// 模拟时钟：频谱形态必须由真实时间推进，而不是由绘制节拍推进。固定步长积分
// 让 60Hz／144Hz 屏幕和 12fps／240ms 两档绘制拿到同一条轨迹；绘制频率只影响
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

// 把频段值铺成一片 ASCII 海面，而不是"柱状图 + 镜面倒影"：
// - 最上面一条浪线就是谱轮廓：每列浪高＝该频段能量，低频在左；
// - 往下是一道道跟随轮廓、逐层变平的同形浪脊，行距按透视拉开；
//   斜率大时补齐中间行，曲线连续、不会断成点阵；
// - 断口按"浪段"成块出现（一段连续、段尾留白），读起来是一道道浪；
// - 笔画随深度从 ~ / - 过渡到 ' 与 .，越往近处越淡，底部自然化开；
// - 悬空峰值仍用最亮字符标出，浪尖偶尔溅起一颗水花。
// 全部由 phase（模拟秒）与频段值决定，纯函数。
export function renderSpectrumField(values, peaks, columns, rows,
  { phase = 0, ramp = FIELD_RAMP, horizon = 0.26, spray = true } = {}) {
  const cols = Math.max(4, Math.min(64, Math.round(Number(columns) || 0)));
  const rowCount = Math.max(8, Math.min(120, Math.round(Number(rows) || 0)));
  const bands = values?.length ?? 0;
  if (!bands) return [];
  const levels = Math.max(1, ramp.length - 1);
  const peakGlyph = ramp[levels];
  const bandOf = column => (cols === 1 ? 0 : column / (cols - 1)) * (bands - 1);
  const sample = (series, band) => {
    const lower = Math.floor(band), upper = Math.min(bands - 1, lower + 1);
    return series[lower] + (series[upper] - series[lower]) * (band - lower);
  };

  // 邻列平滑：浪脊要连贯，不能一格一格蹦。先整行取值再卷积，否则平滑会读到
  // 尚未赋值的邻列（NaN 会污染整片字符场）。
  const bandValues = new Array(cols);
  for (let column = 0; column < cols; column++) bandValues[column] = clamp01(sample(values, bandOf(column)));
  const energy = new Array(cols);
  for (let column = 0; column < cols; column++) {
    let sum = 0, weight = 0;
    for (let delta = -2; delta <= 2; delta++) {
      const index = Math.min(cols - 1, Math.max(0, column + delta));
      const k = 1 - Math.abs(delta) / 3;
      sum += bandValues[index] * k;
      weight += k;
    }
    energy[column] = sum / weight;
  }
  // 整体能量既决定浪高，也决定涌浪幅度：暂停后自然变成一条浅浅的缓波。
  const mean = energy.reduce((sum, value) => sum + value, 0) / cols;

  const horizonRow = Math.max(2, Math.min(rowCount - 8, Math.round(rowCount * horizon)));
  const depth = rowCount - horizonRow;
  const lift = Math.max(2, Math.round((horizonRow - 1) * 0.95));
  const grid = Array.from({ length: rowCount }, () => new Array(cols).fill(' '));
  const set = (row, column, glyph) => {
    if (row < 0 || row >= rowCount || column < 0 || column >= cols) return;
    grid[row][column] = glyph;
  };

  // 浪脊轮廓：能量抬升 + 长涌浪。播放时起伏明显，暂停后只剩一层几乎平的呼吸。
  const crest = new Array(cols);
  for (let column = 0; column < cols; column++) {
    const t = cols === 1 ? 0 : column / (cols - 1);
    const body = Math.pow(energy[column], 1.2) * lift * (0.8 + 0.35 * mean);
    const swell = Math.sin(phase * 0.45 + t * Math.PI * 2 + 0.4) * (0.25 + 1.5 * mean);
    crest[column] = horizonRow - body + swell;
  }

  // 浪线：行距逐步拉开（透视），每条横向连续，断口按浪段成块出现。
  // 海铺满整个高度，靠"越深越透"淡出，而不是在中途截断。
  // presence 只控制安静时的整体稀薄程度：暂停后只剩贴近水线的几道浅纹。
  const presence = clamp01(mean * 2.2);
  // 安静时只留贴近水线的几道浪，播放时才铺满整个纵深：暂停后应该明显退潮。
  const seaEnd = rowCount - 1;
  const maxLines = Math.max(3, Math.round(3 + 12 * presence));
  let row = horizonRow;
  let line = 0;
  while (row < seaEnd && line < maxLines) {
    const q = clamp01((row - horizonRow) / Math.max(1, depth));
    const follow = 0.55 * (1 - 0.65 * q);           // 越近越平，像一层层涌浪
    const amp = (0.5 + 1.2 * q) * (0.35 + 0.9 * mean);
    const len = Math.max(9, 12 * (0.8 + 0.7 * q));
    const speed = 0.5 + 0.6 * q;
    const ink = q < 0.3 ? '~' : q < 0.55 ? '-' : q > 0.8 ? '.' : '\'';
    const span = Math.max(8, Math.round(12 + 6 * presence + 3 * Math.sin(line * 2.1 + phase * 0.3)));
    const offset = Math.floor((Math.sin(line * 1.7 + phase * 0.22) * 0.5 + 0.5) * span);
    const y = new Array(cols);
    for (let column = 0; column < cols; column++) {
      y[column] = row + (crest[column] - horizonRow) * follow
        + Math.sin((column / len) * Math.PI * 2 + phase * speed + line * 1.6) * amp;
    }
    for (let column = 0; column < cols; column++) {
      // 浪段为主：一段连续十几列，段尾留一两格断口，读起来是一道道浪。
      if ((column + offset) % span > span - 2) continue;
      // 最深处的浪线再稀一点（只在深海段挖洞），安静时整体更透。
      if (q > 0.75) {
        const porosity = Math.sin(column * 1.9 + line * 3.1 + phase * 0.7) * 0.5 + 0.5;
        if (porosity < (q - 0.75) * 2.4 + (1 - presence) * 0.3) continue;
      }
      const slope = (column + 1 < cols ? y[column + 1] : y[column]) - y[column];
      const glyph = slope < -0.5 ? '/' : slope > 0.5 ? '\\' : ink;
      const top = Math.round(y[column]);
      const next = Math.round(column + 1 < cols ? y[column + 1] : y[column]);
      set(top, column, glyph);
      // 斜率大时补齐中间行，曲线不断成点阵。
      if (next > top) for (let fill = top + 1; fill <= next; fill++) set(fill, column, glyph);
      else for (let fill = next; fill < top; fill++) set(fill, column, glyph);
    }
    line += 1;
    row += Math.max(1, Math.round(2 + 4.2 * Math.pow(q, 1.2)));
  }

  // 悬空峰值：最亮字符标在未被浪追上的峰值高度，保留"柱"的可读性。
  for (let column = 0; column < cols; column++) {
    const band = bandOf(column);
    const value = clamp01(sample(values, band));
    const peak = clamp01(sample(peaks ?? values, band));
    if (peak <= value + 0.06) continue;
    const rowAt = Math.round(horizonRow - Math.pow(peak, 1.2) * lift * (0.8 + 0.35 * mean));
    if (rowAt < Math.floor(crest[column]) - 1) set(rowAt, column, peakGlyph);
  }

  // 水花：浪脊上方偶尔溅起一颗，只在完整动效下出现，且必须落在空白处。
  if (spray) {
    for (let column = 0; column < cols; column++) {
      const splash = Math.sin(phase * 1.6 + column * 2.1);
      if (splash <= 0.95) continue;
      const rowAt = Math.round(crest[column]) - 1 - Math.round((splash - 0.95) * 18);
      if (rowAt < 0 || grid[rowAt][column] !== ' ') continue;
      set(rowAt, column, ':');
    }
  }

  return grid.map(line => line.join(''));
}

export function renderSpectrumFieldText(values, peaks, columns, rows, options) {
  return renderSpectrumField(values, peaks, columns, rows, options).join('\n');
}
