// P2: the NetEase adapter, checked against the shared provider contract.
//
// The transport is faked, so these tests verify the adapter's own behaviour —
// account lifecycle, capability honesty, source fallback, normalization, error
// mapping and the rule that a resolved handle never reaches storage. They do not
// verify the platform's wire format, which needs a real account (P0-02/P3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { MusicError } from '../src/contracts.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { runProviderConformance, mapTransportError, toTrack, REQUIRED_CAPABILITIES } from '../src/providers/contract.mjs';

/** An in-memory credential store standing in for ctx.credentials + DPAPI. */
function fakeCredentials(initial = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    secrets,
    read: (ref) => secrets.get(ref) ?? null,
    write: (ref, secret) => { secrets.set(ref, secret); },
    delete: (ref) => { secrets.delete(ref); },
  };
}

/** A transport that answers by role from a table, and records what was asked. */
function fakeTransport(table = {}, { fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async request({ role, params, signal }) {
      calls.push({ role, params, signal });
      const failure = fail[role];
      if (failure) {
        if (typeof failure === 'function') return failure({ role, params });
        throw failure;
      }
      const body = typeof table[role] === 'function' ? table[role]({ role, params }) : table[role];
      if (body === undefined) throw Object.assign(new Error(`no fixture for ${role}`), { status: 500 });
      return { status: 200, body };
    },
  };
}

function fakeCommunityApi(transport) {
  const call = async (role, params = {}) => {
    const response = await transport.request({ role, params, signal: null });
    return { status: response.status ?? 200, body: response.body };
  };
  return {
    login_status: () => call('accountInfo'),
    user_record: ({ uid, type }) => call('recentTracks', { uid, type }),
    likelist: ({ uid }) => call('likedTracks', { uid }),
    user_playlist: ({ uid, limit, offset }) => call('playlists', { uid, limit, offset }),
    playlist_detail: ({ id }) => call('playlistTracks', { id }),
    song_detail: ({ ids }) => call('songDetails', { ids }),
  };
}

const songs = (ids) => ({ songs: ids.map((id) => ({ id, name: `Song ${id}`, ar: [{ name: 'Artist X' }], dt: 240_000 })) });

function setup({ table = {}, fail = {}, credentials = fakeCredentials(), signedIn = false } = {}) {
  const store = new MusicStore();
  if (signedIn) {
    credentials.write('fishfm/netease', 'MUSIC_U=secret-cookie-value');
    store.setCredentialReference({
      provider: 'netease', accountId: '42', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1,
    });
  }
  const transport = fakeTransport(table, { fail });
  const provider = createNetEaseProvider({ transport, communityApi: fakeCommunityApi(transport), communityLogin: false, credentials, store, now: () => 1_700_000_000_000 });
  return {
    store,
    transport,
    credentials,
    provider,
    close: () => store.close(),
    hasCredential: () => Boolean(credentials.read('fishfm/netease')),
  };
}

test('the NetEase adapter passes the shared provider contract', async () => {
  const context = setup({
    signedIn: true,
    table: {
      accountInfo: { accountId: 42 },
      recentTracks: { data: { list: [{ id: 1, name: 'A', ar: [{ name: 'X' }], dt: 1000 }] } },
      resolve: { data: [{ url: 'https://example.invalid/audio.mp3', expi: 1200 }] },
    },
  });
  try {
    const report = await runProviderConformance({
      provider: context.provider,
      name: 'netease',
      fixture: { store: context.store, hasCredential: context.hasCredential, track: { provider: 'netease', providerTrackId: '1' } },
    });
    assert.equal(report.failed, 0, `conformance failures: ${JSON.stringify(report.results.filter((row) => !row.ok))}`);
    assert.ok(report.passed >= 5, `expected most checks to run, got ${report.passed} passed / ${report.skipped} skipped`);
  } finally {
    context.close();
  }
});

test('the same contract run against a signed-out adapter reports the missing capability honestly', async () => {
  const context = setup();
  try {
    const report = await runProviderConformance({
      provider: context.provider,
      name: 'netease',
      fixture: { store: context.store, hasCredential: context.hasCredential },
    });
    assert.equal(report.failed, 0);
    const refusal = report.results.find((row) => row.title.includes('never an empty result'));
    assert.equal(refusal.ok, true);
    assert.match(refusal.detail, /login_required/, 'the refusal must name the real reason');
    // The account-dependent checks must be reported as skipped, not passed.
    assert.ok(report.skipped >= 2, `account-dependent checks should be skipped, saw ${report.skipped}`);
  } finally {
    context.close();
  }
});

