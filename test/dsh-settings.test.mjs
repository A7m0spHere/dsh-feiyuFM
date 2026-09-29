import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CoreBridge } from '../src/dsh-adapter.mjs';
import { createSettingsHandler, registerSettingsApi } from '../src/ui/dsh-settings.mjs';

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
