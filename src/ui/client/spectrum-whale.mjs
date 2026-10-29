// ASCII 海面上的鲸鱼彩蛋：字母格取自 dsh-TUI 的像素鲸鱼帧（原作为
// lhh010/dsh-ui-whale 的手绘 Excel 像素画，BSD-3-Clause）。这里只取"哪一格有
// 墨"的轮廓信息并降采样到 18×9 的字母格，颜色与渲染链全部由本项目重写：
// 鲸鱼的每个格子直接写进频谱背景那一个 <pre> 的字符矩阵，因此它和水面是同
// 一层、同一片浪，没有第二个 DOM 层、没有贴图、没有 emoji。
//
// 授权与来源见 THIRD_PARTY_NOTICES.md；本文件只保留降采样后的字形，不包含
// 上游的调色板、ANSI 编码或 Ink 组件。

/** 比这更窄的字符网格放不下完整鲸鱼，整段动画跳过。 */
export const WHALE_MIN_COLUMNS = 12;
/** 两次彩蛋之间至少间隔的秒数。 */
export const WHALE_COOLDOWN_S = 95;
/** 本次会话里第一次允许出现的等待秒数。 */
export const WHALE_FIRST_DELAY_S = 28;
/** 多久掷一次骰子。 */
const ROLL_INTERVAL_S = 10;
const ROLL_CHANCE = 0.3;
const SEED_VERSION = 1;

// 字母格：'@' 轮廓、'%' 身体、'o' 口鼻、'-' 腹部，'.' 透明。
// 全部来自上游 40×25 帧的包围盒降采样（18×9），保留可辨认的鲸鱼侧影；
// 只使用 FIELD_RAMP 里已有的字形，因此可以直接写进频谱那一张字符矩阵。
const MASTER_WIDTH = 18;

export const WHALE_POSES = Object.freeze({
  standard: [
    '...........@@...@@',
    '...........@%%@@%%',
    '..@@@@@@...@%%%%%@',
    '@%%%%%%%%%@.@%%%@.',
    '@%%%%%%%%%%%%%%%..',
    '@%%%%%%%%%%%%%%@..',
    '@%oooooo%%%%%%@...',
    '.@-oooooo@%%@@@...',
    '..@--oo--@@%%@@...',
  ],
  fin: [
    '...........@@...@@',
    '...........@%%@@%%',
    '..@@@@@@...@%%%%%@',
    '@%%%%%%%%%@.@%%%@.',
    '@%%%%%%%%%%%%%%%..',
    '@%%%%%%%%%%%%%%@..',
    '@%oooooo%%%%%%@...',
    '.@-oooooo@%%%@@...',
    '..@--oo---@%%%@...',
  ],
  tail: [
    '............@@....',
    '..@@@@......@%..@@',
    '.@%%%%%@....@%@@%@',
    '@%%%%%%%%@..@%%%%.',
    '@%%%%%%%%%%%%%%%..',
    '@%%%%%%%%%%%%%@...',
    '@%ooooo%%%@%%@....',
    '.--ooooo@%%@@.....',
    '..@-ooo-@%%%@.....',
  ],
  spout: [
    '..------...@@.....',
    '.-------...@%@.@@@',
    '..@@@@@@...@%%%%%@',
    '.@%%%%%%%@@.@%%%@.',
    '@%%%%%%%%%%%%%%%..',
    '@%%%%%%%%%%%%%%@..',
    '@%ooooo%%%%%%%%...',
    '.@-oooooo@%%@@@...',
    '..@--oo--@@%%@@...',
  ],
});

// 水上／水下用不同的亮度档：水上要显眼，水下只留一层更淡的影子。
// 键必须覆盖字母格里出现的全部非透明字形。
const UNDER_WATER = { '@': '\'', '%': ',', '-': ',', o: '\'' };
const WAKE = ["'", ',', '~', '-', ':'];

const scaledCache = new Map();

/**
 * 把 18 宽的母版按块多数决降到目标宽度，保持形状不变、笔画变少。
 * 宽度不小于母版时原样返回。
 */