test('every required capability is accounted for, even when unusable', () => {
  const context = setup();
  try {
    const capabilities = context.provider.getCapabilities();
    for (const name of REQUIRED_CAPABILITIES) {
      assert.ok(capabilities[name], `${name} must be reported`);
      if (capabilities[name].status !== 'available') {
        assert.ok(capabilities[name].reason, `${name} is unusable but gives no reason`);
      }
    }
    assert.equal(capabilities.account.status, 'login_required');
    assert.equal(capabilities.resolve.status, 'login_required');
    assert.equal(capabilities.recommendation.status, 'login_required');
  } finally {
    context.close();
  }
});

test('signing in stores session material only in the credential store, never in SQLite', async () => {
  const context = setup({
    table: {
      loginQr: { key: 'qr-key-1', qrUrl: 'https://example.invalid/qr' },
      loginPoll: { code: 803, cookie: 'MUSIC_U=very-secret-session', accountId: 7 },
      accountInfo: { profile: { userId: 7 } },
    },
  });
  try {
    const started = await context.provider.beginLogin();
    assert.equal(started.key, 'qr-key-1');
    assert.equal(context.provider.getAccount().status, 'login_required');
    assert.equal(context.provider.getAccount().pending, true, 'a pending sign-in is visible but not authorized');

    const done = await context.provider.pollLogin();
    assert.equal(done.status, 'authorized');
    assert.equal(context.credentials.read('fishfm/netease'), 'MUSIC_U=very-secret-session');

    // SQLite knows only the reference.
    const reference = context.store.getCredentialReference('netease');
    assert.equal(reference.credential_ref, 'fishfm/netease');
    assert.equal(reference.state, 'authorized');
    const dump = JSON.stringify(context.store.db.prepare('SELECT * FROM credential_references').all());
    assert.equal(dump.includes('very-secret'), false, 'session material must never be written to SQLite');
    assert.equal(JSON.stringify(context.store.getCoreState()).includes('very-secret'), false);
  } finally {
    context.close();
  }
});

test('sign-out removes both the credential and its reference', async () => {
  const context = setup({ signedIn: true, table: { accountInfo: { accountId: 42 } } });
  try {
    assert.equal(context.provider.getAccount().status, 'authorized');
    await context.provider.logout();
    assert.equal(context.credentials.read('fishfm/netease'), null);
    assert.equal(context.store.getCredentialReference('netease'), null);
    assert.equal(context.provider.getAccount().status, 'login_required');
  } finally {
    context.close();
  }
});

test('an expired stored sign-in is reported as expired, not as a working account', async () => {
  const context = setup({
    signedIn: true,
    fail: { accountInfo: Object.assign(new Error('unauthorized'), { status: 401 }) },
  });
  try {
    const restored = await context.provider.restore();
    assert.equal(restored.status, 'expired');
    assert.equal(context.store.getCredentialReference('netease').state, 'expired');
    assert.equal(context.provider.getAccount().status, 'expired');
    assert.ok(context.provider.getCapabilities().seed.reason, 'an expired account must explain itself');
  } finally {
    context.close();
  }
});

test('a usable fallback source is reported as degraded, never as recent playback', async () => {
  const context = setup({
    signedIn: true,
    fail: { recentTracks: Object.assign(new Error('gone'), { status: 404 }) },
    table: {
      likedTracks: { ids: ['11'] },
      songDetails: songs([11]),
    },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 300 });
    assert.equal(result.source, 'liked', 'the source that actually worked is reported');
    assert.equal(result.degraded, true);
    assert.equal(result.imported, 1);
    assert.equal(result.requested, 300);
    assert.match(result.reason, /Recent playback was unavailable/);
    assert.deepEqual(result.attempts.map((row) => row.source), ['recent', 'liked']);
    assert.deepEqual(result.attempts.map((row) => row.ok), [false, true], 'the trail records what worked');
    // The capability says degraded and keeps the real source.
    const seed = context.provider.getCapabilities().seed;
    assert.equal(seed.status, 'degraded');
    assert.equal(seed.source, 'liked');
  } finally {
    context.close();
  }
});

test('when no seed source works, the import fails loudly with the attempts', async () => {
  const context = setup({
    signedIn: true,
    fail: {
      recentTracks: Object.assign(new Error('nope'), { status: 500 }),
      likedTracks: Object.assign(new Error('nope'), { status: 500 }),
      playlists: { playlist: [] },
    },
  });
  try {
    await assert.rejects(
      () => context.provider.getSeedTracks({ limit: 10 }),
      (error) => {
        assert.equal(error.code, 'provider_failure');
        assert.equal(error.retryable, true);
        assert.equal(error.details.attempts.length, 3);
        assert.match(error.message, /No NetEase seed source was usable/);
        return true;
      },
    );
    // No source worked, so the capability must report the failure rather than
    // claiming no import has happened.
    const seed = context.provider.getCapabilities().seed;
    assert.equal(seed.status, 'unavailable');
    assert.match(seed.reason, /recent: provider_failure/, 'the failure reason is carried into the capability');
  } finally {
    context.close();
  }
});

