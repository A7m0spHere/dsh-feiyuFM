import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(call, storage = new Map()) {
  const registrations = [], effects = [], styles = [];
  const intervals = new Set();
  const hooks = new Map();
  let activeHooks = null, cursor = 0;
  let bundle;
  const React = {
    createElement(type, props, ...children) {
      if (typeof type !== 'function') return { type, props: props || {}, children: children.flat(Infinity) };
      const parentHooks = activeHooks, parentCursor = cursor;
      const instanceKey = `${type.name}:${props?.key ?? ''}`;
      activeHooks = hooks.get(instanceKey) ?? []; cursor = 0;
      const tree = type({ ...props, children: children.flat(Infinity) });
      hooks.set(instanceKey, activeHooks);
      activeHooks = parentHooks; cursor = parentCursor;
      return tree;
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState(initial) {
      const index = cursor++;
      const state = activeHooks;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; const state = activeHooks; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect() {}, useId: () => `rate-${cursor++}`, Fragment: 'fragment',
  };
  runInNewContext(readFileSync(new URL('../src/ui/dsh-client.js', import.meta.url), 'utf8'), {
    window: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      __ModuleLoader__: { load(value) { bundle = value.factory(name => { assert.equal(name, 'react'); return React; }); } } },
    document: { hidden: false, activeElement: { focus() {} }, createElement: () => ({ dataset: {}, remove() { styles.pop(); } }), head: { appendChild(el) { styles.push(el); } } },
    AbortController, setTimeout, clearTimeout,
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
  });
  bundle.apply({ connection: { rpc: { call } }, layout: { selectPanel() {} },
    effect(fn) { effects.push(fn()); }, slots: {
      inject(_name, fn) { fn(); }, register(options, component) { registrations.push({ options, component }); return () => {}; },
    } });
  const panel = registrations.find(r => r.options.name === 'main');
  const overlay = registrations.find(r => r.options.name === 'shell.overlay');
  const controller = panel.options.inject().controller;
  const renderComponent = (registration, props = {}) => {
    activeHooks = hooks.get(registration.component) ?? [];
    cursor = 0;
    const tree = registration.component({ ...registration.options.inject?.(), ...props,
      usePanelInfo: selector => { assert.equal(typeof selector, 'function', 'DSH root hooks require a selector'); return selector({ activePanelId: props.activePanelId ?? null }); } });
    hooks.set(registration.component, activeHooks);
    activeHooks = null;
    return tree;
  };
  return { registrations, controller, intervals, styles, storage,
    render: props => renderComponent(panel, props),
    renderOverlay: props => renderComponent(overlay, props),
    dispose() { effects.forEach(fn => fn()); },
  };
}
const snapshot = (revision, humanPlayback = true) => ({ revision, settings: {
  listening: true, humanPlayback, discovery: true, discoveryRate: .2, strategy: 'normal',
}, paused: true, current: null, queue: [], status: 'idle' });
const state = value => ({ ok: true, value: { snapshot: value, platforms: {} } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function all(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(all)]; }

test('song feedback follows the captured playback instance and reset requires an explicit in-panel confirmation',async()=>{
 const current={playInstanceId:'client-play',track:{provider:'netease',providerTrackId:'1',title:'Song'}};
 let feedback={version:1,current:0,liked:0,reduced:0,canUndoReset:false};const calls=[];
 const f=fixture(async(_channel,endpoint,payload)=>{
  if(endpoint==='fishfm/command') {
   calls.push(payload);
   if(payload.type==='setTrackFeedback')feedback={...feedback,current:payload.value,liked:payload.value===1?1:0,reduced:payload.value===-1?1:0};
   if(payload.type==='resetTaste')feedback={...feedback,canUndoReset:true};
  }
  return {ok:true,value:{snapshot:{...snapshot(1),current},insights:{feedback},platforms:{}}};
 });
 const off=f.controller.subscribe(()=>{});try {
  await tick();let nodes=all(f.render());await nodes.find(n=>n.children.includes('喜欢')).props.onClick();
  assert.equal(calls[0].type,'setTrackFeedback');assert.equal(calls[0].playInstanceId,'client-play');assert.equal(calls[0].track.providerTrackId,'1');
  nodes=all(f.render());assert.equal(nodes.find(n=>n.children.includes('喜欢')).props['aria-pressed'],true);
  await nodes.find(n=>n.children.includes('喜欢')).props.onClick();assert.equal(calls.at(-1).value,0);
  nodes=all(f.render());nodes.find(n=>n.children.includes('重置推荐偏好')).props.onClick();
  assert.equal(calls.some(c=>c.type==='resetTaste'),false,'opening confirmation never changes preferences');
  nodes=all(f.render());await nodes.find(n=>n.children.includes('确认重置')).props.onClick();
  assert.equal(calls.at(-1).type,'resetTaste');assert.equal(calls.at(-1).value.clearFeedback,false);
  assert.equal(f.controller.getSnapshot().snapshot.paused,true);assert.equal(f.controller.getSnapshot().insights.feedback.canUndoReset,true);
 }finally{off();f.dispose();}
});

test('a saved low output cap can be raised again within the allowed range',async()=>{
 let cap=64;const sent=[];
 const view=()=>({generatedAt:1,facts:{artists:[],validListens:0,exploration:70,discoveryEnabled:true},summary:null,
  policy:{dailyTokens:4000,maxOutputTokens:cap,minOutputTokens:64,outputMaximumTokens:256,automatic:false,autoMinNewListens:50},
  ledger:{today:{knownTokens:0},total:{knownTokens:0,attempts:0,unknownCalls:0},localDecisionRequests:0,remainingTokens:4000,recent:[]}});
 const f=fixture(async(_channel,endpoint,payload)=>{
  if(endpoint==='fishfm/persona-output'){sent.push(payload);cap=payload.value;}
  return{ok:true,value:{snapshot:snapshot(1),persona:view(),platforms:{}}};
 });const off=f.controller.subscribe(()=>{});
 try{await tick();let nodes=all(f.render());const input=nodes.find(n=>n.props['aria-label']==='单次输出 token 上限');
  assert.equal(input.props.max,256);input.props.onChange({target:{value:'256'}});
  nodes=all(f.render());const save=nodes.find(n=>n.children.includes('保存上限'));assert.equal(save.props.disabled,false);
  await save.props.onClick();assert.equal(sent[0].value,256);assert.equal(f.controller.getSnapshot().persona.policy.maxOutputTokens,256);
 }finally{off();f.dispose();}
});

test('motion preferences survive remount and never send Core commands', async () => {
  const storage = new Map(), calls = [];
  const f = fixture(async (_channel, endpoint) => { calls.push(endpoint); return state(snapshot(1)); }, storage);
  const off = f.controller.subscribe(() => {});
  await tick();
  all(f.render()).find(n => n.props['aria-label'] === '动态效果').props.onChange({ target: { value: 'off' } });
  assert.equal(f.render().props['data-motion'], 'off');
  assert.equal(calls.includes('fishfm/command'), false);
  off(); f.dispose();
  const again = fixture(async () => state(snapshot(1)), storage);
  try { assert.equal(again.render().props['data-motion'], 'off'); }
  finally { again.dispose(); }
});

test('manual first-play preserves autonomy settings and business errors do not mark the connection offline', async () => {
  const calls = [];
  const track = { provider: 'netease', providerTrackId: '42', title: 'Song' };
  const f = fixture(async (_channel, endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'fishfm/command') return { ok: false, error: { code: 'no_candidates', message: 'No candidates' } };
    const value = snapshot(1); value.settings.listening = false;
    return { ok: true, value: { snapshot: value, library: { total: 1, tracks: [track] } } };
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick(); await f.controller.playOrPause();
    assert.equal(calls.at(-1).payload.type, 'requestTrack');
    assert.equal(f.controller.getSnapshot().snapshot.settings.listening, false);
    assert.equal(f.controller.getSnapshot().connected, true);
  } finally { off(); f.dispose(); }
});

test('an imported library restored from Core enables first playback and point play without importing again', async () => {
  const calls = [];
  const track = { provider: 'netease', providerTrackId: '42', title: 'Saved song', artist: 'Artist', durationMs: 180000 };
  const f = fixture(async (_channel, endpoint, payload) => {
    calls.push({ endpoint, payload });
    return { ok: true, value: { snapshot: snapshot(1), platforms: {}, library: { total: 1, tracks: [track] } } };
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    const start = all(f.render()).find(n => n.children.includes('开始听歌'));
    assert.equal(start.props.disabled, false);
    await start.props.onClick();
    assert.equal(calls.at(-1).payload.type, 'resume');
    await all(f.render()).find(n => n.props['aria-label'] === '播放 Saved song · Artist').props.onClick();
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).payload)), { type: 'requestTrack', track });
  } finally { off(); f.dispose(); }
});

