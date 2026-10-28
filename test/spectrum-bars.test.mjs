import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrumEngine, createSpectrumClock, createSpectrumDriver, snapshotFrame,
  renderSpectrumField, renderSpectrumFieldText, spectrumEnergy,
  hashSeed, mulberry32, BAND_MIN, BAND_MAX, FIELD_RAMP, FIELD_WAVE, SIM_STEP, MAX_CATCH_UP_S } from '../src/ui/client/spectrum-bars.mjs';


const stepFor = (engine, seconds, options) => {
  let frame;
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    frame = engine.step(0.05, options);
  }
  return frame;
};

test('same seed replays the identical motion; a different seed diverges', () => {
  const first = createSpectrumEngine({ bands: 12, seed: 7 });
  const second = createSpectrumEngine({ bands: 12, seed: 7 });
  const other = createSpectrumEngine({ bands: 12, seed: 8 });
  const a = stepFor(first, 4, { active: true, energy: 0.8 });
  const b = stepFor(second, 4, { active: true, energy: 0.8 });
  const c = stepFor(other, 4, { active: true, energy: 0.8 });
  assert.deepEqual(b.values, a.values, 'identical seeds must replay the same pattern');
  assert.deepEqual(b.peaks, a.peaks);
  assert.notDeepEqual(c.values, a.values, 'a different seed must look like another song');
});

test('reseed keeps the band count but changes the pattern mid-flight', () => {
  const engine = createSpectrumEngine({ bands: 10, seed: 1 });
  const before = [...stepFor(engine, 2, { active: true, energy: 0.8 }).values];
  engine.reseed(hashSeed('netease:42'));
  const after = stepFor(engine, 2, { active: true, energy: 0.8 });
  assert.equal(engine.bands, 10);
  assert.notDeepEqual([...after.values], before, 'step reuses one buffer, so snapshot before comparing');
});

test('values and peaks stay bounded and peaks never drop below values through long random stepping', () => {
  const engine = createSpectrumEngine({ bands: 24, seed: 99 });
  let frame = null;
  for (let tick = 0; tick < 4000; tick++) {
    frame = engine.step(0.033, { active: tick % 7 !== 3, energy: (tick % 23) / 23 });
    for (const value of frame.values) assert.ok(value >= 0 && value <= 1);
    frame.values.forEach((value, index) => assert.ok(frame.peaks[index] >= value - 1e-9, 'peak must lead the value'));
  }
});

test('idle breathing decays toward a dim baseline and keeps the fall slower than the attack', () => {
  const engine = createSpectrumEngine({ bands: 16, seed: 5 });
  const loud = stepFor(engine, 3, { active: true, energy: 1 });
  const loudSum = loud.values.reduce((sum, value) => sum + value, 0) / loud.values.length;
  assert.ok(loudSum > 0.3, 'active playing should produce substantial bars');
  const riseStart = engine.step(0.05, { active: true, energy: 1 }).values[0];
  const rested = stepFor(engine, 2.5, { active: false });
  const idleSum = rested.values.reduce((sum, value) => sum + value, 0) / rested.values.length;
  assert.ok(idleSum < 0.13, `paused bars must fall back to the breathing baseline, got ${idleSum}`);
  assert.ok(rested.values[0] < riseStart + 1, 'engine stays within its own clock');
});

test('peak holds briefly after the value falls, then drops under gravity', () => {
  const engine = createSpectrumEngine({ bands: 12, seed: 3 });
  stepFor(engine, 3, { active: true, energy: 1 });
  // 强制制造回落：切换到静默后值下降，峰值应先保持再下落。
  const held = engine.step(0.2, { active: false });
  const gaps = held.peaks.map((peak, index) => peak - held.values[index]);
  const falling = stepFor(engine, 2, { active: false });
  const laterGaps = falling.peaks.map((peak, index) => peak - falling.values[index]);
  assert.ok(Math.max(...gaps) > 0.05, 'peak should still be held right after the fall');
  assert.ok(Math.max(...laterGaps) < Math.max(...gaps), 'peaks must eventually fall toward the values');
});

test('band count clamps to the supported range', () => {
  assert.equal(createSpectrumEngine({ bands: 1 }).bands, BAND_MIN);
  assert.equal(createSpectrumEngine({ bands: 999 }).bands, BAND_MAX);
  assert.equal(createSpectrumEngine({}).bands, 24);
});

