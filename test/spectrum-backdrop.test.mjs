import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { renderSpectrumScene, createSpectrumEngine, createSpectrumDriver, FIELD_RAMP } from '../src/ui/client/spectrum-bars.mjs';
import { calibrateSpectrumRamp, drawSpectrumScene } from '../src/ui/client/spectrum-canvas.mjs';
import { playbackPresentation } from '../src/ui/client/presentation.mjs';

// 组件级回归：保留关键 effect 依赖契约，并在隔离 VM 中执行实际状态片段和
// 静态／媒体查询 effect，验证换曲连续性、主题重画与清理；不挂载真实 DOM。
const source = readFileSync(new URL('../src/ui/client/spectrum-backdrop.mjs', import.meta.url), 'utf8');
const barSource = readFileSync(new URL('../src/ui/client/spectrum-bars.mjs', import.meta.url), 'utf8');

const effectDeps = [];
// 逐个 effect 切分：先按 `React.useEffect(() => {` 切开，再在每段里找紧随其后的
// `}, [...]);`。不能用非贪婪整段正则，否则会跨过 effect 边界。
const chunks = source.split('React.useEffect(() => {').slice(1);
for (const chunk of chunks) {
  const close = chunk.indexOf('\n  }, [');
  if (close < 0) continue;
  const rest = chunk.slice(close + '\n  }, ['.length);
  const end = rest.indexOf(']);');
  if (end < 0) continue;
  effectDeps.push({ body: chunk.slice(0, close), deps: rest.slice(0, end).split(',').map(item => item.trim()).filter(Boolean) });
}

