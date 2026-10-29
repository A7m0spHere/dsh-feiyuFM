import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhaleDirector, stampWhale, scaleWhaleFrame, whaleWidthFor,
  WHALE_POSES, WHALE_MIN_COLUMNS, WHALE_COOLDOWN_S, WHALE_EVENT_SECONDS } from '../src/ui/client/spectrum-whale.mjs';
import { renderSpectrumScene, renderSpectrumGrid, spectrumWhaleLine, FIELD_RAMP } from '../src/ui/client/spectrum-bars.mjs';

const bands = new Array(16).fill(0.6);
const peaks = new Array(16).fill(0.7);
const grid = (columns = 26, rows = 60) => renderSpectrumGrid(bands, peaks, columns, rows, { phase: 0.5 });
const blank = (columns = 26, rows = 60) => Array.from({ length: rows }, () => new Array(columns).fill(' '));
const whaleGlyphs = "@%o-.,~'";

// 让彩蛋立刻发生：随机数恒为 0，冷却期设为 0，首次延迟设为 0。
const eager = (extra = {}) => createWhaleDirector({ seed: 7, cooldown: 0, firstDelay: 0, chance: 1, ...extra });

const runUntilVisual = (director, { columns = 26, rows = 60, active = true, allowed = true, maxTicks = 400 } = {}) => {
  for (let tick = 0; tick < maxTicks; tick++) {
    const visual = director.advance(1 / 12, { active, allowed, columns, rows });
    if (visual) return visual;
  }
  return null;
};

test('every pose keeps a rectangular letter grid made only of glyphs the field can print', () => {
  const allowed = new Set([...FIELD_RAMP, ...whaleGlyphs, '.', ' ']);
  for (const [name, pose] of Object.entries(WHALE_POSES)) {
    assert.ok(pose.length >= 6, `${name} should have enough rows to read as a whale`);
    const width = pose[0].length;
    assert.equal(width, 18, `${name} keeps the 18-column master width`);
    for (const row of pose) {
      assert.equal(row.length, width, `${name} rows are rectangular`);
      for (const char of row) assert.ok(allowed.has(char), `${name} prints an unknown glyph ${char}`);
    }
    assert.ok(pose.join('').split('').some(char => char === '@' || char === '%'),
      `${name} must actually draw a body`);
  }
});

test('scaling keeps the whale recognisable and drops detail instead of distorting it', () => {
  const full = WHALE_POSES.standard;
  for (const width of [11, 14, 18]) {
    const scaled = scaleWhaleFrame(full, width);
    const expectedHeight = Math.max(3, Math.round((full.length * width) / 18));
    assert.equal(scaled.length, expectedHeight, `${width} columns keep the aspect ratio`);
    for (const row of scaled) assert.equal(row.length, width, `${width} columns stay rectangular`);
    const solid = scaled.join('').split('').filter(char => char !== '.' && char !== ' ').length;
    assert.ok(solid > width, `a ${width}-column whale still has a body`);
    assert.ok(solid < width * scaled.length, `a ${width}-column whale still has transparent corners`);
  }
  // 等比缩放的形状必须同源：遮罩能量随宽度单调增加，而不是随机跳变。
  const density = width => scaleWhaleFrame(full, width).join('').split('')
    .filter(char => char !== '.' && char !== ' ').length / width;
  assert.ok(density(18) >= density(14) * 0.95, 'scaling up must not thin the whale out');
  assert.deepEqual(scaleWhaleFrame(full, 18), scaleWhaleFrame(full, 18), 'scaling is deterministic');
});

test('the whale is skipped on grids too narrow to hold it', () => {
  assert.equal(whaleWidthFor(WHALE_MIN_COLUMNS - 1), 0);
  assert.ok(whaleWidthFor(WHALE_MIN_COLUMNS) >= 6);
  for (let columns = WHALE_MIN_COLUMNS; columns <= 64; columns++) {
    assert.ok(whaleWidthFor(columns) <= Math.floor(columns * 0.6), 'the whale must leave a visible share of the spectrum');
  }
  assert.ok(whaleWidthFor(40) >= whaleWidthFor(20), 'wider grids get a bigger whale');
  const director = eager();
  for (let tick = 0; tick < 200; tick++) {
    assert.equal(director.advance(1 / 12, { active: true, allowed: true, columns: 6, rows: 60 }), null,
      'a six-column grid never shows a whale');
  }
});

