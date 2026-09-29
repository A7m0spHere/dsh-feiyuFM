import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(call) {
  const registrations = [], effects = [], styles = [];
  const intervals = new Set();
  let bundle;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: initial => [initial, () => {}], useEffect() {}, useId: () => 'rate-test', Fragment: 'fragment',
  };
  runInNewContext(readFileSync(new URL('../src/ui/dsh-client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { bundle = value.factory(name => { assert.equal(name, 'react'); return React; }); } } },
    document: { hidden: false, createElement: () => ({ dataset: {}, remove() { styles.pop(); } }), head: { appendChild(el) { styles.push(el); } } },
    AbortController, setTimeout, clearTimeout,
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
  });
  bundle.apply({ connection: { rpc: { call } }, layout: { selectPanel() {} },
    effect(fn) { effects.push(fn()); }, slots: {
      inject(_name, fn) { fn(); }, register(options, component) { registrations.push({ options, component }); return () => {}; },
    } });
  const panel = registrations.find(r => r.options.name === 'main');
  const controller = panel.options.inject().controller;
  return { registrations, controller, intervals, styles,
    render: props => panel.component({ ...panel.options.inject(), ...props }),
    dispose() { effects.forEach(fn => fn()); },
  };
}
const snapshot = (revision, humanPlayback = true) => ({ revision, settings: {
  listening: true, humanPlayback, discovery: true, discoveryRate: .2, strategy: 'normal',
}, paused: true, current: null, queue: [], status: 'idle' });
const state = value => ({ ok: true, value: { snapshot: value, platforms: {} } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function all(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(all)]; }

test('client contributes native sidebar, main and settings seats; controls send Core commands', async () => {
  const calls = [];
  const f = fixture(async (channel, endpoint, payload) => { calls.push({ channel, endpoint, payload }); return state(snapshot(calls.length, endpoint !== 'fishfm/command')); });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    assert.deepEqual(f.registrations.map(r => r.options.name), ['main', 'sidebar.panellist', 'settings.section']);
    const nodes = all(f.render());
    const toggle = nodes.find(n => n.props['aria-label'] === '电脑输出声音');
    assert.equal(toggle.props['aria-checked'], true);
    assert.equal(toggle.props.disabled, false);
    await toggle.props.onClick();
    assert.equal(calls.at(-1).endpoint, 'fishfm/command');
    assert.equal(calls.at(-1).payload.type, 'setHumanPlayback');
    assert.equal(calls.at(-1).payload.value, false);
    assert.equal(all(f.render()).find(n => n.props['aria-label'] === '电脑输出声音').props['aria-checked'], false);
    let closed = false;
    const close = all(f.render({ close: () => { closed = true; } })).find(n => n.children.includes('关闭设置'));
    close.props.onClick(); assert.equal(closed, true);
    assert.equal(all(f.render()).find(n => n.children.includes('继续播放')).props.disabled, true);
  } finally { off(); f.dispose(); }
  assert.equal(f.intervals.size, 0); assert.equal(f.styles.length, 0);
});

test('a stale read cannot overwrite a saved setting, and hidden panels stop polling', async () => {
  let reads = 0, stale;
  const f = fixture(async (_channel, endpoint) => {
    if (endpoint === 'fishfm/command') return state(snapshot(2, false));
    if (++reads === 1) return state(snapshot(1));
    return new Promise(resolve => { stale = resolve; });
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    const pending = f.controller.refresh();
    await f.controller.command('setHumanPlayback', false);
    stale(state(snapshot(1, true))); await pending;
    assert.equal(f.controller.getSnapshot().snapshot.settings.humanPlayback, false);
    off(); assert.equal(f.intervals.size, 0);
  } finally { f.dispose(); }
});

test('failed writes are visible and block further changes until a successful refresh', async () => {
  const f = fixture(async (_channel, endpoint) => endpoint === 'fishfm/command'
    ? { ok: false, error: { code: 'core_unavailable', message: '服务离线' } } : state(snapshot(1)));
  const off = f.controller.subscribe(() => {});
  try {
    await tick(); await f.controller.command('pause');
    assert.equal(f.controller.getSnapshot().connected, false);
    assert.match(f.controller.getSnapshot().error, /core_unavailable/);
    assert.equal(all(f.render()).find(n => n.props['aria-label'] === '电脑输出声音').props.disabled, true);
    await f.controller.refresh(); assert.equal(f.controller.getSnapshot().connected, true);
  } finally { off(); f.dispose(); }
});
