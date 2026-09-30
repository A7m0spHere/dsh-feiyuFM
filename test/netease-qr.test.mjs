import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MusicStore } from '../src/storage.mjs';
import { createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';
import { createNetEaseProvider, callCommunityQrCheck } from '../src/providers/netease.mjs';

const NEW = 'MUSIC_U=new-private-session; __csrf=new-private-csrf';
const OLD = 'MUSIC_U=previous-private-session';
const confirmed = { status: 200, body: { code: 803 }, cookie: ['MUSIC_U=new-private-session; Path=/; HttpOnly', '__csrf=new-private-csrf; Path=/'] };
const identity = { status: 200, body: { data: { code: 200, profile: { userId: 42 } } }, cookie: [] };

test('the pinned QR checker cannot replace the upstream error with its catch ReferenceError', async () => {
  const module = createRequire(import.meta.url)('@neteasecloudmusicapienhanced/api/module/login_qr_check.js');
  const upstream = { status: 502, body: { code: 502, msg: 'Parse Error: Header overflow' }, cookie: [] };
  await assert.rejects(callCommunityQrCheck(module, async () => { throw upstream; }, { key: 'test-key' }), error => error === upstream);
});

function fixture({ check = () => confirmed, account = () => identity, previous = false } = {}) {
  const store = new MusicStore();
  const credentials = createMemoryCredentials(previous ? { 'fishfm/netease': OLD } : {});
  if (previous) store.setCredentialReference({ provider: 'netease', accountId: 'old', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const calls = [], writes = [];
  const write = credentials.write;
  credentials.write = (...args) => { writes.push(args); return write(...args); };
  const provider = createNetEaseProvider({ store, credentials, now: () => 123456,
    transport: { request() { assert.fail('the production QR path must use the community modules'); }, useSecret() {}, jar: { toSecret: () => OLD } },
    communityApi: {
      async login_qr_key(params) { calls.push({ method: 'key', params }); return { status: 200, body: { code: 200, data: { unikey: 'test-key' } }, cookie: ['NMTID=guest; Path=/'] }; },
      async login_qr_check(params) { calls.push({ method: 'check', params }); return check(params); },
      async login_status(params) { calls.push({ method: 'account', params }); return account(params); },
    },
  });
  return { provider, credentials, store, calls, writes, close: () => store.close() };
}

test('the pinned community QR modules send type 3 for both key and check', async () => {
  const require = createRequire(import.meta.url);
  const key = require('@neteasecloudmusicapienhanced/api/module/login_qr_key.js');
  const check = require('@neteasecloudmusicapienhanced/api/module/login_qr_check.js');
  const calls = [];
  const request = async (url, data) => { calls.push({ url, data }); return { body: { code: 801 }, cookie: [] }; };
  await key({}, request); await check({ key: 'test-key' }, request);
  assert.deepEqual(calls.map(call => call.data.type), [3, 3]);
  assert.equal(calls[1].data.key, 'test-key');
});

test('community QR validates a fresh account cookie before persisting and never sends the previous account', async () => {
  const f = fixture({ previous: true });
  try {
    assert.equal((await f.provider.beginLogin()).qrUrl, 'https://music.163.com/login?codekey=test-key');
    const pending = f.provider.pollLogin();
    const result = await pending;
    assert.deepEqual(f.calls.map(call => call.method), ['key', 'check', 'account']);
    assert.deepEqual(f.calls[0].params.cookie, {}); assert.deepEqual(f.calls[1].params.cookie, {});
    assert.equal(f.calls[1].params.timestamp, 123456);
    assert.equal(f.calls[1].params.timeout, 10000);
    assert.equal(f.calls[2].params.cookie, NEW);
    assert.equal(result.status, 'authorized'); assert.equal(result.accountId, '42');
    assert.equal(f.credentials.read('fishfm/netease'), NEW); assert.equal(f.writes.length, 1);
    assert.equal(f.store.getCredentialReference('netease').account_id, '42');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(f.store.getCredentialReference('netease')).includes('private'), false);
  } finally { f.close(); }
});

test('guest cookies and unexpected QR codes cannot be mistaken for authorization', async () => {
  for (const code of [200, 502, 405, null]) {
    const f = fixture({ check: () => ({ status: 200, body: { code, cookie: 'NMTID=guest' } }), previous: true });
    try {
      await f.provider.beginLogin();
      await assert.rejects(f.provider.pollLogin(), { code: 'provider_failure' });
      assert.equal(f.writes.length, 0); assert.equal(f.credentials.read('fishfm/netease'), OLD);
      assert.equal(f.calls.some(call => call.method === 'account'), false);
    } finally { f.close(); }
  }
});

test('803 without MUSIC_U rejects the scan and cannot borrow an old jar credential', async () => {
  for (const cookie of ['', 'NMTID=guest', 'MUSIC_U=; Path=/']) {
    const f = fixture({ check: () => ({ status: 200, body: { code: 803, cookie }, cookie: [] }) });
    try {
      await f.provider.beginLogin();
      await assert.rejects(f.provider.pollLogin(), { code: 'login_cookie_missing' });
      assert.equal(f.writes.length, 0); assert.equal(f.store.getCredentialReference('netease'), null);
      assert.equal(f.calls.some(call => call.method === 'account'), false);
    } finally { f.close(); }
  }
});

test('a rejected QR request preserves the actual code and classifies header overflow without leaking cookies', async () => {
  const f = fixture({ check: () => { throw { status: 502, body: { code: 502, msg: 'Parse Error: Header overflow MUSIC_U=private-value' } }; } });
  try {
    await f.provider.beginLogin();
    await assert.rejects(f.provider.pollLogin(), error => {
      assert.equal(error.details.platformCode, 502);
      assert.equal(error.details.httpStatus, 502);
      assert.match(error.message, /响应头/);
      assert.equal(error.message.includes('private-value'), false); return true;
    });
    assert.equal(f.writes.length, 0);
  } finally { f.close(); }
});

test('a transient 502 after scanning retries the same key once and still validates before committing', async () => {
  let calls = 0;
  const f = fixture({ check: () => ++calls === 1 ? { status: 200, body: { code: 502 }, cookie: [] } : confirmed });
  try {
    await f.provider.beginLogin();
    const result = await f.provider.pollLogin();
    assert.equal(result.status, 'authorized');
    assert.deepEqual(f.calls.filter(call => call.method === 'check').map(call => call.params.key), ['test-key', 'test-key']);
    assert.equal(f.calls.filter(call => call.method === 'key').length, 1);
    assert.equal(f.writes.length, 1);
  } finally { f.close(); }
});

test('801 and 802 are pending, and only 800 expires the QR', async () => {
  let code = 801;
  const f = fixture({ check: () => ({ status: 200, body: { code, cookie: 'NMTID=guest' } }) });
  try {
    await f.provider.beginLogin(); assert.equal((await f.provider.pollLogin()).status, 'waiting');
    code = 802; assert.equal((await f.provider.pollLogin()).status, 'scanned');
    code = 800; assert.equal((await f.provider.pollLogin()).status, 'expired');
    assert.equal(f.writes.length, 0); assert.equal(f.calls.some(call => call.method === 'account'), false);
  } finally { f.close(); }
});

test('failed identity validation keeps the old credential and can retry without another QR check', async () => {
  let first = true;
  const f = fixture({ previous: true, account() { if (first) { first = false; throw { status: 503 }; } return identity; } });
  try {
    await f.provider.beginLogin();
    await assert.rejects(f.provider.pollLogin(), { code: 'provider_failure', retryable: true });
    assert.equal(f.writes.length, 0); assert.equal(f.credentials.read('fishfm/netease'), OLD);
    assert.equal(f.store.getCredentialReference('netease').state, 'authorized');
    assert.equal((await f.provider.pollLogin()).accountId, '42');
    assert.equal(f.calls.filter(call => call.method === 'check').length, 1);
    assert.equal(f.calls.filter(call => call.method === 'account').length, 2);
  } finally { f.close(); }
});

test('a guest identity or missing UID rejects the candidate without declaring the QR expired', async () => {
  for (const profile of [null, { nickname: 'no UID' }]) {
    const f = fixture({ account: () => ({ status: 200, body: { data: { code: 200, account: null, profile } }, cookie: [] }) });
    try {
      await f.provider.beginLogin();
      await assert.rejects(f.provider.pollLogin(), error => {
        assert.ok(['login_validation_failed', 'account_id_unavailable'].includes(error.code));
        assert.equal(error.details.stage, 'login_status'); return true;
      });
      assert.equal(f.writes.length, 0); assert.equal(f.provider.getAccount().status, 'login_required');
    } finally { f.close(); }
  }
});

test('signing out while identity validation is slow cannot restore the late credential', async () => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const f = fixture({ account() { entered.resolve(); return gate.promise; } });
  try {
    await f.provider.beginLogin(); const pending = f.provider.pollLogin(); await entered.promise;
    assert.equal(f.writes.length, 0);
    await f.provider.logout(); gate.resolve(identity);
    await assert.rejects(pending, { code: 'cancelled' });
    assert.equal(f.writes.length, 0); assert.equal(f.credentials.read('fishfm/netease'), null);
  } finally { gate.resolve(identity); f.close(); }
});
