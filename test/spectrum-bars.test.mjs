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

test('the scene clamps its rectangular grid and vertical displacements stay in bounds', () => {
  const values = new Array(28).fill(0.6), peaks = new Array(28).fill(0.8);
  for (const [requestedColumns, requestedRows, cols, rows] of [[24, 40, 24, 40], [1, 1, 4, 8], [1000, 1000, 64, 120]]) {
    const scene = renderSpectrumScene(values, peaks, requestedColumns, requestedRows);
    assert.equal(scene.grid.length, rows);
    assert.equal(scene.offsets.length, rows);
    assert.equal(scene.baseline, 0, 'the common baseline is the left column, never the bottom row');
    scene.grid.forEach((line, y) => {
      assert.equal(line.length, cols);
      assert.equal(scene.offsets[y].length, cols);
      for (let x = 0; x < cols; x++) {
        assert.ok(FIELD_RAMP.includes(line[x]), `unexpected density glyph ${line[x]}`);
        assert.ok(Number.isFinite(scene.offsets[y][x]));
        if (line[x] !== ' ') assert.ok(y + 0.5 + scene.offsets[y][x] >= 0 && y + 0.5 + scene.offsets[y][x] < rows,
          'the vertical subcharacter displacement cannot push glyphs outside the grid');
      }
    });
  }
  assert.deepEqual(renderSpectrumField([], [], 12, 20), []);
});

test('frequency order runs from top to bottom and energy controls horizontal length from the left edge', () => {
  const values = [0.1, 0.3, 0.55, 0.75, 1];
  const scene = renderSpectrumScene(values, values, 26, 60, { fluid: false });
  assert.equal(scene.bars.length, values.length);
  scene.bars.forEach((bar, index) => {
    assert.equal(bar.value, values[index], 'frequency order is retained vertically');
    assert.ok(Math.abs(bar.length - values[index] * 26) < 1e-9, 'barLength = normalizedEnergy * availableWidth');
    assert.ok(Math.abs(bar.end - bar.length) < 1e-9, 'the moving right endpoint is measured from x=0');
    if (index) {
      assert.ok(bar.center > scene.bars[index - 1].center, 'successive frequency bands sit lower in the workspace');
      assert.ok(bar.length > scene.bars[index - 1].length);
    }
    const chars = scene.grid[Math.floor(bar.center)];
    assert.notEqual(chars[0], ' ', 'all visible strips have a fixed foot in the first column');
    const occupied = chars.join('').match(/[^ ]+/g) ?? [];
    assert.equal(occupied.length, 1, 'each strip has one horizontally connected body');
    assert.equal(occupied[0].length, Math.ceil(bar.length), 'the right endpoint follows energy, not the row count');
    for (let x = 0; x < Math.ceil(bar.length); x++) assert.notEqual(chars[x], ' ');
    for (let x = Math.ceil(bar.length); x < 26; x++) assert.equal(chars[x], ' ');
  });
});

test('increasing and decreasing a band grows and retracts only its right end while its left anchor stays fixed', () => {
  const frame = energy => renderSpectrumScene(new Array(28).fill(energy), new Array(28).fill(energy), 26, 80,
    { phase: 0.7, fluid: false });
  const quiet = frame(0.2), loud = frame(0.8), returned = frame(0.2), zero = frame(0);
  quiet.bars.forEach((bar, index) => {
    const row = Math.floor(bar.center);
    assert.equal(loud.bars[index].center, bar.center, 'the band does not move vertically when its energy changes');
    assert.equal(returned.bars[index].center, bar.center);
    const span = scene => scene.grid[row].join('').replace(/ +$/, '');
    assert.equal(span(quiet).length, 6);
    assert.equal(span(loud).length, 21);
    assert.equal(span(returned).length, 6, 'energy release removes the right portion, not the left foot');
    for (const scene of [quiet, loud, returned]) {
      assert.notEqual(scene.grid[row][0], ' ');
      assert.equal(scene.offsets[row][0], 0, 'the first character cannot wander with motion');
    }
  });
  assert.equal(inked(zero.grid), 0, 'zero energy has zero horizontal length, with no fake bottom cluster');
});