test('nothing surfaces while paused, while motion is reduced, or without a wide enough grid', () => {
  for (const blocked of [{ active: false }, { allowed: false }]) {
    const director = eager();
    for (let tick = 0; tick < 300; tick++) {
      assert.equal(director.advance(1 / 12, { columns: 26, rows: 60, active: true, allowed: true, ...blocked }), null);
    }
  }
});

test('one event walks lurk → emerge → breach → dive → ripple and then disappears', () => {
  const director = eager();
  const seen = [];
  let ticks = 0;
  // 逐帧推进一整个事件：开始那一帧只触发、不出画面，所以按"已经出场过"
  // 而不是"这一帧有没有画面"来判断结束。
  while (ticks < 400) {
    const visual = director.advance(1 / 12, { active: true, allowed: true, columns: 26, rows: 60 });
    ticks += 1;
    if (visual) {
      if (seen.at(-1) !== visual.phase) seen.push(visual.phase);
    } else if (seen.length) break;
  }
  assert.deepEqual(seen, ['lurk', 'emerge', 'breach', 'dive', 'ripple']);
  assert.ok(ticks * (1 / 12) < WHALE_EVENT_SECONDS + 1.5, 'one event finishes inside its scripted length');
  assert.equal(director.active, false, 'the event ends by itself');
});

test('the whale only appears rarely: a long run stays well inside the cooldown budget', () => {
  const director = createWhaleDirector({ seed: 21 });
  let events = 0, wasActive = false;
  for (let tick = 0; tick < 12 * 300; tick++) { // 5 分钟
    const visual = director.advance(1 / 12, { active: true, allowed: true, columns: 26, rows: 60 });
    const nowActive = Boolean(visual);
    if (nowActive && !wasActive) events += 1;
    wasActive = nowActive;
  }
  assert.ok(events <= 3, `five minutes should not be a whale parade, got ${events} events`);
  assert.ok(WHALE_COOLDOWN_S >= 60, 'the cooldown stays long enough to feel like an easter egg');
});

test('pausing in the middle of an event cancels it immediately instead of freezing a half whale', () => {
  const director = eager();
  assert.ok(runUntilVisual(director), 'the event starts');
  for (let tick = 0; tick < 5; tick++) director.advance(1 / 12, { active: true, allowed: true, columns: 26, rows: 60 });
  assert.equal(director.advance(1 / 12, { active: false, allowed: true, columns: 26, rows: 60 }), null,
    'a pause drops the whale at once');
  assert.equal(director.active, false);
  // 关闭效果同理。
  assert.ok(runUntilVisual(director), 'the event can start again after the cooldown reset');
  assert.equal(director.advance(1 / 12, { active: true, allowed: false, columns: 26, rows: 60 }), null);
  assert.equal(director.active, false);
});

test('the stamped whale shares the bar grid without changing its dimensions', () => {
  const scene = renderSpectrumScene(bands, peaks, 26, 60, { phase: 0.5 });
  const before = scene.grid.map(line => line.join(''));
  const visual = runUntilVisual(eager());
  assert.ok(visual);
  assert.equal(stampWhale(scene.grid, visual,
    { waterLine: spectrumWhaleLine(scene, visual), columns: 26, offsets: scene.offsets }), true);
  const after = scene.grid.map(line => line.join(''));
  assert.equal(after.length, before.length);
  assert.ok(after.every((line, index) => line.length === before[index].length));
  assert.notDeepEqual(after, before, 'the whale changes the existing character grid');
  const known = new Set([...FIELD_RAMP, ...whaleGlyphs, ' ']);
  for (const line of after) for (const char of line) assert.ok(known.has(char), `stray glyph ${char}`);
});

test('solid whale rows occlude bar glyphs and clear displacement within the silhouette', () => {
  const body = Array.from({ length: 20 }, () => new Array(14).fill('#'));
  const offsets = Array.from({ length: 20 }, () => new Array(14).fill(0.3));
  const whale = { column: 4, submerge: 0, frame: ['@..@', '@%%@', '@@@@'], ripple: null };
  assert.equal(stampWhale(body, whale, { waterLine: 10, columns: 14, offsets }), true);
  assert.equal(body[8].slice(4, 8).join(''), '@  @',
    'transparent holes enclosed by the whale row erase the bars behind it');
  assert.equal(body[9].slice(4, 8).join(''), '@%%@');
  assert.ok(offsets.slice(8, 11).every(row => row.slice(4, 8).every(value => value === 0)),
    'whale glyphs and cleared holes must not inherit bent bar offsets');
  assert.equal(body[8][3], '#', 'outside corners still belong to the spectrum');
  assert.equal(offsets[8][3], 0.3, 'unoccupied bar cells retain their own displacement');
});