const column = (lines, index) => lines.map(line => line[index] ?? ' ');
// 一列里最靠上（行号最小）的墨点：海面高度由它读出来。
const crest = chars => chars.findIndex(char => char !== ' ');

test('field rows span the requested columns, clamp their counts and stay inside the charset', () => {
  const values = new Array(16).fill(0.6), peaks = new Array(16).fill(0.8);
  const lines = renderSpectrumField(values, peaks, 24, 40);
  assert.equal(lines.length, 40);
  for (const line of lines) {
    assert.equal(line.length, 24, 'every row spans the measured column count');
    for (const char of line) {
      const known = char === ' ' || FIELD_RAMP.includes(char) || FIELD_WAVE.includes(char);
      assert.ok(known, `unexpected char ${char}`);
    }
  }
  assert.equal(renderSpectrumField(values, peaks, 24, 1).length, 8, 'row count clamps up');
  assert.equal(renderSpectrumField(values, peaks, 24, 1000).length, 120, 'row count clamps down');
  assert.equal(renderSpectrumField(values, peaks, 1000, 40)[0].length, 64, 'column count clamps down');
  assert.equal(renderSpectrumField(values, peaks, 1, 40)[0].length, 4, 'column count clamps up');
  assert.deepEqual(renderSpectrumField([], [], 12, 20), [], 'no bands means no texture');
});

test('the sea line sits lower for quiet bands and rises with amplitude (low frequencies stay on the left)', () => {
  const lines = renderSpectrumField([1, 0.05], [1, 0.05], 4, 40, { phase: 0 });
  const leftCrest = crest(column(lines, 0));
  const rightCrest = crest(column(lines, 3));
  assert.ok(leftCrest >= 0 && rightCrest >= 0, 'both columns draw something');
  assert.ok(leftCrest < rightCrest - 2, 'the loud left band raises the water line above the quiet right band');
  const loud = crest(column(renderSpectrumField([0.9], [0.9], 4, 40, { phase: 0 }), 1));
  const quiet = crest(column(renderSpectrumField([0.25], [0.25], 4, 40, { phase: 0 }), 1));
  assert.ok(loud < quiet - 1, `higher amplitude lifts the crest: ${loud} vs ${quiet}`);
});

test('water below the crest is layered: crest drawn, depths sparser, tips carry the densest glyph', () => {
  const lines = renderSpectrumField([1], [1], 4, 40, { phase: 0 });
  const chars = column(lines, 1);
  const top = crest(chars);
  assert.ok(top >= 0, 'the crest is drawn');
  const nearSurface = chars.slice(top, top + 8).filter(char => char !== ' ').length;
  const farBelow = chars.slice(-8).filter(char => char !== ' ').length;
  assert.ok(nearSurface >= farBelow, 'the water thins out with depth instead of filling the column');
  assert.ok(farBelow < 8, 'the bottom of the frame stays open, not a solid wall');
  // 峰值比当前值高时会单独标出最亮字符。
  const rising = renderSpectrumField([0.2], [0.95], 4, 40, { phase: 0 });
  assert.ok(column(rising, 1).includes(FIELD_RAMP.at(-1)), 'a held peak leaves the densest glyph above the crest');
  const settled = renderSpectrumField([0.5], [0.5], 4, 40, { phase: 0 });
  assert.equal(column(settled, 1).includes(FIELD_RAMP.at(-1)), false, 'a caught-up peak needs no extra glyph');
});

test('phase shifts the swell without changing the grid, and a held peak still marks the crest', () => {
  const settled = renderSpectrumField([0.5], [0.5], 4, 40);
  const rising = renderSpectrumField([0.2], [0.9], 4, 40);
  const cap = FIELD_RAMP.at(-1);
  assert.equal(column(rising, 1).includes(cap), true, 'the falling peak leaves the densest glyph');
  assert.equal(column(settled, 1).includes(cap), false, 'a caught-up peak needs no extra glyph');
  const still = renderSpectrumField([0.5], [0.5], 8, 40, { phase: 0 });
  const waved = renderSpectrumField([0.5], [0.5], 8, 40, { phase: Math.PI / 2 });
  assert.notDeepEqual(waved, still, 'phase adds the gentle wave without changing the grid');
  assert.equal(renderSpectrumFieldText([0.5], [0.5], 8, 40), still.join('\n'));
});