test('bar density depends on available rows and spans the whole workspace rather than collecting at the bottom', () => {
  const values = new Array(64).fill(0.7);
  const normal = renderSpectrumScene(values, values, 26, 80);
  assert.equal(normal.bars.length, 26, 'an 80-row workspace has roughly the requested 20–32 strips');
  const narrow = renderSpectrumScene(values, values, 12, 80);
  const wide = renderSpectrumScene(values, values, 40, 80);
  assert.equal(narrow.bars.length, normal.bars.length, 'reducing horizontal width does not turn frequency bands into columns');
  assert.equal(wide.bars.length, normal.bars.length);
  assert.ok(renderSpectrumScene(values, values, 26, 20).bars.length < normal.bars.length);
  assert.equal(renderSpectrumScene(values, values, 26, 120).bars.length, 32, 'a tall grid reaches the 32-band density cap');
  assert.ok(renderSpectrumScene(values, values, 26, 96).bars.length <= 32, 'top and bottom clearance may reduce the count');
  assert.ok(normal.bars[0].center < 8 && normal.bars.at(-1).center > 72,
    'the first and last bands cover the top and bottom portions');
  for (const [start, end] of [[0, 26], [26, 53], [53, 80]]) {
    assert.ok(inked(normal.grid.slice(start, end)) > 0, 'upper, middle and lower regions all carry strips');
  }
  const occupiedRows = normal.grid.map(line => line.some(glyph => glyph !== ' '));
  const runs = occupiedRows.map(on => on ? 'x' : ' ').join('').match(/x+/g) ?? [];
  assert.equal(runs.length, normal.bars.length, 'each band is separated by at least one empty grid row');
  assert.ok(runs.every(run => run.length === 2), 'a two-row body remains substantial without merging neighbouring strips');
});

test('horizontal bodies use several density glyphs with softer right tips and blank interband rows', () => {
  const values = new Array(28).fill(0.8);
  const scene = renderSpectrumScene(values, values, 26, 80, { phase: 1.2, fluid: false });
  const glyphs = new Set(scene.grid.flat().filter(char => char !== ' '));
  assert.ok(glyphs.size >= 4, 'the strip needs an ASCII density texture rather than repeated pipes or equals');
  const row = Math.floor(scene.bars[0].center);
  const tip = FIELD_RAMP.indexOf(scene.grid[row][Math.ceil(scene.bars[0].length) - 1]);
  const body = FIELD_RAMP.indexOf(scene.grid[row][3]);
  assert.ok(body > tip, `the body is denser than the soft right tip: ${body} vs ${tip}`);
  assert.ok([...glyphs].some(glyph => !'|=~-/\\'.includes(glyph)), 'the visible body is not a CSS-like rule or wave line');
});

test('fluid motion keeps horizontal occupancy and uses continuous vertical displacement with a fixed left foot', () => {
  const values = new Array(28).fill(0.8);
  const a = renderSpectrumScene(values, values, 26, 80, { phase: 0.4, fluid: false });
  const b = renderSpectrumScene(values, values, 26, 80, { phase: 0.4, fluid: true });
  assert.deepEqual(b.grid, a.grid, 'bending cannot randomly remove or shuffle glyphs');
  assert.ok(a.offsets.flat().every(offset => offset === 0), 'the A prototype stays straight');
  assert.ok(b.offsets.flat().some(offset => Math.abs(offset) > 0.05), 'the B prototype has secondary motion');
  assert.ok(b.offsets.every(row => row[0] === 0), 'the left anchor never moves up or down');
  for (let bar = 0; bar < b.bars.length; bar++) {
    for (const distance of [0, 0.25, 0.5, 0.75, 1]) {
      for (let tick = 0; tick < 480; tick++) {
        const phase = tick / 24;
        const bend = spectrumBend(bar, distance, phase);
        const next = spectrumBend(bar, distance, phase + 1 / 240);
        assert.ok(Math.abs(bend) <= 0.35, 'bending cannot erase the vertical gaps');
        assert.ok(Math.abs(next - bend) < 0.004, 'motion is continuous rather than integer grid jumps');
        if (distance === 0) assert.ok(bend === 0, 'the left baseline displacement stays zero');
      }
    }
  }
});

