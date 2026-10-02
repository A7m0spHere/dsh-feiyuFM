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
    for (const [type, value] of [['setHumanPlayback', false], ['setDiscoveryRate', .37]]) {
      const result = await api('fishfm/command', { type, value });
      assert.equal(result.ok, true);
      assert.equal(result.value.snapshot.paused, true);
    }
    // Modes explicitly start listening; pause remains a separate user action.
    assert.equal((await api('fishfm/command', { type: 'setMode', value: 'focus' })).ok, true);
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
  assert.equal(routes.size, 6);
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
