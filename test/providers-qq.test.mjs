// P4: the QQ adapter, run through the same provider contract checks as NetEase.
//
// The point of this file is twofold: QQ must satisfy the identical normalized
// checks (PROJECT_PLAN requires one set for both platforms), and QQ's documented
// degradation — a failing recent-list must change the source, not remove QQ
// support — must be visible in what the adapter reports.
//
// The transport is faked, so this verifies the adapter's behaviour and not the
// platform's wire format, which needs a real account (P0-03/P3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { createQQProvider, QQ_SEED_ORDER, QQ_ROLES } from '../src/providers/qq.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { runProviderConformance } from '../src/providers/contract.mjs';

function fakeCredentials(initial = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    read: (ref) => secrets.get(ref) ?? null,
    write: (ref, secret) => { secrets.set(ref, secret); },
    delete: (ref) => { secrets.delete(ref); },
  };
}

function fakeTransport(table = {}, { fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async request({ role, params, signal }) {
      calls.push({ role, params, signal });
      const failure = fail[role];
      if (failure) throw failure;
      const body = typeof table[role] === 'function' ? table[role]({ role, params }) : table[role];
      if (body === undefined) throw Object.assign(new Error(`no fixture for ${role}`), { status: 500 });
      return { status: 200, body };
    },
  };
}

const qqSong = (mid, extra = {}) => ({ songmid: mid, title: `Song ${mid}`, artists: [{ name: 'QQ Artist' }], duration: 200_000, ...extra });

function setup({ table = {}, fail = {}, signedIn = false } = {}) {
  const store = new MusicStore();
  const credentials = fakeCredentials();
  if (signedIn) {
    credentials.write('fishfm/qq', 'uin=o1234; qqmusic_key=secret');
    store.setCredentialReference({
      provider: 'qq', accountId: '1234', credentialRef: 'fishfm/qq', state: 'authorized', updatedAt: 1,
    });
  }
  const transport = fakeTransport(table, { fail });
  const provider = createQQProvider({ transport, credentials, store, now: () => 1_700_000_000_000 });
  return {
    store, transport, credentials, provider,
    close: () => store.close(),
    hasCredential: () => Boolean(credentials.read('fishfm/qq')),
  };
}

test('the QQ adapter passes the same shared contract checks as NetEase', async () => {
  const context = setup({
    signedIn: true,
    table: {
      accountInfo: { uin: 1234 },
      recentTracks: { data: { list: [qqSong('mid-1')] } },
      resolve: { data: { purl: 'https://example.invalid/qq.mp3', expiresIn: 600 } },
    },
  });
  try {
    const report = await runProviderConformance({
      provider: context.provider,
      name: 'qq',
      fixture: { store: context.store, hasCredential: context.hasCredential, track: { provider: 'qq', providerTrackId: 'mid-1' } },
    });
    assert.equal(report.failed, 0, `QQ conformance failures: ${JSON.stringify(report.results.filter((row) => !row.ok))}`);
    assert.ok(report.passed >= 5, `expected most checks to run, got ${report.passed}`);
  } finally {
    context.close();
  }
});

test('one conformance run covers both platforms, which is why they cannot drift', async () => {
  const qq = setup({
    signedIn: true,
    table: {
      accountInfo: { uin: 1234 },
      recentTracks: { data: { list: [qqSong('mid-1')] } },
      resolve: { data: { purl: 'https://example.invalid/qq.mp3', expiresIn: 600 } },
    },
  });
  const neteaseCredentials = fakeCredentials({ 'fishfm/netease': 'MUSIC_U=secret' });
  const neteaseStore = new MusicStore();
  neteaseStore.setCredentialReference({
    provider: 'netease', accountId: '42', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: 1,
  });
  const neteaseTransport = fakeTransport({
    accountInfo: { accountId: 42 },
    recentTracks: { data: { list: [{ id: 1, name: 'N', ar: [{ name: 'A' }], dt: 1000 }] } },
    resolve: { data: [{ url: 'https://example.invalid/ne.mp3', expi: 600 }] },
  });
  const netease = createNetEaseProvider({
    transport: neteaseTransport,
    communityApi: {
      login_status: () => neteaseTransport.request({ role: 'accountInfo', params: {} }),
      user_record: ({ uid, type }) => neteaseTransport.request({ role: 'recentTracks', params: { uid, type } }),
    },
    credentials: neteaseCredentials,
    store: neteaseStore,
    now: () => 1_700_000_000_000,
  });
  try {
    const reports = await Promise.all([
      runProviderConformance({
        provider: qq.provider, name: 'qq',
        fixture: { store: qq.store, hasCredential: qq.hasCredential, track: { provider: 'qq', providerTrackId: 'mid-1' } },
      }),
      runProviderConformance({
        provider: netease, name: 'netease',
        fixture: {
          store: neteaseStore,
          hasCredential: () => Boolean(neteaseCredentials.read('fishfm/netease')),
          track: { provider: 'netease', providerTrackId: '1' },
        },
      }),
    ]);
    for (const report of reports) assert.equal(report.failed, 0, `${report.name}: ${JSON.stringify(report.results.filter((row) => !row.ok))}`);
    // Identical check titles: the platforms are held to the same list.
    assert.deepEqual(
      reports[0].results.map((row) => row.title),
      reports[1].results.map((row) => row.title),
    );
  } finally {
    qq.close();
    neteaseStore.close();
  }
});