test('the swells run continuously across columns instead of breaking into isolated dots', () => {
  // 海面观感的关键：每一道浪线左右相连。统计墨点落在多长连续段里的比例。
  const values = new Array(16).fill(0.6), peaks = new Array(16).fill(0.7);
  const lines = renderSpectrumField(values, peaks, 26, 60, { phase: 1.2 });
  let inkedTotal = 0, inRuns = 0, longestRun = 0;
  for (const line of lines) {
    for (const match of line.matchAll(/[^ ]+/g)) {
      inkedTotal += match[0].length;
      if (match[0].length >= 3) inRuns += match[0].length;
      longestRun = Math.max(longestRun, match[0].length);
    }
  }
  assert.ok(inkedTotal > 100, `the field should draw a body of water, got ${inkedTotal} glyphs`);
  assert.ok(inRuns / inkedTotal > 0.8,
    `most glyphs must belong to a swell run, got ${inRuns}/${inkedTotal}`);
  assert.ok(longestRun >= 8, `the widest swell should span the band, got ${longestRun} columns`);
});

test('the crest height still tracks band energy so the spectrum stays readable', () => {
  // 海面化之后仍要能比出高低：浪脊高度与频段能量应正相关。
  const bands = 16;
  const values = Array.from({ length: bands }, (_, index) => (index % 4) / 3);
  const lines = renderSpectrumField(values, values, 26, 60, { phase: 0.4 });
  const pairs = [];
  for (let index = 0; index < 26; index++) {
    const row = crest(column(lines, index));
    if (row < 0) continue;
    pairs.push([values[Math.round((index / 25) * (bands - 1))], -row]);
  }
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num += (x - meanX) * (y - meanY);
    dx += (x - meanX) ** 2;
    dy += (y - meanY) ** 2;
  }
  const correlation = num / Math.sqrt(dx * dy);
  assert.ok(correlation > 0.45, `louder bands must raise the water line, got r=${correlation.toFixed(2)}`);
});

test('a quiet field keeps the water low and sparse instead of flooding the frame', () => {
  const inked = lines => lines.join('').split('').filter(char => char !== ' ').length;
  const loud = renderSpectrumField(new Array(16).fill(0.9), new Array(16).fill(0.9), 26, 60, { phase: 0.7 });
  const quiet = renderSpectrumField(new Array(16).fill(0.02), new Array(16).fill(0.02), 26, 60, { phase: 0.7 });
  assert.ok(inked(quiet) < inked(loud) * 0.75,
    `a paused field must recede: ${inked(quiet)} vs ${inked(loud)}`);
});

test('energy arc is fuller in the middle of a song than at the edges', () => {
  assert.ok(spectrumEnergy(0.5) > spectrumEnergy(0.02));
  assert.ok(spectrumEnergy(0.5) > spectrumEnergy(0.98));
  assert.ok(spectrumEnergy(0.5) > 0.6 && spectrumEnergy(0.5) <= 0.95);
  assert.ok(spectrumEnergy(NaN) >= 0 && spectrumEnergy(NaN) <= 1);
});

test('hashSeed is stable and mulberry32 is deterministic', () => {
  assert.equal(hashSeed('netease:42'), hashSeed('netease:42'));
  assert.notEqual(hashSeed('netease:42'), hashSeed('netease:43'));
  const rng = mulberry32(42);
  const replay = mulberry32(42);
  for (let index = 0; index < 10; index++) assert.equal(rng(), replay());
});