test('above the local column tops the body is solid, while submerged cells are faint shadows', () => {
  const base = blank();
  const director = eager();
  let visual = null;
  for (let tick = 0; tick < 400 && (!visual || visual.phase !== 'breach'); tick++) {
    visual = director.advance(1 / 24, { active: true, allowed: true, columns: 26, rows: 60 });
  }
  assert.equal(visual?.phase, 'breach');
  const waterLine = 30;
  stampWhale(base, visual, { waterLine, columns: 26 });
  const above = base.slice(0, waterLine).flat();
  const below = base.slice(waterLine + 1).flat();
  assert.ok(above.filter(char => '@%o'.includes(char)).length > 8, 'the breach must show a readable body');
  assert.equal(below.filter(char => '@%o'.includes(char)).length, 0, 'submerged cells must not look like another solid whale');
  assert.ok(base.flat().some(char => char !== ' '));
});

test('the compact ripple outlives the whale and stays inside the same grid', () => {
  const director = eager();
  let visual = null;
  for (let tick = 0; tick < 400 && (!visual || visual.phase !== 'ripple'); tick++) {
    visual = director.advance(1 / 24, { active: true, allowed: true, columns: 26, rows: 60 });
  }
  assert.equal(visual?.phase, 'ripple');
  assert.equal(visual.frame, null, 'the body is gone before the ripple');
  for (const columns of [14, 26]) {
    const base = blank(columns, 40);
    assert.equal(stampWhale(base, visual, { waterLine: 25, columns }), true);
    assert.ok(base.every(line => line.length === columns));
    const ink = base.flat().filter(char => char !== ' ');
    assert.ok(ink.length > 0 && ink.length <= 14, 'water marks stay local rather than filling the sea with horizontal waves');
    assert.equal(ink.filter(char => '@%o'.includes(char)).length, 0);
  }
});

test('resizing during a breach rescales the whale and a too narrow grid cancels it', () => {
  const director = eager();
  const wide = runUntilVisual(director, { columns: 40 });
  assert.ok(wide?.frame);
  const narrower = director.advance(1 / 24, { active: true, allowed: true, columns: 14, rows: 40 });
  assert.ok(narrower?.frame, 'an event survives a supported width change');
  assert.ok(narrower.frame[0].length <= Math.floor(14 * 0.6), 'the current event uses the new width budget');
  assert.ok(narrower.column >= 0 && narrower.column + narrower.frame[0].length <= 14);
  assert.ok(narrower.frame[0].length < wide.frame[0].length);
  assert.equal(director.advance(1 / 24,
    { active: true, allowed: true, columns: WHALE_MIN_COLUMNS - 1, rows: 40 }), null);
  assert.equal(director.active, false);
});

test('scale caching distinguishes poses with identical dimensions and first rows', () => {
  const first = ['..@@..@@', '%%%%%%%%', '%%%%%%%%', '..%%%%..'];
  const second = ['..@@..@@', 'oooooooo', 'oooooooo', '..oooo..'];
  const a = scaleWhaleFrame(first, 6), b = scaleWhaleFrame(second, 6);
  assert.notDeepEqual(a, b, 'the cache must include the full pose rather than only its first row');
  assert.ok(a.join('').includes('%'));
  assert.ok(b.join('').includes('o'));
  assert.deepEqual(scaleWhaleFrame(first, 6), a, 'repeated reads of the same pose stay stable');
});

test('stamping is a no-op for missing or wholly off-grid whales', () => {
  const base = grid();
  const before = base.map(line => line.join(''));
  const visual = runUntilVisual(eager());
  assert.ok(visual);
  assert.equal(stampWhale(base, null, { waterLine: 10 }), false);
  assert.equal(stampWhale(base, { ...visual, column: 400 }, { waterLine: 10, columns: 26 }), false);
  assert.deepEqual(base.map(line => line.join('')), before);
});