export function scaleWhaleFrame(frame, width) {
  const target = Math.max(4, Math.min(28, Math.round(Number(width) || MASTER_WIDTH)));
  const source = Array.isArray(frame) && frame.length ? frame : WHALE_POSES.standard;
  const sourceWidth = source.reduce((max, row) => Math.max(max, row.length), 0) || MASTER_WIDTH;
  if (target >= sourceWidth) return source.map(row => row.padEnd(sourceWidth, '.'));
  const key = `${target}:${source === WHALE_POSES.standard ? 'std' : source.map(row => row.length).join('')}:${source[0]}`;
  const cached = scaledCache.get(key);
  if (cached) return cached;
  const sourceHeight = source.length;
  const targetHeight = Math.max(3, Math.round((sourceHeight * target) / sourceWidth));
  const rows = [];
  for (let y = 0; y < targetHeight; y++) {
    let line = '';
    for (let x = 0; x < target; x++) {
      const y0 = Math.floor((y * sourceHeight) / targetHeight);
      const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * sourceHeight) / targetHeight));
      const x0 = Math.floor((x * sourceWidth) / target);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * sourceWidth) / target));
      const tally = new Map();
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const glyph = source[sy]?.[sx] ?? '.';
          if (glyph === '.' || glyph === ' ') continue;
          tally.set(glyph, (tally.get(glyph) || 0) + 1);
        }
      }
      const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      line += winner ? winner[0] : '.';
    }
    rows.push(line);
  }
  scaledCache.set(key, rows);
  return rows;
}

/** 按可用列数挑鲸鱼宽度：网格越窄画得越小，太窄就返回 0 表示跳过。 */
export function whaleWidthFor(columns) {
  const cols = Math.round(Number(columns) || 0);
  if (cols < WHALE_MIN_COLUMNS) return 0;
  if (cols >= 34) return 18;
  if (cols >= 20) return 14;
  return 11;
}

// 一段动画的分段：submerge 0＝完全出水，1＝完全没入。lurk 与 emerge 让鲸鱼
// 从水下慢慢浮起，breach 出水，dive 再沉回去，最后只剩涟漪。
const PHASES = [
  { name: 'lurk', seconds: 0.9, from: 0.82, to: 0.66 },
  { name: 'emerge', seconds: 0.6, from: 0.66, to: 0.1 },
  { name: 'breach', seconds: 1.3, from: 0.1, to: 0.02 },
  { name: 'dive', seconds: 1, from: 0.02, to: 0.94 },
  { name: 'ripple', seconds: 1.5, from: 1, to: 1 },
];
export const WHALE_EVENT_SECONDS = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);

function poseAt(name, progress) {
  if (name !== 'breach') return WHALE_POSES.standard;
  if (progress < 0.22) return WHALE_POSES.fin;
  if (progress < 0.46) return WHALE_POSES.tail;
  if (progress < 0.72) return WHALE_POSES.spout;
  return WHALE_POSES.standard;
}

/**
 * 彩蛋导演：只决定"鲸鱼此刻在哪、什么姿态、淹到多深"，不碰 DOM。
 * 触发是低频的——播放中每 10 秒掷一次 30% 的骰子，且距上次结束至少
 * WHALE_COOLDOWN_S 秒；非播放、网格过窄、动效非完整时一律不出场。
 */
export function createWhaleDirector({
  seed = 0,
  cooldown = WHALE_COOLDOWN_S,
  firstDelay = WHALE_FIRST_DELAY_S,
  random = null,
  chance = ROLL_CHANCE,
} = {}) {
  const rng = typeof random === 'function' ? random : mulberryFrom(seed);
  let sinceLast = 0, untilRoll = Math.max(0, firstDelay), event = null;
  let centerRatio = 0.46, width = 0;

  function cancel() { event = null; sinceLast = 0; untilRoll = Math.max(ROLL_INTERVAL_S, cooldown * 0.4); }

  function start(columns) {
    const w = whaleWidthFor(columns);
    if (!w) return false;
    width = w;
    // 位置每轮轻微变化，避免每次都在同一列跃出。
    centerRatio = 0.34 + rng() * 0.3;
    event = { time: 0, columns };
    return true;
  }

  function advance(dt, { active = false, columns = 0, rows = 0, allowed = true } = {}) {
    const delta = Math.max(0, Math.min(0.25, Number(dt) || 0));
    if (!active || !allowed) { cancel(); return null; }
    if (whaleWidthFor(columns) === 0 || rows < 6) { event = null; return null; }

    if (event) {
      event.time += delta;
      event.columns = columns;
      let elapsed = 0;
      for (let index = 0; index < PHASES.length; index++) {
        const phase = PHASES[index];
        if (event.time < elapsed + phase.seconds || index === PHASES.length - 1) {
          const local = Math.min(1, Math.max(0, (event.time - elapsed) / phase.seconds));
          const submerge = phase.from + (phase.to - phase.from) * local;
          // ripple 阶段身子已经沉下去了，只剩水面上的圈：不给 frame，
          // 保证调用方不会在涟漪里又画出一只半只鲸鱼。
          const frame = phase.name === 'ripple' ? null : scaleWhaleFrame(poseAt(phase.name, local), width);
          const span = frame ? frame[0].length : Math.max(1, Math.round(width / 2));
          const visual = {
            phase: phase.name,
            submerge,
            frame,
            column: Math.max(1, Math.min(columns - span - 1,
              Math.round(columns * centerRatio - span / 2))),
            ripple: phase.name === 'ripple'
              ? { radius: 1 + local * 5, fade: 1 - local }
              : null,
            pose: phase.name,
          };
          if (phase.name === 'ripple' && local >= 1) { event = null; sinceLast = 0; }
          return visual;
        }
        elapsed += phase.seconds;
      }
      event = null;
      return null;
    }

    sinceLast += delta;
    untilRoll -= delta;
    if (untilRoll > 0) return null;
    untilRoll = ROLL_INTERVAL_S;
    if (sinceLast < cooldown) return null;
    if (rng() > chance) return null;
    start(columns);
    return null;
  }

  return {
    advance,
    cancel,
    // 状态只读出来给测试与调试用，渲染不依赖它。
    get active() { return Boolean(event); },
    get cooldownLeft() { return Math.max(0, cooldown - sinceLast); },
    setChance(next) { chance = Math.max(0, Math.min(1, Number(next) || 0)); },
  };
}

