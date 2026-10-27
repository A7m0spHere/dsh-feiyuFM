import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrumEngine, renderSpectrumStrip, renderSpectrumStripText, spectrumEnergy,
  hashSeed, mulberry32, BAND_MIN, BAND_MAX, FIELD_RAMP } from '../src/ui/client/spectrum-bars.mjs';


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

const filled = line => [...line].filter(char => char !== ' ').length;

test('strip rows span the requested width, clamp their count and stay inside the charset', () => {
  const values = new Array(16).fill(0.6), peaks = new Array(16).fill(0.8);
  const lines = renderSpectrumStrip(values, peaks, 32, 9);
  assert.equal(lines.length, 32);
  for (const line of lines) {
    assert.equal(line.length, 9, 'every row spans the measured column count');
    for (const char of line) assert.ok(char === ' ' || FIELD_RAMP.includes(char), `unexpected char ${char}`);
  }
  assert.equal(renderSpectrumStrip(values, peaks, 1, 9).length, 8, 'row count clamps up');
  assert.equal(renderSpectrumStrip(values, peaks, 1000, 9).length, 96, 'row count clamps down');
  assert.equal(renderSpectrumStrip(values, peaks, 32, 100)[0].length, 24, 'column count clamps down');
  assert.equal(renderSpectrumStrip(values, peaks, 32, 1)[0].length, 2, 'column count clamps up');
  assert.deepEqual(renderSpectrumStrip([], [], 12, 9), [], 'no bands means no texture');
});

test('low frequencies sit at the bottom and louder bands fill more columns', () => {
  const lines = renderSpectrumStrip([1, 0], [1, 0], 8, 6);
  assert.equal(lines.at(-1).trim().length, 6, 'the loud low band fills the last row');
  assert.equal(lines[0], '      ', 'the silent high band leaves the first row empty');
  assert.ok(filled(renderSpectrumStrip([0.9], [0.9], 8, 6)[0]) > filled(renderSpectrumStrip([0.3], [0.3], 8, 6)[0]),
    'higher amplitude fills more cells');
  const bar = renderSpectrumStrip([1], [1], 8, 6)[0];
  assert.ok(bar.trim().length === 6 && !bar.includes(' '), 'a full bar leaves no gaps');
});

test('a held peak marks its cell with the densest glyph until the bar catches up', () => {
  const rising = renderSpectrumStrip([0.2], [0.9], 8, 6);
  const settled = renderSpectrumStrip([0.9], [0.9], 8, 6);
  assert.equal(rising[0][4], FIELD_RAMP.at(-1), 'a held peak leaves the densest glyph at its column');
  assert.equal(rising[0][0].trim().length, 1, 'the bar itself still stops at its own amplitude');
  assert.equal(settled[0].includes(FIELD_RAMP.at(-1)), false, 'a caught-up peak needs no extra glyph');
  assert.equal(settled[0][5], ' ', 'nothing is drawn beyond the bar');
  assert.equal(renderSpectrumStripText([0.5], [0.5], 8, 6), renderSpectrumStrip([0.5], [0.5], 8, 6).join('\n'));
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
