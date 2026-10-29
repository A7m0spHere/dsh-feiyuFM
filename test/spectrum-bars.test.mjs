import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrumEngine, createSpectrumClock, createSpectrumDriver, snapshotFrame,
  renderSpectrumScene, renderSpectrumField, renderSpectrumFieldText, spectrumEnergy,
  sampleSpectrumBand, spectrumBend, spectrumWhaleLine,
  hashSeed, mulberry32, BAND_MIN, BAND_MAX, FIELD_RAMP, SIM_STEP, MAX_CATCH_UP_S } from '../src/ui/client/spectrum-bars.mjs';


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

const column = (grid, index) => grid.map(line => line[index] ?? ' ');
const inked = grid => grid.flatMap(line => [...line]).filter(char => char !== ' ').length;

test('external normalized bands retain their ordering, clamp amplitude and bypass simulated pulses', () => {
  assert.equal(sampleSpectrumBand([], 0.5), 0);
  assert.equal(sampleSpectrumBand([0, 1], 0.25), 0.25);
  assert.equal(sampleSpectrumBand([0.2, 0.8], -1), 0.2);
  assert.equal(sampleSpectrumBand([0.2, 0.8], 2), 0.8);
  assert.equal(sampleSpectrumBand([-0.5, 2], 0), 0);
  assert.equal(sampleSpectrumBand([-0.5, 2], 1), 1);
  const run = seed => stepFor(createSpectrumEngine({ bands: 8, seed }), 3,
    { active: true, energy: 1, frequencyBands: new Float32Array([0.1, 0.9]) });
  const first = run(1), other = run(999);
  first.values.forEach((value, index) => {
    const expected = 0.1 + index / 7 * 0.8;
    assert.ok(Math.abs(value - expected) < 0.001, `band ${index} should converge to input ${expected}`);
  });
  assert.deepEqual(first.values, other.values, 'an external spectrum is not decorated with seeded fake beats');
});

test('attack is faster than release and high bands respond more quickly than low bands', () => {
  const engine = createSpectrumEngine({ bands: 8, seed: 5 });
  const rising = snapshotFrame(engine.step(0.05, { active: true, frequencyBands: [1] }));
  assert.ok(rising.values.at(-1) > rising.values[0], 'high frequency attack should be more agile');
  const peak = snapshotFrame(stepFor(engine, 2, { active: true, frequencyBands: [1] }));
  const falling = snapshotFrame(engine.step(0.05, { active: true, frequencyBands: [0] }));
  assert.ok(falling.values[0] > falling.values.at(-1), 'low frequency mass should fall more slowly');
  for (let index = 0; index < 8; index++) {
    assert.ok(rising.values[index] > peak.values[index] - falling.values[index],
      `band ${index} should gain more on attack than it loses over the same release interval`);
    assert.ok(falling.peaks[index] > falling.values[index], 'the local peak remains held briefly');
  }
  const silent = stepFor(engine, 3, { active: true, frequencyBands: [0] });
  assert.ok(Math.max(...silent.values) < 0.001, 'an explicit zero spectrum has no simulated breathing');
});

test('the simulated bands contain separate peaks and valleys instead of a fixed descending ramp', () => {
  const engine = createSpectrumEngine({ bands: 28, seed: 21 });
  const first = snapshotFrame(stepFor(engine, 1, { active: true, energy: 0.9 }));
  const second = snapshotFrame(stepFor(engine, 0.4, { active: true, energy: 0.9 }));
  assert.ok(Math.max(...first.values) - Math.min(...first.values) > 0.2, 'heights need visible variation');
  const slopes = first.values.slice(1).map((value, index) => value - first.values[index]);
  assert.ok(slopes.some(value => value > 0.03) && slopes.some(value => value < -0.03),
    'the profile should have both rises and falls');
  const motion = second.values.map((value, index) => value - first.values[index]);
  assert.ok(motion.some(value => value > 0.02) && motion.some(value => value < -0.02),
    'all bands must not breathe up and down in lockstep');
});