function mulberryFrom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 把鲸鱼与它的涟漪直接写进海水字符网格：露出水面的部分用原字形，没入水下的
 * 部分换成更淡的影子，出水处的浪被抬起来，涟漪从入水点向两侧扩。
 * 返回是否真的画上了东西（没有画上就不该让调用方以为有变化）。
 */
export function stampWhale(grid, whale, { waterLine = 0, columns = 0 } = {}) {
  if (!Array.isArray(grid) || !grid.length || !whale) return false;
  const cols = Math.max(0, Math.min(columns || grid[0].length, grid[0].length));
  const rows = grid.length;
  const line = Math.round(waterLine);
  let painted = false;
  const put = (row, column, glyph) => {
    if (row < 0 || row >= rows || column < 0 || column >= cols) return;
    if (!glyph || glyph === '.' || glyph === ' ') return;
    grid[row][column] = glyph;
    painted = true;
  };

  const frame = whale.frame;
  if (Array.isArray(frame) && frame.length) {
    const height = frame.length;
    // submerge 0＝整个身子在水面之上，1＝完全没入；中间是逐渐下沉。
    const above = Math.max(0, Math.min(height, Math.round(height * (1 - whale.submerge))));
    const top = line - above + 1;
    // 水下只留一层浅影，再深就化进海水里，避免整只鲸压在正文旁。
    const shadowRows = Math.max(1, Math.round(height * 0.3));
    for (let y = 0; y < height; y++) {
      const row = top + y;
      if (row > line + shadowRows) break;
      const under = row > line;
      const glyphs = frame[y];
      for (let x = 0; x < glyphs.length; x++) {
        const glyph = glyphs[x];
        if (glyph === '.' || glyph === ' ') continue;
        put(row, whale.column + x, under ? UNDER_WATER[glyph] : glyph);
      }
    }
    // 出水处的浪被顶起来：紧贴鲸鱼身侧的一行画成浪尖，全部落在空白处。
    for (let x = -1; x <= (frame[0]?.length || 0); x++) {
      const column = whale.column + x;
      if (column < 0 || column >= cols) continue;
      if (grid[line]?.[column] === ' ') put(line, column, WAKE[Math.abs(x) % WAKE.length]);
    }
  }

  if (whale.ripple) {
    const { radius, fade } = whale.ripple;
    const centerColumn = whale.column + Math.round((frame?.[0]?.length || 0) / 2);
    const rings = Math.max(1, Math.round(radius));
    const glyph = fade > 0.6 ? '~' : fade > 0.3 ? '-' : '\'';
    for (let ring = 0; ring < rings; ring++) {
      const spread = Math.round(radius * (0.5 + ring / Math.max(1, rings)));
      for (const side of [-1, 1]) {
        put(line + (ring % 2 === 0 ? 0 : 1), centerColumn + side * spread, glyph);
      }
    }
  }
  return painted;
}

export const WHALE_SEED_VERSION = SEED_VERSION;
