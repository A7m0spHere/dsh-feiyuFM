import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrumEngine, renderSpectrumStrip, renderSpectrumStripText, spectrumEnergy,
  hashSeed, mulberry32, BAND_MIN, BAND_MAX, FIELD_RAMP } from '../src/ui/client/spectrum-bars.mjs';

const PICK = brightness => FIELD_RAMP[Math.min(FIELD_RAMP.length - 1,
  Math.max(0, Math.floor(brightness * (FIELD_RAMP.length - 1))))];

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

test('strip rows keep two cells, clamp their count and stay inside the charset', () => {
  const values = new Array(16).fill(0.6), peaks = new Array(16).fill(0.8);
  const lines = renderSpectrumStrip(values, peaks, 32);
  assert.equal(lines.length, 32);
  for (const line of lines) {
    assert.equal(line.length, 2, 'every row is a two-cell strip segment');
    for (const char of line) assert.ok(char === ' ' || FIELD_RAMP.includes(char), `unexpected char ${char}`);
  }
  assert.equal(renderSpectrumStrip(values, peaks, 1).length, 8, 'row count clamps up');
  assert.equal(renderSpectrumStrip(values, peaks, 1000).length, 96, 'row count clamps down');
  assert.deepEqual(renderSpectrumStrip([], [], 12), [], 'no bands means no texture');
});

test('low frequencies sit at the bottom and louder bands print denser characters', () => {
  const lines = renderSpectrumStrip([1, 0], [1, 0], 8);
  assert.equal(lines.at(-1), `${PICK(1)} `, 'the loud low band is the last row and reaches the densest head');
  assert.equal(lines[0], `${PICK(0.12)} `, 'the silent high band is the first row');
  const quiet = renderSpectrumStrip([0.1], [0.1], 8)[0][0];
  const loud = renderSpectrumStrip([0.95], [0.95], 8)[0][0];
  assert.ok(FIELD_RAMP.indexOf(loud) > FIELD_RAMP.indexOf(quiet), 'higher amplitude prints a denser glyph');
});

test('the trailing cell marks a peak that has not fallen back yet', () => {
  const rising = renderSpectrumStrip([0.2], [0.9], 8);
  const settled = renderSpectrumStrip([0.9], [0.9], 8);
  assert.equal(rising[0][1], PICK(0.12 + 0.6 * 0.9), 'a held peak leaves a dimmer trailing glyph');
  assert.equal(settled[0][1], ' ', 'the trailing cell clears once the bar catches the peak');
  assert.equal(renderSpectrumStripText([0.5], [0.5], 8), renderSpectrumStrip([0.5], [0.5], 8).join('\n'));
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