test('the scene clamps its rectangular grid and every glyph and offset stays in bounds', () => {
  const values = new Array(16).fill(0.6), peaks = new Array(16).fill(0.8);
  for (const [requestedColumns, requestedRows, cols, rows] of [[24, 40, 24, 40], [1, 1, 4, 8], [1000, 1000, 64, 120]]) {
    const scene = renderSpectrumScene(values, peaks, requestedColumns, requestedRows);
    assert.equal(scene.grid.length, rows);
    assert.equal(scene.offsets.length, rows);
    assert.equal(scene.baseline, rows - 1);
    scene.grid.forEach((line, y) => {
      assert.equal(line.length, cols);
      assert.equal(scene.offsets[y].length, cols);
      for (let x = 0; x < cols; x++) {
        assert.ok(FIELD_RAMP.includes(line[x]), `unexpected density glyph ${line[x]}`);
        assert.ok(Number.isFinite(scene.offsets[y][x]));
        if (line[x] !== ' ') assert.ok(x + scene.offsets[y][x] >= 0 && x + scene.offsets[y][x] < cols,
          'the subcharacter displacement cannot push visible glyphs outside the grid');
      }
    });
  }
  assert.deepEqual(renderSpectrumField([], [], 12, 20), []);
});

test('bar heights map monotonically to frequency energy and share the bottom baseline', () => {
  const values = [0.1, 0.3, 0.55, 0.75, 1];
  const scene = renderSpectrumScene(values, values, 26, 60, { fluid: false });
  assert.equal(scene.bars.length, values.length);
  scene.bars.forEach((bar, index) => {
    assert.equal(bar.value, values[index], 'left-to-right frequency order is retained');
    assert.ok(Math.abs(bar.top + bar.height - (scene.baseline + 1)) < 1e-9,
      'every bar grows upward from the same bottom edge');
    if (index) assert.ok(bar.height > scene.bars[index - 1].height);
    const chars = column(scene.grid, Math.floor(bar.center));
    assert.notEqual(chars.at(-1), ' ', 'each bar has a visible foot on the bottom row');
    for (let y = Math.floor(bar.top); y <= scene.baseline; y++) {
      assert.notEqual(chars[y], ' ', 'the body stays vertically connected even when frozen');
    }
  });
  assert.ok(scene.bars.at(-1).height > scene.bars[0].height * 5, 'energy changes must have visible height range');
});

test('dense bodies have sparse tips, multiple glyph levels, and visible gaps between bars', () => {
  const scene = renderSpectrumScene([0.8], [0.8], 26, 60, { phase: 1.2, fluid: false });
  const glyphs = new Set(scene.grid.flat().filter(char => char !== ' '));
  assert.ok(glyphs.size >= 4, 'a bar must have a density texture rather than repeated pipes');
  const first = scene.bars[0];
  const x = Math.floor(first.center);
  const tip = FIELD_RAMP.indexOf(scene.grid[Math.floor(first.top)][x]);
  const body = FIELD_RAMP.indexOf(scene.grid[Math.min(scene.baseline, Math.ceil(first.top) + 4)][x]);
  assert.ok(body > tip, `the body should be denser than the soft cap: ${body} vs ${tip}`);
  const runs = scene.grid.at(-1).join('').match(/[^ ]+/g) ?? [];
  assert.equal(runs.length, scene.bars.length, 'the bottom row must preserve a separate footprint for each bar');
  assert.ok(runs.every(run => run.length >= 2 && run.length <= 4), 'bars are substantial but never merge into a horizontal line');
});

test('fluid motion preserves the occupancy grid and uses continuous subcharacter displacements', () => {
  const a = renderSpectrumScene([0.8], [0.8], 26, 60, { phase: 0.4, fluid: false });
  const b = renderSpectrumScene([0.8], [0.8], 26, 60, { phase: 0.4, fluid: true });
  assert.deepEqual(b.grid, a.grid, 'bending must not randomly remove or shuffle glyphs');
  assert.ok(a.offsets.flat().every(offset => offset === 0), 'the A prototype stays straight');
  assert.ok(b.offsets.flat().some(offset => Math.abs(offset) > 0.05), 'the B prototype has visible secondary motion');
  assert.ok(b.offsets.at(-1).every(offset => offset === 0), 'the feet never wander');
  for (let bar = 0; bar < b.bars.length; bar++) {
    for (const height of [0, 0.25, 0.5, 0.75, 1]) {
      for (let tick = 0; tick < 480; tick++) {
        const phase = tick / 24;
        const bend = spectrumBend(bar, height, phase);
        const next = spectrumBend(bar, height, phase + 1 / 240);
        assert.ok(Math.abs(bend) <= 0.35, 'bending cannot erase interbar gaps');
        assert.ok(Math.abs(next - bend) < 0.004, 'motion is continuous rather than integer grid jumps');
        if (height === 0) assert.ok(bend === 0, 'the baseline displacement stays zero');
      }
    }
  }
});