test('the floating player selects the active panel from the host hook and returns after leaving FishFM', () => {
  const f = fixture(async () => state(snapshot(1)));
  try {
    assert.ok(f.renderOverlay(), 'the conversation shows the widget');
    assert.equal(f.renderOverlay({ activePanelId: 'fishfm' }), null, 'the full panel hides the widget');
    assert.ok(f.renderOverlay({ activePanelId: 'plugins' }), 'leaving the panel restores the widget');
  } finally { f.dispose(); }
});

test('client contributes native sidebar, main and settings seats; controls send Core commands', async () => {
  const calls = [];
  const f = fixture(async (channel, endpoint, payload) => { calls.push({ channel, endpoint, payload }); return state(snapshot(calls.length, endpoint !== 'fishfm/command')); });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    assert.deepEqual(f.registrations.map(r => r.options.name), ['main', 'sidebar.panellist', 'settings.section', 'shell.overlay']);
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
    const input=all(f.render({close(){}})).find(n=>n.type==='details'&&n.props.className==='fm-input-library');
    assert.ok(input,'settings retain the input library behind a disclosure');
    assert.notEqual(input.props.open,true,'input library starts collapsed');
    assert.equal(all(f.render()).find(n => n.children.includes('开始听歌')).props.disabled, true);
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

test('a pending model summary does not block pause and its stale response cannot overwrite playback',async()=>{
 let complete;const calls=[];
 const f=fixture(async(_channel,endpoint,payload)=>{
  calls.push(endpoint);
  if(endpoint==='fishfm/persona-summary')return new Promise(resolve=>{complete=resolve;});
  if(endpoint==='fishfm/command')return state({...snapshot(2),paused:true});
  return state({...snapshot(1),paused:false});
 });
 const off=f.controller.subscribe(()=>{});
 try{await tick();const pending=f.controller.personaAction('summary',{provider:'configured',model:'model'});await tick();
  await f.controller.command('pause');assert.equal(calls.includes('fishfm/command'),true);assert.equal(f.controller.getSnapshot().snapshot.paused,true);
  complete({ok:true,value:{snapshot:{...snapshot(0),paused:false},persona:null}});await pending;
  assert.equal(f.controller.getSnapshot().snapshot.paused,true);assert.equal(f.controller.getSnapshot().summaryBusy,false);
 }finally{off();f.dispose();}
});
test('the automatic toggle and the output cap are separate actions with their own endpoints and notices', async () => {
  const calls = [];
  const persona = { generatedAt: 5, facts: { artists: [], validListens: 0, exploration: 70, discoveryEnabled: true },
    summary: null, summaryStale: true, policy: { automatic: false, automaticDue: false, automaticBlockedBy: 'disabled',
      dailyTokens: 4000, maxOutputTokens: 256, minOutputTokens: 64, autoMinNewListens: 50, maxPromptBytes: 1500, factsBytes: 400 },
    ledger: { today: { attempts: 0, knownTokens: 0, unknownCalls: 0, chargedTokens: 0 }, total: { attempts: 0, knownTokens: 0, unknownCalls: 0, chargedTokens: 0 },
      remainingTokens: 4000, localDecisionRequests: 0, recent: [] } };
  // The refresh returns a newer projection, every write returns the stale one.
  const f = fixture(async (_channel, endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint.startsWith('fishfm/persona')) return { ok: true, value: { persona, summaryModels: [], summaryResult: null } };
    return { ok: true, value: { snapshot: snapshot(1), persona: { ...persona, generatedAt: 9 } } };
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    assert.equal(f.controller.getSnapshot().persona.generatedAt, 9, 'the refresh publishes the newer projection');
    await f.controller.personaAction('automatic', { value: true });
    assert.deepEqual(calls.at(-1), { endpoint: 'fishfm/persona-automatic', payload: { value: true } });
    assert.equal(f.controller.getSnapshot().summaryNotice, '自动总结已开启，只在画像更新且预算允许时运行。');
    assert.equal(f.controller.getSnapshot().persona.generatedAt, 9, 'the stale write response cannot roll the profile back');
    await f.controller.personaAction('output', { value: 64 });
    assert.deepEqual(calls.at(-1), { endpoint: 'fishfm/persona-output', payload: { value: 64 } });
    assert.equal(f.controller.getSnapshot().summaryNotice, '单次输出上限已保存。');
    assert.equal(f.controller.getSnapshot().summaryBusy, false);
  } finally { off(); f.dispose(); }
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

test('floating music control shares Core actions and its menu opens the full settings panel', async () => {
  const calls = [];
  let selected = null;
  const f = fixture(async (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    return state({ ...snapshot(calls.length), current: { track: { title: 'Rain', artist: 'Aster' }, positionMs: 40_000 } });
  });
  const overlayRegistration = f.registrations.find(r => r.options.name === 'shell.overlay');
  // The production slot injects the same controller and DSH layout action.
  overlayRegistration.options.inject = () => ({ controller: f.controller, layout: { selectPanel(id) { selected = id; } } });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    let nodes = all(f.renderOverlay());
    assert.ok(nodes.some(n => n.children.includes('肥鱼电台 · 待命')) || nodes.some(n => n.children.includes('Rain')));
    nodes.find(n => n.props['aria-expanded'] === false && n.props['aria-controls'] === 'fishfm-quick-controls').props.onClick();
    nodes = all(f.renderOverlay());
    assert.ok(nodes.some(n => n.props.role === 'dialog' && n.props['aria-label'] === '音乐快捷控制'));
    const play = nodes.find(n => n.props['aria-label'] === '继续播放');
    assert.equal(play.props.disabled, false);
    await play.props.onClick();
    assert.equal(calls.at(-1).endpoint, 'fishfm/command');
    assert.equal(calls.at(-1).payload.type, 'resume');

    nodes.find(n => n.props['aria-label'] === '收起快捷控制').props.onClick();
    nodes = all(f.renderOverlay());
    nodes.find(n => n.props['aria-label'] === '更多音乐设置').props.onClick();
    nodes = all(f.renderOverlay());
    assert.ok(nodes.some(n => n.props.role === 'menu' && n.props['aria-label'] === '音乐快捷菜单'));
    nodes.find(n => n.props.role === 'menuitem' && n.children.some(child => child?.children?.includes('打开肥鱼电台设置'))).props.onClick();
    assert.equal(selected, 'fishfm');
  } finally { off(); f.dispose(); }
});

test('an expired import refreshes the account card and exposes the re-login state', async () => {
  const f = fixture(async (_channel, endpoint) => {
    if (endpoint === 'fishfm/import') return { ok: false, error: { code: 'login_required', message: '登录已过期，请重新扫码。' } };
    return { ok: true, value: { snapshot: snapshot(2), platforms: { netease: { installed: true, account: { status: 'expired' } } } } };
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick();
    await f.controller.platformAction('import', 'netease');
    const current = f.controller.getSnapshot();
    assert.equal(current.platforms.netease.account.status, 'expired');
    assert.equal(current.login.status, 'expired');
    const nodes = all(f.render());
    assert.ok(nodes.some(node => node.children.includes('登录已失效')));
    assert.equal(nodes.some(node => node.children.includes('二维码已过期')), false);
    assert.match(current.error, /登录已过期/);
    assert.equal(current.connected, true, 'a platform login failure does not masquerade as a Core disconnect');
  } finally { off(); f.dispose(); }
});

test('a failed login validation is retryable in the panel and is not labelled QR expiration', async () => {
  let checks = 0;
  const expired = () => ({ ok: true, value: { snapshot: snapshot(1), platforms: { netease: { installed: true, account: { status: 'expired' } } } } });
  const f = fixture(async (_channel, endpoint) => {
    if (endpoint === 'fishfm/login-start') return { ...expired(), value: { ...expired().value, login: { provider: 'netease', status: 'waiting', qrImage: 'data:image/png;base64,test' } } };
    if (endpoint === 'fishfm/login-poll') {
      if (++checks === 1) return { ok: false, error: { code: 'provider_failure', message: '账号校验暂时失败', retryable: true, details: { stage: 'login_status' } } };
      return { ok: true, value: { snapshot: snapshot(2), platforms: { netease: { installed: true, account: { status: 'authorized' } } }, login: { provider: 'netease', status: 'authorized', accountId: '42' } } };
    }
    return expired();
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick(); await f.controller.platformAction('begin', 'netease'); await f.controller.platformAction('poll', 'netease');
    let nodes = all(f.render());
    assert.ok(nodes.some(node => node.children.includes('登录校验未通过')));
    assert.equal(nodes.some(node => node.children.includes('二维码已过期')), false);
    await nodes.find(node => node.children.includes('重试登录校验')).props.onClick();
    assert.equal(f.controller.getSnapshot().login.status, 'authorized'); assert.equal(checks, 2);
  } finally { off(); f.dispose(); }
});

test('a QR detection failure retries the existing attempt without starting another QR', async () => {
  let begins = 0, polls = 0;
  const value = { snapshot: snapshot(1), platforms: { netease: { installed: true, account: { status: 'login_required' } } } };
  const f = fixture(async (_channel, endpoint) => {
    if (endpoint === 'fishfm/login-start') { begins++; return { ok: true, value: { ...value, login: { provider: 'netease', status: 'waiting' } } }; }
    if (endpoint === 'fishfm/login-poll') {
      if (++polls === 1) return { ok: false, error: { code: 'provider_failure', message: '检测暂时失败', details: { stage: 'login_qr_check', platformCode: 502 } } };
      return { ok: true, value: { ...value, login: { provider: 'netease', status: 'authorized', accountId: '42' } } };
    }
    return { ok: true, value };
  });
  const off = f.controller.subscribe(() => {});
  try {
    await tick(); await f.controller.platformAction('begin', 'netease'); await f.controller.platformAction('poll', 'netease');
    const nodes = all(f.render());
    assert.equal(nodes.some(node => node.children.includes('二维码已过期')), false);
    await nodes.find(node => node.children.includes('重试扫码检测')).props.onClick();
    assert.equal(begins, 1); assert.equal(polls, 2);
    assert.equal(f.controller.getSnapshot().login.status, 'authorized');
  } finally { off(); f.dispose(); }
});

test('floating visibility and the docked edge survive a renderer remount', () => {
  const storage = new Map();
  const first = fixture(async () => state(snapshot(1)), storage);
  first.controller.setWidgetVisible(false);
  first.controller.setWidgetPosition({ edge: 'left', top: 285 });
  assert.equal(first.controller.getSnapshot().widgetVisible, false);
  first.dispose();
  const second = fixture(async () => state(snapshot(1)), storage);
  try {
    assert.equal(second.controller.getSnapshot().widgetVisible, false);
    assert.equal(second.controller.getSnapshot().widgetPosition.edge, 'left');
    assert.equal(second.controller.getSnapshot().widgetPosition.top, 285);
    assert.equal(second.renderOverlay(), null, 'a hidden overlay stays hidden after remount');
  } finally { second.dispose(); }
});

test('dragging docks the floating bar to an edge and arrow keys move it accessibly', () => {
  const f = fixture(async () => state(snapshot(1)));
  try {
    const root = f.renderOverlay();
    const frame = { left: 0, top: 0, width: 1000, height: 700 };
    const rect = { left: 800, top: 500, width: 320, height: 80 };
    root.props.ref.current = {
      parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) },
      closest(selector) { assert.equal(selector, '[data-shell-overlay]'); return { getBoundingClientRect: () => frame }; },
      getBoundingClientRect: () => rect,
    };
    const handle = all(root).find(node => node.props['aria-label']?.startsWith('拖动悬浮条'));
    let prevented = false;
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 810, clientY: 515,
      currentTarget: { setPointerCapture() {} }, preventDefault() { prevented = true; } });
    handle.props.onPointerMove({ clientX: 100, clientY: 300 });
    handle.props.onPointerUp();
    assert.equal(prevented, true);
    assert.equal(f.controller.getSnapshot().widgetPosition.edge, 'left');
    assert.equal(f.controller.getSnapshot().widgetPosition.top, 285);

    const docked = f.renderOverlay();
    assert.equal(docked.props.style.left, '16px');
    assert.equal(docked.props.style.top, '285px');
    const dockedHandle = all(docked).find(node => node.props['aria-label']?.startsWith('拖动悬浮条'));
    let preventedArrow = false;
    dockedHandle.props.onKeyDown({ key: 'ArrowDown', preventDefault() { preventedArrow = true; } });
    assert.equal(preventedArrow, true);
    assert.equal(f.controller.getSnapshot().widgetPosition.edge, 'left');
    assert.equal(f.controller.getSnapshot().widgetPosition.top, 301);
  } finally { f.dispose(); }
});