test("QQ's recent list failing degrades the source instead of dropping QQ", async () => {
  const context = setup({
    signedIn: true,
    fail: { recentTracks: Object.assign(new Error('the recent endpoint moved'), { status: 404 }) },
    table: { likedTracks: { data: { list: [qqSong('mid-7'), qqSong('mid-8')] } } },
  });
  try {
    const result = await context.provider.getSeedTracks({ limit: 300 });
    assert.equal(result.source, 'liked', 'QQ still works, from a different source');
    assert.equal(result.degraded, true);
    assert.equal(result.imported, 2, 'the real count is reported');
    assert.equal(result.requested, 300);
    assert.match(result.reason, /Recent listening was unavailable/);
    assert.deepEqual(result.attempts.map((row) => row.source), ['recent', 'liked']);
    assert.equal(context.provider.getAccount().status, 'authorized', 'QQ support is not withdrawn for this');

    const seed = context.provider.getCapabilities().seed;
    assert.equal(seed.status, 'degraded');
    assert.equal(seed.source, 'liked');
    assert.notEqual(seed.source, 'recent', 'a fallback must never be labelled as the preferred source');
  } finally {
    context.close();
  }
});

test('QQ falls back as far as a playlist, and reports every attempt when nothing works', async () => {
  const working = setup({
    signedIn: true,
    fail: {
      recentTracks: Object.assign(new Error('gone'), { status: 404 }),
      likedTracks: Object.assign(new Error('gone'), { status: 500 }),
    },
    table: {
      playlists: { data: { list: [{ dissid: 99 }] } },
      playlistTracks: ({ params }) => ({ data: { list: params.disstid === 99 ? [qqSong('mid-99')] : [] } }),
    },
  });
  try {
    const result = await working.provider.getSeedTracks({ limit: 50 });
    assert.equal(result.source, 'playlist');
    assert.equal(result.imported, 1);
    assert.deepEqual(result.attempts.map((row) => row.ok), [false, false, true]);
    // The second step really used the id discovered by the first.
    assert.equal(working.transport.calls.at(-1).params.disstid, 99);
  } finally {
    working.close();
  }

  const broken = setup({
    signedIn: true,
    fail: {
      recentTracks: Object.assign(new Error('gone'), { status: 404 }),
      likedTracks: Object.assign(new Error('gone'), { status: 500 }),
      playlists: Object.assign(new Error('gone'), { status: 500 }),
    },
  });
  try {
    await assert.rejects(
      () => broken.provider.getSeedTracks({ limit: 50 }),
      (error) => {
        assert.equal(error.code, 'provider_failure');
        assert.equal(error.details.attempts.length, 3, 'all three sources are on the record');
        assert.match(error.message, /No QQ Music seed source was usable/);
        return true;
      },
    );
    // The failure is visible rather than reported as "no import has run yet".
    assert.equal(broken.provider.getCapabilities().seed.status, 'unavailable');
  } finally {
    broken.close();
  }
});