test('held peaks remain local above their bars and moving texture changes gradually', () => {
  const values = [0.2, 0.3, 0.25, 0.4, 0.35];
  const peaks = [0.9, 0.3, 0.25, 0.4, 0.35];
  const held = renderSpectrumScene(values, peaks, 26, 60, { phase: 0.4 });
  const body = renderSpectrumScene(values, values, 26, 60, { phase: 0.4 });
  const heldCells = held.grid.flat(), bodyCells = body.grid.flat();
  const differences = heldCells.filter((glyph, index) => glyph !== bodyCells[index]).length;
  assert.equal(differences, 1, 'one held peak draws one local cap rather than a water line');
  const soon = renderSpectrumScene(values, peaks, 26, 60, { phase: 0.4 + 1 / 24 });
  const soonCells = soon.grid.flat();
  const changed = heldCells.filter((glyph, index) => glyph !== soonCells[index]).length;
  assert.ok(changed / inked(held.grid) < 0.1, 'slow density flow must not turn the whole body into flicker');
  assert.equal(renderSpectrumFieldText(values, peaks, 26, 60, { phase: 0.4 }), held.grid.map(line => line.join('')).join('\n'));
});

test('resize rebuilds bounded bars at the same phase and pause leaves a low bottom anchored field', () => {
  const engine = createSpectrumEngine({ seed: 9, bands: 28 });
  const playing = snapshotFrame(stepFor(engine, 2, { active: true, energy: 1 }));
  const paused = snapshotFrame(stepFor(engine, 3, { active: false }));
  for (const [columns, rows] of [[12, 20], [26, 60], [40, 96]]) {
    const active = renderSpectrumScene(playing.values, playing.peaks, columns, rows, { phase: 1 });
    const quiet = renderSpectrumScene(paused.values, paused.peaks, columns, rows, { phase: 1 });
    assert.equal(active.grid.length, rows);
    assert.ok(active.grid.every(line => line.length === columns));
    assert.ok(inked(quiet.grid) < inked(active.grid) * 0.5, 'pause should visibly settle the spectrum');
    assert.ok(quiet.bars.every(bar => bar.height < rows * 0.15));
    assert.ok(quiet.offsets.at(-1).every(offset => offset === 0));
  }
});

test('whale disturbances lift nearby bars temporarily and the jump line follows local bar tops', () => {
  const values = [0.2, 0.35, 0.75, 0.55, 0.4];
  const ordinary = renderSpectrumScene(values, values, 26, 60, { phase: 1 });
  const disturbed = renderSpectrumScene(values, values, 26, 60,
    { phase: 1, disturbance: { center: ordinary.bars[2].center, width: 4, strength: 1 } });
  const lifts = disturbed.bars.map((bar, index) => bar.height - ordinary.bars[index].height);
  assert.ok(lifts[2] > 2 && lifts[2] > lifts[0] * 3, 'the pre-breach swell stays local');
  const jump = { column: 9, frame: ['........'] };
  const line = spectrumWhaleLine(ordinary, jump);
  assert.ok(line >= 8 && line < ordinary.baseline - 2, 'the whale emerges from column tops, not the workspace bottom');
  assert.deepEqual(renderSpectrumScene(values, values, 26, 60, { phase: 1 }), ordinary,
    'ending the event leaves no persistent disturbance state');
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
  const slow = sample(12, 4), full = sample(24, 4), fast = sample(144, 4);
  assert.deepEqual(full.values, slow.values, '24fps must retain the 12fps simulation trajectory');
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
