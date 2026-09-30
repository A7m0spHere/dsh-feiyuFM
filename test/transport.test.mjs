// The HTTP transport and the host's platform wiring.
//
// The transport is exercised against a real local HTTP server, so this covers
// actual request building, cookie handling and failure paths — everything except
// the platform's own wire format, which is configuration and remains unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MusicError } from '../src/contracts.mjs';
import { createHttpTransport, createCookieJar, assertEndpointMap } from '../src/providers/transport.mjs';
import { createCoreHost, buildProviderRegistry, createProviderFacade } from '../src/core-host.mjs';
import { FakeProvider } from '../src/fakes.mjs';

function communityApiFor(transport) {
  const call = (role, params) => transport.request({ role, params });
  return {
    login_status: () => call('accountInfo', {}),
    user_record: ({ uid, type }) => call('recentTracks', { uid, type }),
    likelist: ({ uid }) => call('likedTracks', { uid }),
    user_playlist: ({ uid, limit, offset }) => call('playlists', { uid, limit, offset }),
    playlist_detail: ({ id }) => call('playlistTracks', { id }),
    song_detail: ({ ids }) => call('songDetails', { ids }),
  };
}

/** A local server standing in for a platform; records what it received. */
async function withServer(handler, run) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler({ req, res, body, seen });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ origin, seen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the transport builds requests from an endpoint map and returns parsed bodies', async () => {
  await withServer(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, songs: [{ id: 1 }] }));
  }, async ({ origin, seen }) => {
    const transport = createHttpTransport({
      endpoints: { search: { url: `${origin}/api/search`, query: ({ keywords, limit }) => ({ s: keywords, n: limit }) } },
    });
    const response = await transport.request({ role: 'search', params: { keywords: '德彪西', limit: 5 } });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(response.body.songs, [{ id: 1 }]);
    // The query is encoded, not concatenated.
    assert.match(seen[0].url, /\/api\/search\?s=/);
    assert.equal(decodeURIComponent(new URL(`http://x${seen[0].url}`).searchParams.get('s')), '德彪西');
    assert.equal(new URL(`http://x${seen[0].url}`).searchParams.get('n'), '5');
  });
});

test('an unconfigured role says so instead of looking like a platform failure', async () => {
  const transport = createHttpTransport({ endpoints: {} });
  await assert.rejects(
    () => transport.request({ role: 'loginQr' }),
    (error) => {
      assert.ok(error instanceof MusicError);
      assert.equal(error.code, 'endpoint_unconfigured');
      assert.match(error.message, /loginQr/);
      return true;
    },
  );
});

test('a POST body is form encoded and cookies are carried both ways', async () => {
  await withServer(({ res, seen }) => {
    if (seen.length === 1) {
      res.setHeader('set-cookie', ['MUSIC_U=session-value; Path=/; HttpOnly']);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 803 }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ accountId: 42 }));
  }, async ({ origin, seen }) => {
    const transport = createHttpTransport({
      endpoints: {
        login: { url: `${origin}/login`, body: ({ key }) => ({ key }) },
        accountInfo: { url: `${origin}/me` },
      },
    });
    const login = await transport.request({ role: 'login', params: { key: 'qr-1' } });
    assert.equal(login.body.code, 803);
    // The captured session is exposed for the adapter to store.
    assert.equal(login.body.cookie, 'MUSIC_U=session-value');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].body, 'key=qr-1');
    assert.match(seen[0].headers['content-type'], /x-www-form-urlencoded/);

    // The next call carries the cookie without the caller doing anything.
    await transport.request({ role: 'accountInfo' });
    assert.equal(seen[1].headers.cookie, 'MUSIC_U=session-value');

    // A restart can restore the session from the credential store.
    const fresh = createHttpTransport({ endpoints: { accountInfo: { url: `${origin}/me` } } });
    assert.equal(fresh.jar.size(), 0);
    assert.equal(fresh.useSecret('MUSIC_U=session-value'), 1);
    assert.equal(fresh.jar.header(), 'MUSIC_U=session-value');
  });
});

test('cookie attributes are never mistaken for cookie values', () => {
  const jar = createCookieJar();
  jar.absorb('a=1; Path=/; HttpOnly; b=2; SameSite=Lax');
  assert.equal(jar.header(), 'a=1; b=2');
  jar.absorb(['c=3; Domain=x']);
  assert.equal(jar.header(), 'a=1; b=2; c=3');
  jar.clear();
  assert.equal(jar.header(), null);
  assert.equal(jar.toSecret(), '');
});

