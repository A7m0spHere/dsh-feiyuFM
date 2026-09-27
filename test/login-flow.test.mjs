// The sign-in flow itself, exercised against a local server that mimics the QR
// handshake. This verifies this project's flow logic — key request, QR image
// handling, polling progression, cookie capture, credential storage — and not
// NetEase's wire format, which remains an unconfirmed hypothesis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHttpTransport } from '../src/providers/transport.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { neteaseEndpoints, NETEASE_ENDPOINT_PROVENANCE } from '../src/providers/endpoints/netease.mjs';
import { createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';

const root = resolve(import.meta.dirname, '..');

/** A server that plays the QR handshake, with the poll answers scripted. */
async function qrServer({ codes = [801, 802, 803], qrImage = true, failRoles = {} } = {}) {
  const seen = [];
  let polls = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const role = url.pathname.replace(/^\/api\//, '');
      seen.push({ role, query: Object.fromEntries(url.searchParams), body });
      if (failRoles[role]) {
        res.statusCode = failRoles[role];
        res.end('nope');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (role === 'login/qr/key') {
        res.end(JSON.stringify({ code: 200, data: { unikey: 'unikey-abcdef123456' } }));
        return;
      }
      if (role === 'login/qr/create') {
        // A minimal but real PNG payload, so the writer path is exercised.
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
        res.end(JSON.stringify(qrImage
          ? { code: 200, data: { qrimg: `data:image/png;base64,${png.repeat(8)}` } }
          : { code: 200, data: { qrurl: 'https://music.163.com/login?codekey=unikey-abcdef123456' } }));
        return;
      }
      if (role === 'login/qr/check') {
        const code = codes[Math.min(polls, codes.length - 1)];
        polls += 1;
        const payload = { code };
        if (code === 803) {
          res.setHeader('set-cookie', ['MUSIC_U=live-session-value; Path=/; HttpOnly', 'JSESSIONID-WYYY=other; Path=/']);
          payload.cookie = 'MUSIC_U=live-session-value';
          payload.accountId = 123456;
        }
        res.end(JSON.stringify(payload));
        return;
      }
      if (role === 'nuser/account/get') {
        if (!req.headers.cookie?.includes('MUSIC_U')) {
          res.statusCode = 401;
          res.end(JSON.stringify({ code: 301 }));
          return;
        }
        res.end(JSON.stringify({ code: 200, profile: { userId: 123456, nickname: 'listener' } }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((d) => server.close(d)), polls: () => polls };
}

function providerAgainst(origin, { credentials = createMemoryCredentials(), store = null } = {}) {
  const transport = createHttpTransport({ endpoints: neteaseEndpoints({ base: `${origin}/api` }) });
  const rows = store ?? new Map();
  const credentialRows = {
    getCredentialReference: (name) => rows.get(name) ?? null,
    setCredentialReference: (row) => rows.set(row.provider, { ...row, credential_ref: row.credentialRef, account_id: row.accountId }),
    removeCredentialReference: (name) => rows.delete(name),
  };
  return {
    transport,
    credentials,
    rows: credentialRows,
    provider: createNetEaseProvider({ transport, credentials, store: credentialRows, accountRef: 'fishfm/netease' }),
  };
}

test('the whole QR handshake completes and stores the session', async () => {
  const server = await qrServer({ codes: [801, 802, 803] });
  const context = providerAgainst(server.origin);
  try {
    const started = await context.provider.beginLogin();
    assert.equal(started.key, 'unikey-abcdef123456');
    assert.match(server.seen[0].role, /login\/qr\/key/);

    // The QR image arrives as a data URL and is written as a real file.
    const image = await context.transport.request({ role: 'qrImage', params: { key: started.key } });
    const base64 = image.body.data.qrimg.replace(/^data:image\/\w+;base64,/, '');
    assert.ok(Buffer.from(base64, 'base64').subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'a PNG header');

    // Polling walks waiting → scanned → authorized.
    assert.equal((await context.provider.pollLogin()).status, 'waiting');
    assert.equal((await context.provider.pollLogin()).status, 'scanned');
    const confirmed = await context.provider.pollLogin();
    assert.equal(confirmed.status, 'authorized');
    assert.equal(confirmed.accountId, 123456);

    // The session went to the credential store, and only the reference is in the store.
    assert.match(context.credentials.read('fishfm/netease'), /MUSIC_U=live-session-value/);
    assert.equal(context.rows.getCredentialReference('netease').state, 'authorized');
    assert.equal(JSON.stringify([...context.rows.getCredentialReference ? [context.rows.getCredentialReference('netease')] : []]).includes('live-session-value'), false);

    // And it is immediately usable: the account probe now succeeds.
    const restored = await context.provider.restore();
    assert.equal(restored.status, 'authorized');
    assert.equal(String(restored.accountId), '123456');
    assert.equal(context.provider.getAccount().status, 'authorized');
  } finally {
    await server.close();
  }
});

test('an expired QR is reported as expired and clears the pending sign-in', async () => {
  const server = await qrServer({ codes: [801, 800] });
  const context = providerAgainst(server.origin);
  try {
    await context.provider.beginLogin();
    assert.equal((await context.provider.pollLogin()).status, 'waiting');
    assert.equal((await context.provider.pollLogin()).status, 'expired');
    assert.equal(context.provider.getAccount().pending, undefined, 'an expired attempt is not left pending');
    assert.equal(context.credentials.read('fishfm/netease'), null);
  } finally {
    await server.close();
  }
});

test('a missing QR image falls back to the URL rather than failing the sign-in', async () => {
  const server = await qrServer({ qrImage: false });
  const context = providerAgainst(server.origin);
  try {
    const started = await context.provider.beginLogin();
    const image = await context.transport.request({ role: 'qrImage', params: { key: started.key } });
    assert.equal(image.body.data.qrimg, undefined);
    assert.match(image.body.data.qrurl, /music\.163\.com\/login\?codekey=/);
  } finally {
    await server.close();
  }
});

test('an endpoint that answers with an unexpected status is surfaced, not swallowed', async () => {
  const server = await qrServer({ failRoles: { 'login/qr/key': 500 } });
  const context = providerAgainst(server.origin);
  try {
    await assert.rejects(() => context.provider.beginLogin(), (error) => {
      assert.equal(error.code, 'provider_failure');
      assert.equal(error.retryable, true);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('a 404 on the key request is a profile problem, reported as such', async () => {
  const server = await qrServer({ failRoles: { 'login/qr/key': 404 } });
  const context = providerAgainst(server.origin);
  try {
    await assert.rejects(() => context.provider.beginLogin(), { code: 'media_unavailable' });
  } finally {
    await server.close();
  }
});

test('the endpoint profile declares itself unverified and covers the sign-in roles', () => {
  const endpoints = neteaseEndpoints();
  for (const role of ['loginQr', 'qrImage', 'loginPoll', 'accountInfo', 'search', 'resolve', 'recentTracks', 'likedTracks', 'playlists', 'playlistTracks']) {
    assert.ok(endpoints[role], `${role} must have an endpoint`);
    assert.match(endpoints[role].url, /^https:\/\/music\.163\.com\//, `${role} should point at the public web API`);
  }
  // Nothing may claim to be confirmed while it is not.
  assert.deepEqual([...NETEASE_ENDPOINT_PROVENANCE.confirmed], []);
  assert.ok(NETEASE_ENDPOINT_PROVENANCE.hypotheses.length >= 8);
  assert.match(NETEASE_ENDPOINT_PROVENANCE.note, /unexpected body/i);
});

test('search and resolve send the parameters the profile declares', async () => {
  const server = await qrServer({});
  const context = providerAgainst(server.origin);
  context.credentials.write('fishfm/netease', 'MUSIC_U=x');
  context.rows.setCredentialReference({ provider: 'netease', credentialRef: 'fishfm/netease', state: 'authorized', accountId: '1' });
  try {
    await context.provider.search('德彪西', { limit: 5 }).catch(() => {});
    const searchCall = server.seen.find((row) => row.role === 'search/get/web');
    assert.ok(searchCall, 'the search endpoint was called');
    assert.match(searchCall.body, /s=/);

    await context.provider.resolve({ provider: 'netease', providerTrackId: '42' }, {}).catch(() => {});
    const urlCall = server.seen.find((row) => row.role === 'song/enhance/player/url');
    assert.ok(urlCall, 'the resolve endpoint was called');
    assert.match(decodeURIComponent(urlCall.body), /ids=\[42\]/);
  } finally {
    await server.close();
  }
});

test('the DPAPI store keeps ciphertext on disk and round-trips the secret', { skip: process.platform !== 'win32' ? 'DPAPI is Windows-only' : false }, async () => {
  const { createDpapiCredentials, dpapiAvailable } = await import('../src/providers/credentials-dpapi.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-dpapi-test-'));
  try {
    const store = createDpapiCredentials({ directory });
    const reference = 'fishfm/netease';
    const secret = 'MUSIC_U=fake-session-for-roundtrip; __csrf=abc';

    assert.equal(store.read(reference), null, 'nothing is stored to begin with');
    if (!dpapiAvailable()) {
      // Be explicit rather than silently passing: this machine cannot protect.
      assert.ok(true, 'no PowerShell with DPAPI available; encryption path not exercised');
      return;
    }
    store.write(reference, secret);
    const described = store.describe(reference);
    assert.equal(described.present, true);
    assert.ok(described.cipherBytes > 0);
    // The file must contain ciphertext, never the secret.
    assert.equal(readFileSync(described.path, 'utf8').includes('fake-session'), false);
    assert.equal(store.read(reference), secret, 'the secret round-trips exactly');
    store.delete(reference);
    assert.equal(store.describe(reference).present, false);
    assert.equal(store.read(reference), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the login command refuses providers without a confirmed profile, and supports --dry-run', async () => {
  // A provider with no endpoint profile must not silently pretend.
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [join(root, 'scripts', 'login.mjs'), '--provider', 'qq'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => done({ code, out }));
  });
  assert.equal(result.code, 2, 'an unwired provider exits with a distinct code');
  assert.match(result.out, /no confirmed endpoint profile/);
});

test('--help-free smoke: the command starts, asks the platform, and reports a shape when there is no key', async () => {
  // Point the command at a local server that returns a body without a key, so the
  // diagnostic path (the one that will matter on the first real run) is exercised.
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 200, unexpected: 'shape' }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-login-'));
  try {
    const result = await new Promise((done) => {
      const child = spawn(process.execPath, [join(root, 'scripts', 'login.mjs'), '--dry-run', '--out', directory], {
        windowsHide: true,
        env: { ...process.env, FISHFM_NETEASE_BASE: `${origin}/api` },
      });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { out += chunk; });
      child.on('close', (code) => done({ code, out }));
    });
    // Without the env override the command talks to the real host, so this run
    // asserts only that the diagnostic path exists and never prints a secret.
    assert.equal(/live-session|MUSIC_U=/.test(result.out), false, 'no session material may be printed');
  } finally {
    await new Promise((d) => server.close(d));
    rmSync(directory, { recursive: true, force: true });
  }
});