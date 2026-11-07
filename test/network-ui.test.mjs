import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const tick = () => new Promise(resolve => setImmediate(resolve));
const view = (revision = 0, mode = 'direct', url = '') => ({ version: 1, revision, mode, url });
const response = networkProxy => ({ ok: true, value: { networkProxy } });
const plain = value => JSON.parse(JSON.stringify(value));

function controllerFixture(call) {
  const context = {
    window: { localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    sourceNames: {}, EXPRESSION_LABELS: {}, recommendationFeedback: () => ({}),
    GUIDE_KEY: 'guide', storedGuideStatus: () => 'pending', firstUseDecision: () => 'wait',
  };
  const source = readFileSync(new URL('../src/ui/client/controller.mjs', import.meta.url), 'utf8')
    .replace(/^import .*?;\r?\n/gm, '').replace('export function createController', 'function createController');
  runInNewContext(source + '\nglobalThis.makeController = createController;', context);
  const calls = [];
  const controller = context.makeController({ rpc: { call: async (_channel, endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal });
    if (endpoint === 'fishfm/state') return { ok: true, value: { snapshot: { revision: 1, current: null, settings: {} }, platforms: {} } };
    return call(endpoint, payload, signal);
  } } });
  return { controller, calls };
}

test('network settings read on demand and retain the saved revision and direct default', async t => {
  const f = controllerFixture(async () => response(view())); t.after(() => f.controller.dispose());
  await f.controller.refresh();
  assert.equal(f.calls.some(call => call.endpoint === 'fishfm/network-proxy'), false);
  await f.controller.loadNetworkProxy();
  assert.deepEqual(plain(f.controller.getSnapshot().networkProxy), view());
  assert.equal(f.controller.getSnapshot().networkProxyBusy, false);
});

test('a late settings read cannot overwrite a save and duplicate saves make one request', async t => {
  let delayedRead, delayedSave, reads = 0;
  const f = controllerFixture(async (_endpoint, payload) => {
    if (!Object.hasOwn(payload, 'mode')) {
      if (reads++ === 0) return response(view());
      return new Promise(resolve => { delayedRead = resolve; });
    }
    return new Promise(resolve => { delayedSave = resolve; });
  });
  t.after(() => f.controller.dispose());
  await f.controller.refresh(); await f.controller.loadNetworkProxy();
  const reading = f.controller.loadNetworkProxy(); await tick();
  const saving = f.controller.saveNetworkProxy({ mode: 'proxy', url: 'http://127.0.0.1:7897' }, 0); await tick();
  assert.equal((await f.controller.saveNetworkProxy({ mode: 'direct', url: '' }, 0)).ok, false);
  delayedSave(response(view(1, 'proxy', 'http://127.0.0.1:7897'))); await saving;
  delayedRead(response(view())); await reading;
  assert.equal(f.calls.filter(call => Object.hasOwn(call.payload, 'mode')).length, 1);
  assert.deepEqual(plain(f.controller.getSnapshot().networkProxy), view(1, 'proxy', 'http://127.0.0.1:7897'));
});

test('unavailable settings remain explicit and dispose releases a signal-ignoring request', async t => {
  let blocked = false;
  const f = controllerFixture(async () => blocked ? new Promise(() => {}) : { ok: false, error: { code: 'not_found', message: '设置接口暂未提供。' } });
  t.after(() => f.controller.dispose());
  await f.controller.refresh();
  await f.controller.loadNetworkProxy();
  assert.equal(f.controller.getSnapshot().networkProxy, null);
  assert.match(f.controller.getSnapshot().networkProxyError, /设置接口/);
  assert.equal((await f.controller.saveNetworkProxy({ mode: 'direct', url: '' }, 0)).ok, false);
  blocked = true;
  const reading = f.controller.loadNetworkProxy(); await tick(); f.controller.dispose();
  assert.equal((await reading).ok, false);
});

test('invalid settings replies and revision conflicts never appear as saved', async t => {
  let result = response({ ...view(), mode: 'unexpected' });
  const f = controllerFixture(async () => result); t.after(() => f.controller.dispose());
  await f.controller.refresh(); await f.controller.loadNetworkProxy();
  assert.equal(f.controller.getSnapshot().networkProxy, null);
  assert.ok(f.controller.getSnapshot().networkProxyError);
  result = response(view(2)); await f.controller.loadNetworkProxy();
  result = { ok: false, error: { code: 'network_proxy_conflict', message: '设置已更新，请重新读取。' } };
  assert.equal((await f.controller.saveNetworkProxy({ mode: 'proxy', url: 'http://127.0.0.1:7897' }, 2)).ok, false);
  assert.equal(f.controller.getSnapshot().networkProxy.revision, 2);
  assert.equal(f.controller.getSnapshot().networkProxyErrorCode, 'network_proxy_conflict');
  assert.equal(f.controller.getSnapshot().networkProxyNotice, '');
});

test('a failed refresh disables saves and a stale save reply never clears the error state', async t => {
  let result = response(view(2));
  const f = controllerFixture(async () => result); t.after(() => f.controller.dispose());
  await f.controller.refresh(); await f.controller.loadNetworkProxy();
  result = { ok: false, error: { code: 'not_found', message: '设置接口暂未提供。' } };
  await f.controller.loadNetworkProxy();
  assert.equal(f.controller.getSnapshot().networkProxy, null);
  assert.equal((await f.controller.saveNetworkProxy({ mode: 'direct', url: '' }, 2)).ok, false);
  result = response(view(2)); await f.controller.loadNetworkProxy();
  result = response(view(1));
  assert.equal((await f.controller.saveNetworkProxy({ mode: 'direct', url: '' }, 2)).ok, false);
  assert.equal(f.controller.getSnapshot().networkProxy.revision, 2);
  assert.ok(f.controller.getSnapshot().networkProxyError);
});