test('the animation effect drives a fixed-step driver instead of stepping the engine by frame delta', () => {
  assert.equal(effectDeps.length > 0, true, 'the backdrop should still schedule work through effects');
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  assert.ok(animated, 'the motion loop lives in a driver-backed effect');
  assert.match(animated.body, /requestAnimationFrame\(/, 'the full-motion tier samples on rAF');
  assert.match(animated.body, /setInterval\(/, 'the reduced tier samples on a timer');
  assert.doesNotMatch(animated.body, /engine\.step\(dt/, 'no ad-hoc per-frame delta remains');
  assert.equal(source.includes('const dt = Math.min(0.1'), false, 'the throttled delta that lost time is gone');
});

test('the animation loop only restarts for visibility, motion level and preview variant flags', () => {
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  // whaleEager 是预览夹具的挂载常量（生产不传），不是播放或布局状态。
  assert.deepEqual(animated.deps, ['visible', 'state.motion', 'whaleEager', 'spectrumFluid', 'systemReduced']);
  for (const banned of ['playing', 'revision', 'columns', 'rows', 'rowPixels', 'seedSource', 'snapshot']) {
    assert.equal(animated.deps.includes(banned), false, `${banned} must not restart the animation loop`);
  }
  // 播放状态与进度通过 ref 读取，下一帧拿到最新值。
  assert.match(source, /activeRef\.current = playing/);
  assert.match(source, /progressRef\.current = progressPercent\(current\) \/ 100/);
});

test('the seed effect only reseeds when the track changes and a resize repaints the last frame', () => {
  const seed = effectDeps.find(entry => entry.body.includes('hashSeed('));
  assert.deepEqual(seed.deps, ['seedSource'], 'a plain snapshot refresh must not touch the seed');
  const repaint = effectDeps.find(entry => entry.body.includes('frameRef.current') && entry.deps.includes('columns'));
  assert.ok(repaint, 'a geometry change repaints from the last frame');
  assert.doesNotMatch(repaint.body, /createSpectrumDriver|createSpectrumEngine|requestAnimationFrame/,
    'a resize must not rebuild the engine or restart the loop');
});

test('the engine treats an unchanged seed as a no-op', () => {
  assert.match(barSource, /if \(value === currentSeed\) return false;/,
    'reseed must report and skip a no-op instead of clearing the band targets');
});

test('the whale and spectrum share one canvas and one simulation clock', () => {
  assert.equal((source.match(/h\('canvas'/g) || []).length, 1, 'one display canvas owns the shared scene');
  assert.doesNotMatch(source, /h\('pre'/, 'a duplicate text renderer must not run alongside the canvas');
  assert.match(source, /stampWhale\(scene\.grid, whale, \{/, 'the whale modifies the existing bar grid');
  assert.match(source, /offsets: scene\.offsets/, 'occlusion also resets the displaced bar cells');
  assert.match(source, /painter\.paint\(scene\)/, 'the final composed scene is painted once');
  const whaleSource = readFileSync(new URL('../src/ui/client/spectrum-whale.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(whaleSource, /requestAnimationFrame|setInterval|setTimeout/);
  assert.doesNotMatch(whaleSource, /document\.|querySelector|createElement/);
});

test('the whale follows a "listening" gate instead of the transient UI playing flag', () => {
  // 切歌时 Core 会短暂进入 resolving，界面 active 掉线。若彩蛋按 active 推进，
  // 每次换歌都会把 95 秒冷却清零，真实播放里永远攒不够时间（现场验收复现）。
  assert.match(source, /const listening = Boolean\(state\.connected && snapshot\) && !snapshot\.paused/,
    'listening tolerates the resolving window between tracks');
  assert.match(source, /!snapshot\.lastError && snapshot\.status !== 'idle'/, 'a stopped or broken player still cancels');
  const animated = effectDeps.find(entry => entry.body.includes('createWhaleDirector('));
  assert.match(animated.body, /active: listening,/, 'the director is driven by the listening gate');
  assert.doesNotMatch(animated.body, /active: activeRef\.current && motion/,
    'the transient UI playing flag must not drive the easter egg');
});

test('a started spectrum stays active across track preparation and resets on pause, stop, error or disconnect', () => {
  // 执行组件实际使用的状态计算片段，避免测试里重写一份相同逻辑而漏掉回归。
  const start = source.indexOf('  const snapshot = state.snapshot;');
  const end = source.indexOf('  const seedSource =', start);
  assert.ok(start >= 0 && end > start, 'the component exposes its playback state calculation before track seeding');
  const derive = new Function('state', 'activeRef', 'playbackPresentation',
    source.slice(start, end) + '\nreturn { playing, listening };');
  const activeRef = { current: false };
  const commit = (snapshot, connected = true) => {
    const next = derive({ snapshot, connected }, activeRef, playbackPresentation);
    // 同组件 activeRef effect：提交本次状态，后续 resolving 才可继承已经开始的播放。
    activeRef.current = next.playing;
    return next;
  };
  const playing = { status: 'playing', paused: false, lastError: null };
  const preparing = { status: 'resolving', paused: false, lastError: null };
  assert.equal(commit(preparing).playing, false, 'the first preparation must not start a fake active spectrum');
  assert.equal(commit(playing).playing, true);
  assert.equal(commit(preparing).playing, true, 'resolving between tracks retains the column energy under an active whale');
  assert.equal(commit({ ...preparing, status: 'selecting' }).playing, true, 'selection between tracks also keeps the established spectrum');
  assert.deepEqual(commit({ ...preparing, status: 'paused', paused: true }), { playing: false, listening: false });
  assert.equal(commit(preparing).playing, false, 'after a pause, preparation cannot reuse stale active energy');
  assert.equal(commit(playing).playing, true, 'real playback resumes the spectrum');
  assert.deepEqual(commit({ ...playing, status: 'idle' }), { playing: false, listening: false });
  assert.equal(commit(preparing).playing, false, 'a new start after stop waits for actual playing');
  assert.equal(commit(playing).playing, true);
  assert.deepEqual(commit({ ...playing, status: 'error', lastError: { code: 'playback_host_lost' } }),
    { playing: false, listening: false });
  assert.equal(commit(preparing).playing, false, 'error recovery starts from the settled state');
  assert.equal(commit(playing).playing, true);
  assert.deepEqual(commit(playing, false), { playing: false, listening: false });
  assert.equal(commit(preparing).playing, false, 'reconnecting must not resurrect stale active state');
  assert.deepEqual(commit(null), { playing: false, listening: false }, 'an absent snapshot is inactive');
  assert.match(source, /activeRef\.current = playing/, 'the derived state is committed to the actual animation ref');
  assert.match(source, /active: activeRef\.current/, 'the band engine reads the sustained state');
});

test('animation frames and resize repaints use the same bar + whale compositor', () => {
  const repaint = effectDeps.find(entry => entry.body.includes('frameRef.current') && entry.deps.includes('columns'));
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  assert.match(repaint.body, /composeField\(painterRef\.current, frameRef\.current, whaleVisualRef\.current/);
  assert.match(animated.body, /composeField\(painterRef\.current, frame, whaleVisualRef\.current/);
  assert.match(source, /spectrumWhaleLine\(scene, whale\)/, 'the shared compositor chooses a local column-top jump line');
  assert.match(source, /waterLineRatio/, 'a breach keeps its water line stable while bars keep moving');
});

test('visibility and unmount cancel the whale, discard suspended time and release animation resources', () => {
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  const hidden = animated.body.slice(animated.body.indexOf('const onVisibility ='));
  assert.match(hidden, /driver\.reset\(performanceNow\(\)\)/, 'hidden time cannot become a fast-forward on restore');
  assert.match(hidden, /whale\.cancel\(\)/);
  assert.match(hidden, /whaleVisualRef\.current = null/);
  assert.match(hidden, /paint\(\)/, 'hiding the page clears the current whale before the loop stops');
  assert.match(animated.body, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(animated.body, /clearInterval\(timer\)/);
  assert.match(animated.body, /removeEventListener\?\.\('visibilitychange'/);
  const geometry = effectDeps.find(entry => entry.body.includes('new ResizeObserver'));
  assert.match(geometry.body, /observer\?\.disconnect\(\)/);
  assert.match(geometry.body, /clearInterval\(poll\)/);
  assert.match(source, /FRAME_INTERVAL = 1000 \/ 24/);
  assert.match(source, /REDUCED_INTERVAL = 240/);
  const off = animated.body.slice(animated.body.indexOf("if (level === 'off')"), animated.body.indexOf('driver.reset('));
  assert.match(off, /active: false/, 'off draws a settled static baseline');
  assert.match(off, /themeObserver\?\.disconnect\(\)/, 'static mode also releases its theme observer');
  assert.ok((animated.body.match(/themeObserver\?\.disconnect\(\)/g) ?? []).length >= 2,
    'both the static return path and the animated cleanup disconnect their observer');
});

test('system reduced-motion changes update the tier and unsubscribe on unmount', () => {
  const mediaEffect = effectDeps.find(entry => entry.body.includes('matchMedia'));
  assert.ok(mediaEffect, 'the system preference is subscribed independently from the animation loop');
  assert.ok(mediaEffect.body.includes('setSystemReduced'), 'a system change must update React state');
  const listeners = new Map(), updates = [];
  const query = { matches: true,
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event, listener) => {
      assert.equal(listeners.get(event), listener, 'cleanup removes the exact subscribed listener');
      listeners.delete(event);
    } };
  const mediaWindow = { matchMedia: selector => {
    assert.equal(selector, '(prefers-reduced-motion: reduce)');
    return query;
  } };
  const initial = source.match(/const \[systemReduced, setSystemReduced\] = React\.useState\(\(\) =>\s*([\s\S]*?)\);\r?\n/);
  assert.ok(initial, 'the state reads the initial system preference');
  updates.push(runInNewContext(initial[1], { window: mediaWindow }));
  const cleanup = runInNewContext('(() => {' + mediaEffect.body + '\n})()', {
    window: mediaWindow, setSystemReduced: value => updates.push(value),
  });
  assert.equal(updates.at(-1), true, 'the initial system setting applies immediately');
  assert.ok(listeners.has('change'));
  query.matches = false;
  listeners.get('change')({ matches: false });
  assert.equal(updates.at(-1), false, 'changing the OS setting updates the next animation tier');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.equal(listeners.size, 0);
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  assert.ok(animated.deps.includes('systemReduced'), 'the active loop responds to the updated preference');
});

test('off mode repaints on theme changes without starting animation and disconnects its observer', () => {
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  const observed = [], observers = [];
  let paints = 0;
  class ThemeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target, options) { observed.push({ target, options }); }
    disconnect() { this.disconnected = true; }
  }
  const html = {}, body = {}, painterRef = { current: null };
  const scheduled = () => { throw new Error('off mode must not schedule an animation'); };
  const sandbox = {
    visible: true, state: { motion: 'off' }, systemReduced: false,
    engineRef: { current: createSpectrumEngine({ bands: 8, seed: 5 }) },
    painterRef, canvasRef: { current: {} }, frameRef: { current: null }, phaseRef: { current: 0 },
    seedSourceRef: { current: 'fixture' }, progressRef: { current: 0.5 },
    geometryRef: { current: { width: 160, height: 720 } },
    columnsRef: { current: 26 }, rowsRef: { current: 60 },
    activeRef: { current: false }, listeningRef: { current: false }, whaleVisualRef: { current: null },
    rootRef: { current: { dataset: {} } }, whaleEager: false, spectrumFluid: true,
    createSpectrumPainter: () => ({ ramp: FIELD_RAMP }),
    createSpectrumDriver, createWhaleDirector: () => ({ cancel() {} }), hashSeed: () => 7,
    spectrumEnergy: () => 0.8, composeField: () => { paints++; },
    document: { documentElement: html, body }, window: {}, MutationObserver: ThemeObserver,
    requestAnimationFrame: scheduled, setInterval: scheduled,
  };
  const cleanup = runInNewContext('(() => {' + animated.body + '\n})()', sandbox);
  assert.ok(paints >= 1, 'the static field is initially painted');
  const before = paints;
  assert.equal(observers.length, 1, 'one observer serves both theme targets');
  assert.ok(observed.some(entry => entry.target === html) && observed.some(entry => entry.target === body),
    'both host theme attribute locations are observed');
  const watched = new Set(observed.flatMap(entry => Array.from(entry.options.attributeFilter ?? [])));
  for (const attribute of ['class', 'data-theme', 'data-ds-dark-theme']) assert.ok(watched.has(attribute));
  observers[0].callback([{ type: 'attributes', target: html, attributeName: 'data-ds-dark-theme' }]);
  assert.ok(paints > before, 'a theme change repaints the static canvas using the current color');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.equal(observers[0].disconnected, true);
  assert.equal(painterRef.current, null, 'unmount releases the painter reference in static mode too');
});

test('the background retains semantic geometry and never becomes an interactive container', () => {
  assert.match(source, /const TARGET = '\[data-conversation-content\]'/);
  assert.match(source, /const MAX_WIDTH = 160/);
  assert.match(source, /const MIN_WIDTH = 72/);
  assert.match(source, /pointerEvents: 'none'/);
  assert.match(source, /'aria-hidden': 'true'/);
  assert.match(source, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(source, /document\.body\.append|position: 'fixed'/);
});

test('canvas paints the continuous offsets in CSS pixels and clears the previous frame', () => {
  const scene = renderSpectrumScene([0.8], [0.8], 26, 60, { phase: 1 });
  const drawn = [], cleared = [], transforms = [];
  const context = { canvas: { width: 0, height: 0 },
    setTransform: (...values) => transforms.push(values),
    clearRect: (...values) => cleared.push(values),
    fillText: (...values) => drawn.push(values) };
  const count = drawSpectrumScene(context, scene,
    { width: 160, height: 720, font: '12px monospace', color: '#1255aa', pixelRatio: 3 });
  assert.equal(context.canvas.width, 320, 'DPI scaling is capped without enlarging the CSS background');
  assert.equal(context.canvas.height, 1440);
  assert.deepEqual(transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(cleared[0], [0, 0, 160, 720], 'old glyphs disappear before each repaint');
  assert.equal(count, scene.grid.flat().filter(glyph => glyph !== ' ').length);
  let index = 0, subcharacterMotion = 0;
  for (let y = 0; y < scene.grid.length; y++) for (let x = 0; x < scene.grid[y].length; x++) {
    if (scene.grid[y][x] === ' ') continue;
    const call = drawn[index++];
    const expectedX = (x + 0.5 + scene.offsets[y][x]) * 160 / 26;
    assert.ok(Math.abs(call[1] - expectedX) < 1e-9, 'canvas must preserve the fractional displacement');
    assert.ok(call[1] >= 0 && call[1] < 160 && call[2] > 0 && call[2] < 720);
    if (scene.offsets[y][x] !== 0) subcharacterMotion++;
  }
  assert.ok(subcharacterMotion > 30);
  assert.equal(drawSpectrumScene(context, { grid: [], offsets: [] },
    { width: 160, height: 720, font: '12px monospace', color: '#1255aa' }), 0);
  assert.equal(cleared.length, 2, 'empty scenes clear stale bars and whales too');
});

test('density calibration sorts the actual glyph ink rather than trusting charset indexes', () => {
  let glyph = '';
  const measured = [];
  const coverage = char => 180 - char.charCodeAt(0);
  const context = { canvas: {}, clearRect() {}, fillText(char) { glyph = char; },
    getImageData() { measured.push(glyph); return { data: new Uint8ClampedArray([0, 0, 0, coverage(glyph)]) }; } };
  const ramp = calibrateSpectrumRamp(context, '12px monospace');
  assert.equal(ramp[0], ' ', 'empty cells remain the lowest density');
  assert.deepEqual(new Set(ramp), new Set(FIELD_RAMP), 'calibration retains the intended glyph vocabulary');
  assert.equal(measured.length, FIELD_RAMP.trim().length, 'each glyph is measured once at calibration');
  for (let index = 2; index < ramp.length; index++) {
    assert.ok(coverage(ramp[index]) >= coverage(ramp[index - 1]), 'visible ink must increase monotonically');
  }
});
