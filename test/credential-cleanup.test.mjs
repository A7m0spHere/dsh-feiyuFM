import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { createPlatformProvider } from '../src/providers/platform.mjs';
import { createMemoryCredentials, createDpapiCredentials } from '../src/providers/credentials-dpapi.mjs';
import { createMacKeychainCredentials } from '../src/providers/credentials-macos.mjs';
import { createCoreHost, createProviderFacade, ProviderRegistry } from '../src/core-host.mjs';

test('DPAPI deletion propagates file errors and treats absent files as success', () => {
  let fail = true;
  const removed = [];
  const credentials = createDpapiCredentials({ directory: 'synthetic-credentials', remove(path) {
    removed.push(path);
    if (fail) throw Object.assign(new Error('synthetic permission failure'), { code: 'EACCES' });
  } });
  assert.throws(() => credentials.delete('test'), { code: 'EACCES' });
  assert.equal(removed.length, 2, 'both ciphertext and metadata cleanup are attempted');
  fail = false;
  assert.equal(credentials.delete('test'), true);
  assert.equal(credentials.delete('test'), true);
});

test('logout disables sessions on cleanup failure, preserves a revoked retry reference across restart and retries', async t => {
  for (const backend of ['EACCES', 'keychain-helper', 'false-result']) await t.test(backend, async () => {
    const store = new MusicStore();
    const memory = createMemoryCredentials({ 'fishfm/netease': 'synthetic-private-session' });
    let fail = true;
    const credentials = backend === 'keychain-helper' ? createMacKeychainCredentials({ helper: 'synthetic-helper', run(_exe, _args, options) {
      const { operation, reference } = JSON.parse(options.input);
      if (operation === 'delete' && fail) return { status: 1, stderr: 'synthetic-private-session helper failure' };
      return { status: 0, stdout: JSON.stringify(operation === 'read' ? { value: memory.read(reference) } : { ok: memory.delete(reference) }) };
    } }) : { ...memory, delete(ref) {
      if (fail) {
        if (backend === 'false-result') return false;
        throw Object.assign(new Error('synthetic-private-session permission failure'), { code: 'EACCES' });
      }
      return memory.delete(ref);
    } };
    const sessions = [];
    let cleared = 0;
    const make = () => createPlatformProvider({ provider: 'netease', credentials, store,
      transport: { useSecret: value => sessions.push(value), jar: { clear: () => cleared++ },
        request: async () => ({ body: { key: 'qr' } }) },
      parse: { loginQr: body => body }, seedSources: { recent: {} },
    });
    store.setCredentialReference({ provider: 'netease', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
    const provider = make();
    try {
      assert.equal(provider.getAccount().status, 'authorized');
      await provider.beginLogin();
      await assert.rejects(provider.logout(), error => {
        assert.equal(error.code, 'credential_cleanup_failed');
        assert.equal(error.details.cleanupPending, true);
        assert.ok(!JSON.stringify({ message: error.message, details: error.details }).includes('synthetic-private-session'));
        return true;
      });
      assert.equal(sessions.at(-1), '');
      assert.ok(cleared > 0);
      assert.equal(memory.read('fishfm/netease'), 'synthetic-private-session');
      assert.equal(store.getCredentialReference('netease').state, 'revoked');
      assert.equal(provider.getAccount().status, 'login_required');
      assert.equal(provider.getAccount().cleanupPending, true);
      await assert.rejects(provider.pollLogin(), { code: 'invalid_command' });
      await assert.rejects(provider.getSeedTracks(), { code: 'login_required' });
      const restarted = make();
      assert.equal(restarted.getAccount().cleanupPending, true);
      assert.equal((await restarted.restore()).status, 'login_required');
      fail = false;
      assert.equal((await restarted.logout()).status, 'login_required');
      assert.equal(memory.read('fishfm/netease'), null);
      assert.equal(store.getCredentialReference('netease'), null);
      assert.equal((await restarted.logout()).status, 'login_required', 'missing credentials are idempotent');
    } finally { store.close(); }
  });
});

test('Core reports cleanup failure and clears discovery even when logout rejects', async () => {
  const store = new MusicStore();
  const credentials = createMemoryCredentials({ 'fishfm/netease': 'synthetic-session' });
  credentials.delete = () => { throw Object.assign(new Error('synthetic failure'), { code: 'EACCES' }); };
  store.setCredentialReference({ provider: 'netease', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const provider = createPlatformProvider({ provider: 'netease', credentials, store,
    transport: { request: async () => ({}) }, parse: {}, seedSources: { recent: {} } });
  const registry = new ProviderRegistry({ providers: { netease: provider } });
  const facade = createProviderFacade({ registry, store });
  let cleared = false;
  const clear = facade.clearDiscovery;
  facade.clearDiscovery = () => { cleared = true; clear(); };
  const messages = [];
  const host = createCoreHost({ store, providerRegistry: registry, platformsFacade: facade, playbackMode: 'fake',
    output: { write: line => messages.push(JSON.parse(line)) } });
  try {
    await host.start();
    await host.handle({ id: 'logout', type: 'logout', provider: 'netease' });
    assert.equal(messages.findLast(row => row.id === 'logout').error.code, 'credential_cleanup_failed');
    assert.equal(cleared, true);
    assert.equal(provider.getAccount().cleanupPending, true);
  } finally { await host.close(); store.close(); }
});