function componentFixture() {
  const hooks = [], effects = [];
  let cursor = 0;
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = hooks[index];
      if (!previous || dependencies.some((value, i) => value !== previous[i])) effects.push(callback);
      hooks[index] = dependencies;
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useId: () => 'network-proxy',
  };
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const context = { React, h };
  const source = readFileSync(new URL('../src/ui/client/network.mjs', import.meta.url), 'utf8')
    .replace(/^import .*?;\r?\n/gm, '').replace('export function NetworkProxySettings', 'function NetworkProxySettings');
  runInNewContext(source + '\nglobalThis.renderSettings = NetworkProxySettings;', context);
  return { render(state, controller) {
    cursor = 0;
    const tree = context.renderSettings({ state, controller });
    while (effects.length) effects.shift()();
    return tree;
  } };
}
function nodes(tree) { return [tree, ...(tree?.children ?? []).filter(child => child && typeof child === 'object').flatMap(nodes)]; }
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && node.children.includes(label));

test('the proxy form keeps drafts after errors and makes direct mode and TUN scope explicit', async () => {
  const f = componentFixture(), saved = [];
  const state = { connected: true, networkProxy: view(), networkProxyBusy: false, networkProxyError: '', networkProxyNotice: '' };
  const controller = { loadNetworkProxy() {}, async saveNetworkProxy(value, revision) { saved.push({ value, revision }); return { ok: false }; } };
  let tree = f.render(state, controller);
  const select = nodes(tree).find(node => node.type === 'select');
  assert.ok(select.props.id);
  assert.ok(nodes(tree).some(node => node.type === 'label' && node.props.htmlFor === select.props.id));
  assert.ok(nodes(tree).some(node => node.children.includes('直连（默认）')));
  assert.ok(nodes(tree).some(node => node.children.some(child => typeof child === 'string' && child.includes('TUN／VPN'))));
  select.props.onChange({ target: { value: 'proxy' } });
  tree = f.render(state, controller);
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'http://127.0.0.1:7897' } });
  tree = f.render(state, controller);
  await button(tree, '保存网络设置').props.onClick();
  tree = f.render({ ...state, networkProxyError: '代理不可用。' }, controller);
  assert.equal(nodes(tree).find(node => node.type === 'input').props.value, 'http://127.0.0.1:7897');
  assert.deepEqual(plain(saved), [{ value: { mode: 'proxy', url: 'http://127.0.0.1:7897' }, revision: 0 }]);
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
  tree = f.render({ ...state, networkProxy: view(1, 'direct') }, controller);
  assert.equal(button(tree, '保存网络设置').props.disabled, true);
});

test('a successful save preserves edits entered while its reply was pending', async () => {
  const f = componentFixture();
  const state = { connected: true, networkProxy: view(), networkProxyBusy: false };
  let complete;
  const controller = { loadNetworkProxy() {}, saveNetworkProxy: () => new Promise(resolve => { complete = resolve; }) };
  let tree = f.render(state, controller);
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'proxy' } });
  tree = f.render(state, controller);
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'http://127.0.0.1:7897' } });
  tree = f.render(state, controller);
  const input = nodes(tree).find(node => node.type === 'input');
  const saving = button(tree, '保存网络设置').props.onClick();
  input.props.onChange({ target: { value: 'http://127.0.0.1:7898' } });
  complete({ ok: true, networkProxy: view(1, 'proxy', 'http://127.0.0.1:7897') }); await saving;
  tree = f.render({ ...state, networkProxy: view(1, 'proxy', 'http://127.0.0.1:7897') }, controller);
  assert.equal(nodes(tree).find(node => node.type === 'input').props.value, 'http://127.0.0.1:7898');
  assert.equal(button(tree, '保存网络设置').props.disabled, false);
  assert.ok(nodes(tree).some(node => node.children.includes('当前输入尚未保存。')));
});

test('a reconnect deferred by an active operation reads settings once when it finishes', () => {
  const f = componentFixture();
  let reads = 0;
  const controller = { loadNetworkProxy() { reads++; } };
  const state = { connected: true, networkProxy: view(), networkProxyBusy: false };
  f.render(state, controller); assert.equal(reads, 1);
  f.render({ ...state, connected: false, networkProxyBusy: true }, controller);
  f.render({ ...state, connected: true, networkProxyBusy: true }, controller);
  assert.equal(reads, 1);
  f.render(state, controller); assert.equal(reads, 2);
  f.render({ ...state, networkProxyBusy: true }, controller);
  f.render(state, controller); assert.equal(reads, 2);
});

test('a server conflict blocks resubmission until the saved settings are read again', () => {
  const f = componentFixture();
  let clears = 0;
  const controller = { loadNetworkProxy() {}, clearNetworkProxyFeedback() { clears++; } };
  const state = { connected: true, networkProxy: view(), networkProxyBusy: false };
  let tree = f.render(state, controller);
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'proxy' } });
  const conflicted = { ...state, networkProxyErrorCode: 'network_proxy_conflict' };
  tree = f.render(conflicted, controller);
  assert.equal(button(tree, '保存网络设置').props.disabled, true);
  assert.equal(button(tree, '恢复默认直连').props.disabled, true);
  const before = clears;
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'http://127.0.0.1:7897' } });
  assert.equal(clears, before);
});
