import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 组件级回归：只核对源码契约。组件的 rAF/effect 在 test fixture 里不执行，
// 但"哪些依赖会重启动画循环"正是本次修复的缺陷点，用源码断言固定住它，
// 防止后续改动把 revision／columns／playing 写回依赖列表。
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

test('the animation loop only restarts for visibility, motion level and the preview-only whale flag', () => {
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  // whaleEager 是预览夹具的挂载常量（生产不传），不是播放或布局状态。
  assert.deepEqual(animated.deps, ['visible', 'state.motion', 'whaleEager']);
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

test('the whale is composited into the same pre as the sea, with no second DOM layer and no timers of its own', () => {
  // 彩蛋必须画进同一张字符矩阵：源码里只能有一处 <pre>，鲸鱼通过 stampWhale
  // 往网格里落笔，而不是另建浮层或自己的 rAF。
  assert.match(source, /h\('pre'/, 'the backdrop still renders exactly one pre');
  const preCount = (source.match(/h\('pre'/g) || []).length;
  assert.equal(preCount, 1, `the backdrop must never add a second pre, found ${preCount}`);
  assert.match(source, /stampWhale\(grid, whale, \{/, 'the whale is stamped into the sea grid');
  assert.match(source, /createWhaleDirector\(/, 'the easter egg is driven by its own state machine');
  const whaleSource = readFileSync(new URL('../src/ui/client/spectrum-whale.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(whaleSource, /requestAnimationFrame|setInterval|setTimeout/,
    'the whale borrows the sea clock instead of running its own timer');
  assert.doesNotMatch(whaleSource, /document\.|querySelector|createElement/,
    'the whale module must stay DOM-free so it can be unit tested');
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

test('both the animation frame and a resize redraw through the same sea + whale compositor', () => {
  // 两处重画必须共用 composeField：只画海会导致改窗口宽度时鲸鱼凭空消失。
  const repaint = effectDeps.find(entry => entry.body.includes('frameRef.current') && entry.deps.includes('columns'));
  assert.ok(repaint, 'a geometry change repaints from the last frame');
  const animated = effectDeps.find(entry => entry.body.includes('createSpectrumDriver('));
  assert.match(repaint.body, /composeField\(textRef\.current, frameRef\.current, whaleVisualRef\.current/,
    'the resize path repaints the whale as well');
  assert.match(animated.body, /composeField\(textRef\.current, frame, whaleVisualRef\.current/,
    'the animation path repaints through the same compositor');
  assert.match(source, /stampWhale\(grid, whale, \{ waterLine: spectrumWaterLine\(rows\), columns \}\)/,
    'the compositor owns the water-line semantics, so both callers agree');
});
