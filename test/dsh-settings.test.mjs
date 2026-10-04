import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CoreBridge } from '../src/dsh-adapter.mjs';
import { createSettingsHandler, registerSettingsApi } from '../src/ui/dsh-settings.mjs';

test('authenticated point play strips resource and credential fields and validates the track before forwarding', async () => {
  let sent;
  const api = createSettingsHandler({ async start() {}, async command(command) { sent = command; return { snapshot: {} }; } });
  const result = await api('fishfm/command', { type: 'requestTrack', track: {
    provider: 'netease', providerTrackId: '42', title: 'Song', artist: 'Artist', durationMs: 180000,
    handle: 'https://example.invalid/audio', cookie: 'secret',
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.track, { provider: 'netease', providerTrackId: '42', title: 'Song', artist: 'Artist', durationMs: 180000 });
  sent = null;
  assert.equal((await api('fishfm/command', { type: 'requestTrack', track: { provider: 'other', providerTrackId: '42' } })).error.code, 'invalid_command');
  assert.equal(sent, null);
});

test('settings RPC persists changes through Core restart and preserves pause', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fishfm-ui-'));
  const makeBridge = () => new CoreBridge({ spawnCore: () => spawn(process.execPath,
    [resolve('bin/fishfm-core.mjs'), '--db', join(dir, 'music.sqlite'), '--playback', 'fake'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) });
  let bridge = makeBridge();
  try {
    const api = createSettingsHandler(bridge);
    assert.equal((await api('fishfm/state')).value.snapshot.paused, true);
    // 模式是开始听歌的快捷操作：空曲库时启动失败必须如实报 no_candidates，
    // 但模式设置本身已经保存（listening/strategy/恢复声音）。
    const modeResult = await api('fishfm/command', { type: 'setMode', value: 'focus' });
    assert.equal(modeResult.ok, false);
    assert.equal(modeResult.error.code, 'no_candidates');
    for (const [type, value] of [['setHumanPlayback', false], ['setDiscoveryRate', .37]]) {
      const result = await api('fishfm/command', { type, value });
      assert.equal(result.ok, true);
    }
    // Pause remains a separate user action.
    assert.equal((await api('fishfm/command', { type: 'pause' })).value.snapshot.paused, true);
    await bridge.stop();
    bridge = makeBridge();
    const restored = await createSettingsHandler(bridge)('fishfm/state');
    assert.equal(restored.value.snapshot.settings.discoveryRate, .37);
    assert.equal(restored.value.snapshot.settings.humanPlayback, false);
    assert.equal(restored.value.snapshot.settings.strategy, 'focus');
    assert.equal(restored.value.snapshot.paused, true);
  } finally { await bridge.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('settings RPC rejects arbitrary commands and malformed values before starting Core', async () => {
  const api = createSettingsHandler({ start() { assert.fail('invalid requests cannot reach Core'); } });
  for (const payload of [null, { type: 'shutdown' }, { type: 'requestTrack' }, { type: 'setListening', value: 'true' },
    { type: 'setDiscoveryRate', value: NaN }, { type: 'setDiscoveryRate', value: Infinity },
    { type: 'setDiscoveryRate', value: 1.1 }, { type: 'setMode', value: 'surprise' }]) {
    assert.equal((await api('fishfm/command', payload)).error.code, 'invalid_command');
  }
  assert.equal((await api('fishfm/shutdown', {})).error.code, 'not_found');
});

test('settings API only intercepts its authenticated endpoints and is removed on unload', () => {
  let active = false, dispose;
  registerSettingsApi({ effect(fn) { dispose = fn(); }, connection: { rpc: {
    intercept(channel, matches) {
      assert.equal(channel, '/api');
      assert.equal(matches('fishfm/state'), true);
      assert.equal(matches('fishfm/command'), true);
      assert.equal(matches('session/create'), false);
      active = true;
      return () => { active = false; };
    },
  } } }, {});
  assert.equal(active, true); dispose(); assert.equal(active, false);
});

test('desktop exact routes coexist with the Gateway and validate RPC envelopes before changing Core', async () => {
  const routes = new Map();
  let dispose, calls = 0;
  const bridge = {
    async start() {},
    async command(command) { calls++; return { snapshot: { paused: command.type === 'pause' } }; },
  };
  registerSettingsApi({
    effect(fn) { dispose = fn(); },
    connection: {
      rpc: { intercept() { assert.fail('the shared Gateway interceptor must remain untouched'); } },
      fetch: { register(route) {
        assert.deepEqual(route.methods, ['POST']);
        assert.equal(route.requestBody, 'buffered');
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      } },
    },
  }, bridge);
  assert.equal(routes.size, 13);
  assert.equal(routes.has('/api/session/create'), false);
  const path = '/api/fishfm/command';
  const request = body => new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const valid = { type: 'client-request', rpcId: 'desktop-1', method: 'fishfm/command', payload: { type: 'pause' } };
  const response = await routes.get(path).fetch(request(valid));
  assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'desktop-1', result: { ok: true, value: { snapshot: { paused: true } } } });
  assert.equal(calls, 1);
  for (const body of [{ ...valid, method: 'session/create' }, { ...valid, type: 'server-response' }, { ...valid, rpcId: 1 }, null]) {
    const invalid = await routes.get(path).fetch(request(body));
    assert.equal((await invalid.json()).result.error.code, 'gateway/bad-request');
  }
  assert.equal(calls, 1, 'invalid envelopes cannot issue commands');
  assert.equal((await routes.get(path).fetch(new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await routes.get(path).fetch(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  dispose();
  assert.equal(routes.size, 0);
});

test('persona endpoints validate their values and the summary honours the stored output cap', async () => {
  const sent = [];
  const persona = { policy: { maxOutputTokens: 96 } };
  const bridge = {
    async start() {},
    async request(message) {
      sent.push(message);
      if (message.type === 'persona') return { persona };
      if (message.type === 'persona-budget' || message.type === 'persona-output' || message.type === 'persona-automatic') return {};
      if (message.type === 'snapshot') return { snapshot: { paused: true } };
      if (message.type === 'platforms') return { platforms: {} };
      if (message.type === 'library') return { library: { total: 0 } };
      if (message.type === 'insights') return { insights: null };
      assert.fail(`unexpected core request ${message.type}`);
    },
  };
  const summarized = [];
  const service = { current: { summarize: async (route, options) => { summarized.push({ route, options }); return { cached: false }; } } };
  const api = createSettingsHandler(bridge, service);

  assert.equal((await api('fishfm/persona-budget', { value: 1.5 })).error.code, 'invalid_budget');
  assert.equal((await api('fishfm/persona-output', { value: 32 })).error.code, 'invalid_output');
  assert.equal((await api('fishfm/persona-output', { value: 4096 })).error.code, 'invalid_output');
  assert.equal((await api('fishfm/persona-automatic', { value: 'on' })).error.code, 'invalid_automatic');
  assert.deepEqual(sent, [], 'a rejected value never reaches Core');

  // Every write is followed by a full read, so assert on the writes only.
  const writes = () => sent.filter(m => ['persona-budget', 'persona-output', 'persona-automatic'].includes(m.type));
  assert.equal((await api('fishfm/persona-automatic', { value: true })).ok, true);
  assert.deepEqual(writes(), [{ type: 'persona-automatic', value: true }]);
  assert.equal((await api('fishfm/persona-output', { value: 96 })).ok, true);
  assert.deepEqual(writes(), [{ type: 'persona-automatic', value: true }, { type: 'persona-output', value: 96 }]);

  // The cap is read from Core, not accepted from the browser.
  assert.equal((await api('fishfm/persona-summary', { provider: 'p', model: 'm', maxOutputTokens: 4096 })).ok, true);
  assert.deepEqual(summarized, [{ route: { provider: 'p', model: 'm' }, options: { signal: undefined, maxOutputTokens: 96 } }]);
});

test('a persona endpoint with no model service refuses before Core reserves anything', async () => {
  const sent = [];
  const api = createSettingsHandler({ async start() {}, async request(message) { sent.push(message); return { persona: { policy: {} } }; } }, { current: null });
  assert.equal((await api('fishfm/persona-summary', { provider: 'p', model: 'm' })).error.code, 'model_unavailable');
  assert.deepEqual(sent, [], 'a missing model service is refused before Core is even asked for the profile');
});

test('import errors retain source and stage details while removing session material', async () => {
  const bridge = {
    async start() {},
    async request(message) {
      if (message.type === 'import-platform') {
        const error = new Error('网易云近期记录请求失败（HTTP 503），MUSIC_U=never-return-this');
        error.code = 'provider_failure';
        error.retryable = true;
        error.details = { attempts: [{ source: 'recent', count: 0, ok: false, code: 'provider_failure',
          stage: 'user_record', httpStatus: 503, reason: 'request rejected MUSIC_U=never-return-this', stages: [] }] };
        throw error;
      }
      assert.fail(`unexpected core request ${message.type}`);
    },
  };
  const result = await createSettingsHandler(bridge)('fishfm/import', { provider: 'netease' });
  assert.equal(result.ok, false);
  assert.equal(result.error.details.attempts[0].stage, 'user_record');
  assert.equal(result.error.details.attempts[0].httpStatus, 503);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('never-return-this'), false);
  assert.equal(serialized.includes('MUSIC_U='), false);
});