test('HTTP failures and timeouts surface with a transport-level code', async () => {
  await withServer(({ res }) => {
    res.statusCode = 500;
    res.end('boom');
  }, async ({ origin }) => {
    const transport = createHttpTransport({ endpoints: { bad: { url: `${origin}/bad` } } });
    const response = await transport.request({ role: 'bad' });
    // The status is returned, not thrown: the adapter maps it, so one place
    // decides what a 500 means.
    assert.equal(response.status, 500);
    assert.equal(response.body, 'boom');
  });

  await withServer(() => { /* never responds */ }, async ({ origin }) => {
    const transport = createHttpTransport({ endpoints: { slow: { url: `${origin}/slow` } }, timeoutMs: 120 });
    await assert.rejects(
      () => transport.request({ role: 'slow' }),
      (error) => {
        assert.equal(error.code, 'ETIMEDOUT');
        return true;
      },
    );
  });
});

test('an endpoint map is validated before use, not mid-song', () => {
  assert.throws(() => assertEndpointMap(null, { provider: 'netease' }), /endpoint map is required/);
  assert.throws(() => assertEndpointMap({}, { provider: 'netease', required: ['search'] }), /role "search" is missing/);
  assert.throws(
    () => assertEndpointMap({ search: { url: 'ftp://x' } }, { provider: 'netease', required: ['search'] }),
    /needs an http\(s\) url/,
  );
  assert.equal(assertEndpointMap({ search: { url: 'https://x' } }, { provider: 'netease', required: ['search'] }), true);
});

test('an adapter without a transport or endpoints stays uninstalled and says so', () => {
  const registry = buildProviderRegistry({ adapters: { netease: {}, qq: null } });
  assert.equal(registry.has('netease'), false);
  assert.match(registry.getAccount('netease').reason, /not implemented yet/);
});

test('the host exposes platform state, and reports unconfigured builds honestly', async () => {
  const messages = [];
  const host = createCoreHost({
    output: { write: (chunk) => { for (const line of chunk.split('\n')) if (line.trim()) messages.push(JSON.parse(line)); } },
    playbackMode: 'fake',
  });
  try {
    await host.start();
    await host.handle({ id: 'p', type: 'platforms' });
    const answer = messages.at(-1);
    assert.equal(answer.ok, true);
    assert.match(answer.platforms.reason, /no platform adapters are configured/);

    // Every platform message refuses rather than pretending.
    for (const message of [
      { id: 'l', type: 'login', provider: 'netease', step: 'begin' },
      { id: 'i', type: 'import-platform', provider: 'netease' },
      { id: 's', type: 'search', provider: 'netease', query: 'x' },
      { id: 'd', type: 'discovery' },
    ]) {
      await host.handle(message);
      const refusal = messages.at(-1);
      assert.equal(refusal.type, 'error', `${message.type} should refuse`);
      assert.equal(refusal.error.code, 'provider_unavailable');
    }
  } finally {
    await host.close();
  }
});

test('a provider-driven import records the source the adapter really used', async () => {
  const store = new (await import('../src/storage.mjs')).MusicStore();
  const calls = [];
  const transport = {
    async request({ role, params }) {
      calls.push({ role, params });
      if (role === 'recentTracks') throw Object.assign(new Error('recent moved'), { status: 404 });
      if (role === 'likedTracks') return { status: 200, body: { ids: [{ id: 900, name: 'Liked', ar: [{ name: 'A' }], dt: 1000 }] } };
      if (role === 'songDetails') return { status: 200, body: { code: 200, songs: [{ id: 900, name: 'Liked', ar: [{ name: 'A' }], dt: 1000 }] } };
      if (role === 'accountInfo') return { status: 200, body: { accountId: 5 } };
      throw Object.assign(new Error('no fixture'), { status: 500 });
    },
  };
  const credentials = { secrets: new Map([['fishfm/netease', 'MUSIC_U=x']]), read(ref) { return this.secrets.get(ref) ?? null; }, write(ref, v) { this.secrets.set(ref, v); }, delete(ref) { this.secrets.delete(ref); } };
  store.setCredentialReference({ provider: 'netease', accountId: '5', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });

  const registry = buildProviderRegistry({
    adapters: { netease: { transport, endpoints: { anything: { url: 'https://example.invalid' } }, options: { communityApi: communityApiFor(transport) } } },
    credentials, store,
  });
  const facade = createProviderFacade({ registry });
  const messages = [];
  const host = createCoreHost({
    output: { write: (chunk) => { for (const line of chunk.split('\n')) if (line.trim()) messages.push(JSON.parse(line)); } },
    playbackMode: 'fake', platformsFacade: facade, store,
  });
  try {
    await host.start();
    // The store is shared with the adapters, so the credential reference the host
    // writes is the same one they read.
    await host.handle({ id: 'imp', type: 'import-platform', provider: 'netease', limit: 300, seed: 3 });
    const answer = messages.at(-1);
    assert.equal(answer.ok, true, `unexpected answer: ${JSON.stringify(answer)}`);
    assert.equal(answer.source, 'liked', 'the source that worked is recorded');
    assert.equal(answer.import.degraded, true);
    assert.match(answer.import.reason, /Recent playback was unavailable/);
    assert.deepEqual(answer.attempts.map((row) => row.ok), [false, true], 'the attempt trail is returned');

    // The environment now holds the imported track under the truthful source.
    const env = host.store.listEnvironment({ provider: 'netease' });
    assert.equal(env.length, 1);
    assert.equal(env[0].source, 'liked');
  } finally {
    await host.close();
    store.close();
  }
});