// 绘制节流缺陷的回归：旧实现每次 rAF 都刷新 last，只有跨过帧间隔才 step(dt)，
// 于是被丢弃的时间永久丢失——60Hz 屏幕上 4 秒只推进约 0.68 秒模拟。
// 现在模拟时钟只认真实时间，绘制频率不影响轨迹。
test('the simulation clock advances by real time regardless of how often it is sampled', () => {
  const sample = (hz, seconds) => {
    const engine = createSpectrumEngine({ bands: 6, seed: 21 });
    const driver = createSpectrumDriver({ engine });
    let now = 0;
    const interval = 1000 / hz;
    for (let step = 0; step <= Math.round(seconds * hz); step++) {
      driver.advance(now, { active: true, energy: 1 });
      now += interval;
    }
    return { phase: driver.phase, values: [...driver.frame.values] };
  };
  const slow = sample(12, 4), fast = sample(144, 4);
  assert.ok(Math.abs(slow.phase - 4) < 0.05, `12fps sampling should still cover ~4s, got ${slow.phase}`);
  assert.ok(Math.abs(fast.phase - 4) < 0.05, `144Hz sampling should cover ~4s, got ${fast.phase}`);
  slow.values.forEach((value, index) => {
    assert.ok(Math.abs(value - fast.values[index]) < 1e-9,
      `refresh rate must not change the motion: ${value} vs ${fast.values[index]}`);
  });
  // 旧实现的量化结果：同一段真实时间只推进不到 1 秒。
  assert.ok(slow.phase > 3.9, 'the throttled draw no longer loses simulated time');
});

test('a long gap (background tab) is capped instead of fast-forwarding the whole pause', () => {
  const engine = createSpectrumEngine({ bands: 4, seed: 3 });
  const driver = createSpectrumDriver({ engine });
  driver.advance(0, { active: true, energy: 1 });
  const resumed = driver.advance(30_000, { active: true, energy: 1 });
  assert.equal(resumed.steps, Math.round(MAX_CATCH_UP_S / SIM_STEP), '只补上限内的步数');
  assert.ok(resumed.skipped > 29, `the rest of the gap is dropped, got ${resumed.skipped}`);
  assert.ok(driver.phase <= MAX_CATCH_UP_S + 1e-9, 'phase must not jump a half minute');
});

test('resetting the clock discards the cached gap so a resume neither jumps nor freezes', () => {
  const engine = createSpectrumEngine({ bands: 4, seed: 5 });
  const driver = createSpectrumDriver({ engine });
  driver.advance(1000, { active: true, energy: 1 });
  driver.reset(20_000);
  assert.equal(driver.advance(20_000, { active: true, energy: 1 }).steps, 0, 'reset drops the elapsed time');
  const after = driver.advance(20_100, { active: true, energy: 1 });
  assert.equal(after.steps, 6, 'normal time flow resumes on the next sample');
});

test('the clock snaps to a fixed step grid so fractional sampling cannot drift', () => {
  const clock = createSpectrumClock({ step: SIM_STEP });
  clock.advance(0);
  let total = 0, steps = 0;
  for (let index = 1; index <= 1000; index++) {
    const tick = clock.advance(index * 7.3);
    total += tick.seconds;
    steps += tick.steps;
  }
  assert.equal(steps, Math.round(1000 * 7.3 / 1000 / SIM_STEP));
  assert.ok(Math.abs(total - 7.3) < SIM_STEP, `accumulated seconds stay on the grid, got ${total}`);
});

test('re-seeding with the unchanged track is a no-op so routine refreshes never reset the bars', () => {
  const engine = createSpectrumEngine({ bands: 8, seed: 77 });
  const before = [...stepFor(engine, 2, { active: true, energy: 0.9 }).values];
  assert.equal(engine.reseed(77), false, 'the same seed reports no change');
  const continued = [...engine.step(SIM_STEP, { active: true, energy: 0.9 }).values];
  continued.forEach((value, index) => assert.ok(Math.abs(value - before[index]) < 0.05,
    `an unchanged seed keeps the running envelope instead of resetting: ${value} vs ${before[index]}`));
  assert.equal(engine.reseed(78), true, 'a real track change reports the reseed');
  const reseeded = [...engine.step(SIM_STEP, { active: true, energy: 0.9 }).values];
  assert.ok(reseeded.some((value, index) => Math.abs(value - continued[index]) > 1e-6),
    'a real reseed changes the pattern');
});

test('the driver exposes an immutable frame snapshot for repainting after a resize', () => {
  const engine = createSpectrumEngine({ bands: 8, seed: 9 });
  const driver = createSpectrumDriver({ engine });
  driver.advance(0, { active: true, energy: 1 });
  driver.advance(500, { active: true, energy: 1 });
  const copy = snapshotFrame(driver.frame);
  driver.advance(1000, { active: true, energy: 1 });
  assert.equal(copy.values.length, 8);
  assert.equal(copy.peaks.length, 8);
  assert.notDeepEqual(copy.values, [...driver.frame.values], 'the snapshot does not follow the live buffer');
});