test('held peaks stay to the right of their strips and density texture changes gradually', () => {
  const values = new Array(28).fill(0.3), peaks = [...values]; peaks[0] = 0.9;
  const held = renderSpectrumScene(values, peaks, 26, 80, { phase: 0.4 });
  const body = renderSpectrumScene(values, values, 26, 80, { phase: 0.4 });
  const differences = [];
  held.grid.forEach((row, y) => row.forEach((glyph, x) => { if (glyph !== body.grid[y][x]) differences.push({x,y}); }));
  assert.equal(differences.length, 1, 'one held peak leaves one local cap rather than a horizontal water line');
  assert.ok(differences[0].x > held.bars[0].end, 'peak holding extends rightward, never upward from the bottom');
  assert.ok(Math.abs(differences[0].y - held.bars[0].center) <= 1);
  const soon = renderSpectrumScene(values, peaks, 26, 80, { phase: 0.4 + 1 / 24 });
  const cells = held.grid.flat(), next = soon.grid.flat();
  const changed = cells.filter((glyph, index) => glyph !== next[index]).length;
  assert.ok(changed / inked(held.grid) < 0.1, 'slow density flow must not turn the body into flicker');
  assert.equal(renderSpectrumFieldText(values, peaks, 26, 80, { phase: 0.4 }), held.grid.map(line => line.join('')).join('\n'));
});

test('resize preserves left anchors and paused strips contract near the sidebar throughout the height', () => {
  const engine = createSpectrumEngine({ seed: 9, bands: 28 });
  const playing = snapshotFrame(stepFor(engine, 2, { active: true, energy: 1 }));
  const paused = snapshotFrame(stepFor(engine, 3, { active: false }));
  for (const [columns, rows] of [[12, 20], [26, 60], [40, 96]]) {
    const active = renderSpectrumScene(playing.values, playing.peaks, columns, rows, { phase: 1 });
    const quiet = renderSpectrumScene(paused.values, paused.peaks, columns, rows, { phase: 1 });
    assert.equal(active.grid.length, rows);
    assert.ok(active.grid.every(line => line.length === columns));
    assert.ok(inked(quiet.grid) < inked(active.grid) * 0.5, 'pause visibly contracts horizontal lengths');
    assert.ok(quiet.bars.every(bar => bar.length < columns * 0.15));
    assert.ok(quiet.offsets.every(row => row[0] === 0));
    assert.ok(quiet.bars.at(-1).center >= rows * 0.85, 'quiet bands remain spread vertically, not bottom anchored');
  }
});

test('whale disturbances extend nearby horizontal strips and select a local vertical activity band', () => {
  const values = new Array(28).fill(0.4);
  const ordinary = renderSpectrumScene(values, values, 26, 80, { phase: 1 });
  const middle = Math.floor(ordinary.bars.length / 2);
  const disturbed = renderSpectrumScene(values, values, 26, 80,
    { phase: 1, disturbance: { center: ordinary.bars[middle].center, width: 4, strength: 1 } });
  const extensions = disturbed.bars.map((bar, index) => bar.length - ordinary.bars[index].length);
  assert.ok(extensions[middle] > 1.5 && extensions[middle] > extensions[0] * 3, 'the pre-breach pulse extends the nearby strips while staying local in Y');
  const jump = { column: 9, frame: ['........'] };
  const line = spectrumWhaleLine(ordinary, jump);
  assert.ok(line >= 8 && line < 72, 'the whale uses an interior row band rather than bottom baseline zero');
  const brighter = renderSpectrumScene(new Array(28).fill(0.9), new Array(28).fill(0.9), 26, 80);
  assert.equal(spectrumWhaleLine(brighter, jump), line,
    'changing rightward lengths must not turn the whale waterline back into vertical column tops');
  assert.deepEqual(renderSpectrumScene(values, values, 26, 80, { phase: 1 }), ordinary,
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