test('a failing provider import is an error with its attempt trail, never an empty success', async () => {
  const store = new (await import('../src/storage.mjs')).MusicStore();
  const transport = {
    async request({ role }) {
      throw Object.assign(new Error(`${role} is gone`), { status: role === 'recentTracks' ? 404 : 500 });
    },
  };
  const credentials = { read: () => 'MUSIC_U=x', write: () => {}, delete: () => {} };
  store.setCredentialReference({ provider: 'netease', accountId: '5', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1 });
  const registry = buildProviderRegistry({
    adapters: { netease: { transport, endpoints: { anything: { url: 'https://example.invalid' } }, options: { communityApi: communityApiFor(transport) } } }, credentials, store,
  });
  const messages = [];
  const host = createCoreHost({
    output: { write: (chunk) => { for (const line of chunk.split('\n')) if (line.trim()) messages.push(JSON.parse(line)); } },
    playbackMode: 'fake', platformsFacade: createProviderFacade({ registry }), store,
  });
  try {
    await host.start();
    await host.handle({ id: 'imp', type: 'import-platform', provider: 'netease', limit: 10 });
    const answer = messages.at(-1);
    assert.equal(answer.type, 'error');
    assert.equal(answer.error.code, 'provider_failure');
    assert.equal(answer.attempts.length, 3, 'every source attempted is on the record');
    assert.equal(host.store.countEnvironment('netease'), 0, 'nothing was imported');
  } finally {
    await host.close();
    store.close();
  }
});

test('the facade resolves only on the track\'s own platform and gates on sign-in', async () => {
  const registry = buildProviderRegistry({ adapters: {} });
  const fake = new FakeProvider('netease');
  fake.setAccount('netease', { status: 'login_required', reason: 'not signed in' });
  registry.providers.netease = fake;
  const facade = createProviderFacade({ registry });
  try {
    await assert.rejects(
      () => facade.resolve({ provider: 'netease', providerTrackId: '1' }),
      (error) => {
        assert.equal(error.code, 'login_required');
        assert.match(error.message, /not signed in/);
        return true;
      },
    );
    await assert.rejects(() => facade.resolve({ provider: 'qq', providerTrackId: '1' }), { code: 'provider_unavailable' });

    // Discovery stays a cache: the selector must never wait on the network.
    assert.deepEqual(facade.discoveryTracks(), []);
    // It also requires a usable account, so collecting while signed out yields
    // nothing and says why rather than looking like "no new music".
    const refused = await facade.refreshDiscovery({ limit: 5 });
    assert.deepEqual(refused.tracks, []);
    assert.match(refused.reason, /not signed in/);

    fake.setAccount('netease', { status: 'authorized', accountId: 'n1' });
    fake.setCapability('netease', 'recommendation', { status: 'available' });
    fake.getDiscoveryTracks = async () => [{ provider: 'netease', providerTrackId: 'd1', title: 'D' }];
    const refreshed = await facade.refreshDiscovery({ limit: 5 });
    assert.equal(refreshed.tracks.length, 1);
    assert.deepEqual(facade.discoveryTracks().map((t) => t.providerTrackId), ['d1']);
    facade.clearDiscovery();
    assert.deepEqual(facade.discoveryTracks(), []);
  } finally {
    // No store was created here, so there is nothing to close.
  }
});