test('QQ ids are songmid, and a title-only entry cannot become a track', async () => {
  const context = setup({
    signedIn: true,
    table: { search: { data: { list: [qqSong('mid-a'), qqSong('mid-a'), { title: 'no id here' }] } } },
  });
  try {
    const result = await context.provider.search('anything');
    assert.deepEqual(result.tracks.map((track) => track.providerTrackId), ['mid-a'], 'dedup by songmid');
    assert.equal(result.tracks[0].provider, 'qq');
    assert.equal(result.tracks[0].title, 'Song mid-a');
    assert.equal(result.tracks[0].artist, 'QQ Artist');
    assert.equal(result.tracks[0].durationMs, 200_000);
  } finally {
    context.close();
  }
});

test('resolve sends the songmid and reports a time-limited key as expiring', async () => {
  const context = setup({
    signedIn: true,
    table: { resolve: { data: { purl: 'https://example.invalid/qq-key.mp3', expiresIn: 600 } } },
  });
  try {
    const resource = await context.provider.resolve({ provider: 'qq', providerTrackId: 'mid-5' }, { version: 3 });
    assert.equal(resource.handle, 'https://example.invalid/qq-key.mp3');
    assert.equal(resource.expiresAt, 1_700_000_000_000 + 600_000, 'a purl expiry is tracked');
    assert.equal(resource.version, 3);
    assert.equal(context.transport.calls.at(-1).params.songmid, 'mid-5');

    const dump = JSON.stringify({
      references: context.store.db.prepare('SELECT * FROM credential_references').all(),
      state: context.store.getCoreState(),
    });
    assert.equal(dump.includes('example.invalid'), false, 'the handle must not be persisted');
  } finally {
    context.close();
  }
});

test('a signed-out QQ adapter refuses everything and sends nothing', async () => {
  const context = setup();
  try {
    assert.equal(context.provider.getAccount().status, 'login_required');
    await assert.rejects(() => context.provider.search('q'), { code: 'login_required' });
    await assert.rejects(() => context.provider.getSeedTracks({}), { code: 'login_required' });
    await assert.rejects(() => context.provider.resolve({ provider: 'qq', providerTrackId: 'mid-1' }, {}), { code: 'login_required' });
    assert.equal(context.transport.calls.length, 0);

    const capabilities = context.provider.getCapabilities();
    assert.equal(capabilities.account.status, 'login_required');
    assert.equal(capabilities.recommendation.status, 'login_required');
  } finally {
    context.close();
  }
});

test('QQ sign-in keeps session material out of SQLite, like NetEase', async () => {
  const context = setup({
    table: {
      loginQr: { data: { qrsig: 'qr-sig-1', qrUrl: 'https://example.invalid/qq-qr' } },
      loginPoll: { data: { code: 0, cookie: 'uin=o1234; qqmusic_key=top-secret', uin: '1234' } },
    },
  });
  try {
    const started = await context.provider.beginLogin();
    assert.equal(started.key, 'qr-sig-1');
    assert.equal(context.provider.getAccount().pending, true);

    const done = await context.provider.pollLogin();
    assert.equal(done.status, 'authorized');
    assert.equal(context.credentials.read('fishfm/qq'), 'uin=o1234; qqmusic_key=top-secret');

    const dump = JSON.stringify(context.store.db.prepare('SELECT * FROM credential_references').all());
    assert.equal(dump.includes('top-secret'), false, 'the session must stay out of SQLite');
    assert.equal(context.store.getCredentialReference('qq').credential_ref, 'fishfm/qq');
  } finally {
    context.close();
  }
});

test('the platform configuration states its sources and unverified roles', () => {
  assert.deepEqual([...QQ_SEED_ORDER], ['recent', 'liked', 'playlist']);
  // Every role the adapter calls must be declared, so nothing is hidden.
  const context = setup({ signedIn: true, table: { accountInfo: { uin: 1 }, recentTracks: { data: { list: [] } }, resolve: { data: {} } } });
  try {
    for (const role of ['loginQr', 'loginPoll', 'accountInfo', 'recentTracks', 'likedTracks', 'playlists', 'playlistTracks', 'search', 'resolve']) {
      assert.ok(QQ_ROLES.includes(role), `${role} must be a declared role`);
    }
    assert.equal(new Set(QQ_ROLES).size, QQ_ROLES.length, 'no role is listed twice');
    assert.deepEqual([...QQ_ROLES], [...QQ_ROLES], 'the declared order is stable');
    assert.equal(QQ_ROLES[0], 'loginQr', 'sign-in roles come first in the declaration');
  } finally {
    context.close();
  }
});