test('resolve returns a handle with an expiry and never persists it', async () => {
  const context = setup({
    signedIn: true,
    table: { resolve: { data: [{ url: 'https://example.invalid/track.mp3', expi: 3600 }] } },
  });
  try {
    const resource = await context.provider.resolve({ provider: 'netease', providerTrackId: '5' }, { version: 9 });
    assert.equal(resource.handle, 'https://example.invalid/track.mp3');
    assert.equal(resource.expiresAt, 1_700_000_000_000 + 3_600_000, 'expiry is derived from the platform value');
    assert.equal(context.transport.calls.at(-1).params.id, '5');

    // The handle must exist nowhere in persistent storage.
    const dump = JSON.stringify({
      references: context.store.db.prepare('SELECT * FROM credential_references').all(),
      state: context.store.getCoreState(),
    });
    assert.equal(dump.includes('example.invalid'), false, 'a resolved handle must not be persisted');
  } finally {
    context.close();
  }
});

test('a track with no playable URL is media_unavailable, not a network failure', async () => {
  const context = setup({ signedIn: true, table: { resolve: { data: [{ url: null, reason: 'VIP only' }] } } });
  try {
    await assert.rejects(
      () => context.provider.resolve({ provider: 'netease', providerTrackId: '6' }, {}),
      (error) => {
        assert.equal(error.code, 'media_unavailable');
        assert.equal(error.retryable, false, 'this will not fix itself by retrying');
        assert.match(error.message, /VIP only/);
        return true;
      },
    );
  } finally {
    context.close();
  }
});

test('search normalizes entries, dedups ids and never returns a duplicate key', async () => {
  const context = setup({ signedIn: true, table: { search: songs([1, 2, 2, 'x']) } });
  try {
    const result = await context.provider.search('anything', { limit: 10 });
    // 'x' is a valid but different id, so only the repeated 2 is deduplicated.
    assert.deepEqual(result.tracks.map((track) => track.providerTrackId), ['1', '2', 'x']);
    assert.equal(result.tracks[0].title, 'Song 1');
    assert.equal(result.tracks[0].artist, 'Artist X');
    assert.equal(result.tracks[0].durationMs, 240_000);
    assert.equal(result.capability.status, 'available');
    await assert.rejects(() => context.provider.search('  '), { code: 'invalid_command' });
  } finally {
    context.close();
  }
});

test('transport failures map onto the project error vocabulary', () => {
  const cases = [
    [{ status: 401 }, 'login_required', false],
    [{ status: 403 }, 'login_required', false],
    [{ status: 429 }, 'rate_limited', true],
    [{ status: 500 }, 'provider_failure', true],
    [{ code: 'ETIMEDOUT' }, 'provider_failure', true],
    [{ message: 'boom' }, 'provider_failure', true],
  ];
  for (const [raw, code, retryable] of cases) {
    const mapped = mapTransportError(raw, { provider: 'netease' });
    assert.ok(mapped instanceof MusicError, `${JSON.stringify(raw)} must map to a MusicError`);
    assert.equal(mapped.code, code, `${JSON.stringify(raw)} -> ${mapped.code}`);
    assert.equal(Boolean(mapped.retryable), retryable, `${code} retryable flag`);
  }
  // An already-classified error passes through untouched.
  const original = new MusicError('media_unavailable', 'no url');
  assert.equal(mapTransportError(original, { provider: 'netease' }), original);
});

test('the shared normalizer accepts the payload shapes the platforms use', () => {
  // NetEase style, then QQ style, then unknown.
  assert.deepEqual(
    toTrack('netease', { id: 1, name: 'N', ar: [{ name: 'A' }, { name: 'B' }], dt: 1000 }),
    { provider: 'netease', providerTrackId: '1', title: 'N', artist: 'A / B', durationMs: 1000 },
  );
  assert.deepEqual(
    toTrack('qq', { songmid: 2, title: 'Q', artists: [{ name: 'C' }], duration: 2000 }),
    { provider: 'qq', providerTrackId: '2', title: 'Q', artist: 'C', durationMs: 2000 },
  );
  assert.equal(toTrack('netease', { name: 'no id' }), null, 'a track without an id cannot be keyed');
  assert.equal(toTrack('netease', null), null);
  const bare = toTrack('netease', { id: 3 });
  assert.equal(bare.title, '');
  assert.equal(bare.durationMs, null, 'unknown duration stays unknown');
});

test('a signed-out adapter refuses every operation with a named reason', async () => {
  const context = setup();
  try {
    await assert.rejects(() => context.provider.search('q'), { code: 'login_required' });
    await assert.rejects(() => context.provider.getSeedTracks({}), { code: 'login_required' });
    await assert.rejects(() => context.provider.resolve({ provider: 'netease', providerTrackId: '1' }, {}), { code: 'login_required' });
    assert.equal(context.transport.calls.length, 0, 'nothing may be sent to the platform while signed out');
  } finally {
    context.close();
  }
});
