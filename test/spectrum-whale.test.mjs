import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhaleDirector, stampWhale, scaleWhaleFrame, whaleWidthFor,
  WHALE_POSES, WHALE_MIN_COLUMNS, WHALE_COOLDOWN_S, WHALE_EVENT_SECONDS } from '../src/ui/client/spectrum-whale.mjs';
import { renderSpectrumGrid, spectrumWaterLine, FIELD_RAMP, FIELD_WAVE } from '../src/ui/client/spectrum-bars.mjs';

const bands = new Array(16).fill(0.6);
const peaks = new Array(16).fill(0.7);
const grid = (columns = 26, rows = 60) => renderSpectrumGrid(bands, peaks, columns, rows, { phase: 0.5 });
const inked = lines => lines.join('').split('').filter(char => char !== ' ').length;

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
  const allowed = new Set([...FIELD_RAMP, ...FIELD_WAVE, '.', ' ']);
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
  assert.ok(whaleWidthFor(WHALE_MIN_COLUMNS) >= 8);
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

test('the stamped whale shares the sea grid instead of adding a second layer', () => {
  const base = grid();
  const before = base.map(line => line.join(''));
  const director = eager();
  const visual = runUntilVisual(director);
  assert.ok(visual);
  const painted = stampWhale(base, visual, { waterLine: spectrumWaterLine(60), columns: 26 });
  assert.equal(painted, true, 'the whale really writes into the grid');
  const after = base.map(line => line.join(''));
  assert.equal(after.length, before.length, 'no extra rows were introduced');
  assert.ok(after.every((line, index) => line.length === before[index].length), 'no extra columns');
  const known = new Set([...FIELD_RAMP, ...FIELD_WAVE, ' ']);
  for (const line of after) for (const char of line) assert.ok(known.has(char), `stray glyph ${char}`);
  assert.ok(inked(after) > inked(before), 'the whale is visibly on top of the water');
});

test('the whale sits on the water line: above it the body is solid, below it only a shadow', () => {
  const base = grid();
  const waterLine = spectrumWaterLine(60);
  const director = eager();
  let visual = null;
  // 推进到 breach 阶段（身子基本出水）。
  for (let tick = 0; tick < 400 && (!visual || visual.phase !== 'breach'); tick++) {
    visual = director.advance(1 / 12, { active: true, allowed: true, columns: 26, rows: 60 });
  }
  assert.equal(visual?.phase, 'breach', 'reached the breach phase');
  stampWhale(base, visual, { waterLine, columns: 26 });
  const above = base.slice(0, waterLine).join('').split('');
  const below = base.slice(waterLine + 1).join('').split('');
  const bodyAbove = above.filter(char => char === '@' || char === '%' || char === 'o').length;
  const bodyBelow = below.filter(char => char === '@' || char === '%' || char === 'o').length;
  assert.ok(bodyAbove > 8, `the whale body should be above the water, got ${bodyAbove}`);
  assert.ok(bodyBelow <= bodyAbove, 'the submerged part is drawn as a faint shadow, not a second whale');
});

test('the ripple outlives the whale and never leaves the grid', () => {
  const base = grid();
  const before = base.map(line => line.join(''));
  const waterLine = spectrumWaterLine(60);
  const director = eager();
  let visual = null;
  for (let tick = 0; tick < 400 && (!visual || visual.phase !== 'ripple'); tick++) {
    visual = director.advance(1 / 12, { active: true, allowed: true, columns: 26, rows: 60 });
  }
  assert.equal(visual?.phase, 'ripple');
  assert.equal(visual.frame, null, 'the body is gone by the ripple phase');
  stampWhale(base, visual, { waterLine, columns: 26 });
  const bodyGlyphs = base.join('').split('').filter(char => '@%o'.includes(char)).length;
  assert.equal(bodyGlyphs, 0, 'no whale body is painted during the ripple');
  const after = base.map(line => line.join(''));
  assert.ok(inked(after) > inked(before), 'the ripple still leaves a mark on the water');
  // 极窄网格也不越界。
  const narrow = renderSpectrumGrid(bands, peaks, 14, 40, { phase: 0 });
  stampWhale(narrow, visual, { waterLine: spectrumWaterLine(40), columns: 14 });
  assert.ok(narrow.every(line => line.length === 14));
});

test('stamping is a no-op when the whale would fall outside the grid', () => {
  const base = grid();
  const before = base.map(line => line.join(''));
  const director = eager();
  const visual = runUntilVisual(director);
  assert.ok(visual);
  assert.equal(stampWhale(base, null, { waterLine: 10 }), false, 'no whale means nothing painted');
  const offGrid = { ...visual, column: 400 };
  assert.equal(stampWhale(base, offGrid, { waterLine: 10, columns: 26 }), false, 'off-grid columns paint nothing');
  assert.deepEqual(base.map(line => line.join('')), before, 'the sea is untouched');
});
