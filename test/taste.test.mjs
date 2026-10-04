// T1: the user's environment and the agent's own personality.
//
// The properties that matter here are honesty (real sources and counts, unknown
// metadata stays unknown), separation (an import never rewrites preferences and
// a preference never rewrites the environment) and stability (a restart does not
// reshuffle the personality).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicStore } from '../src/storage.mjs';
import {
  importSeedTracks, describeEnvironment, SEED_SOURCES, SOURCE_LABELS,
  DEFAULT_IMPORT_REQUEST, COMFORTABLE_IMPORT_MINIMUM,
} from '../src/environment.mjs';
import {
  initializeAgentPreferences, describeTaste, createRng, normalizeSeed,
  readAgentSeed, getAffinity, SEED_PARAMETERS,
} from '../src/taste.mjs';

const netease = (id, extra = {}) => ({ provider: 'netease', providerTrackId: id, title: `N${id}`, artist: 'Artist A', ...extra });
const qq = (id, extra = {}) => ({ provider: 'qq', providerTrackId: id, title: `Q${id}`, artist: 'Artist B', ...extra });

test('an import records its real source, the requested and the imported counts', () => {
  const store = new MusicStore();
  try {
    const result = importSeedTracks({
      store, provider: 'netease', source: 'liked',
      tracks: [netease('1'), netease('2'), netease('3')],
      requested: DEFAULT_IMPORT_REQUEST,
    });

    assert.equal(result.source, 'liked');
    assert.equal(result.requested, DEFAULT_IMPORT_REQUEST);
    assert.equal(result.imported, 3);
    assert.equal(result.total, 3);
    assert.equal(result.degraded, true, 'a short import must be flagged, not padded');
    assert.match(result.reason, /请求 300 首，来源实际返回 3 首/);
    assert.equal(result.sufficient, false, `3 tracks is below ${COMFORTABLE_IMPORT_MINIMUM}`);

    const batch = store.getImportBatch(result.batchId);
    assert.equal(batch.source, 'liked');
    assert.equal(batch.imported, 3);
    assert.equal(batch.requested, DEFAULT_IMPORT_REQUEST);
    assert.equal(batch.degraded, 1);
  } finally {
    store.close();
  }
});

test('a favourite or playlist is never relabelled as recently played', () => {
  const store = new MusicStore();
  try {
    importSeedTracks({ store, provider: 'netease', source: 'playlist', tracks: [netease('7')], requested: 1 });
    const entry = store.getEnvironmentEntry(netease('7'));
    assert.equal(entry.source, 'playlist');
    assert.notEqual(entry.source, 'recent');

    // A later import must not rewrite where the track came from.
    importSeedTracks({ store, provider: 'netease', source: 'recent', tracks: [netease('7')], requested: 1 });
    assert.equal(store.getEnvironmentEntry(netease('7')).source, 'playlist',
      'an existing environment row keeps its original source');

    assert.equal(SOURCE_LABELS.playlist, '用户歌单');
    assert.equal(SOURCE_LABELS.recent, '近期播放');
    assert.throws(() => importSeedTracks({ store, provider: 'netease', source: 'guess', tracks: [] }), /Unknown import source/);
    assert.deepEqual([...SEED_SOURCES], ['recent', 'liked', 'playlist', 'plugin_history']);
  } finally {
    store.close();
  }
});

test('dedup is by platform id only, and two platforms are never merged by title', () => {
  const store = new MusicStore();
  try {
    const sameId = importSeedTracks({
      store, provider: 'netease', source: 'recent', requested: 10,
      tracks: [netease('5'), netease('5'), netease('5', { title: 'Same id again' })],
    });
    assert.equal(sameId.imported, 1);
    assert.equal(sameId.duplicates, 2);
    assert.equal(sameId.total, 1);

    // Identical titles on different platforms stay separate rows.
    importSeedTracks({ store, provider: 'qq', source: 'recent', requested: 10, tracks: [qq('5', { title: 'N5' })] });
    assert.equal(store.countEnvironment(), 2);
    assert.equal(store.countEnvironment('netease'), 1);
    assert.equal(store.countEnvironment('qq'), 1);
    assert.notEqual(store.getEnvironmentEntry(netease('5')).track_key, store.getEnvironmentEntry(qq('5')).track_key);

    // Re-importing the same id from the other platform's batch is a duplicate.
    const again = importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 10, tracks: [netease('5')] });
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 1);
  } finally {
    store.close();
  }
});

test('unknown metadata stays unknown instead of becoming zero', () => {
  const store = new MusicStore();
  try {
    importSeedTracks({
      store, provider: 'netease', source: 'playlist', requested: 2,
      tracks: [netease('1'), netease('2', { playCount: 12, lastPlayedAt: 1700000000000 })],
    });
    const unknown = store.getEnvironmentEntry(netease('1'));
    assert.equal(unknown.play_count, null, 'a missing play count must stay NULL');
    assert.equal(unknown.last_played_at, null, 'a missing date must stay NULL');
    const known = store.getEnvironmentEntry(netease('2'));
    assert.equal(known.play_count, 12);
    assert.equal(known.last_played_at, 1700000000000);

    // A later import without the metadata must not erase what is known.
    importSeedTracks({ store, provider: 'netease', source: 'playlist', requested: 2, tracks: [netease('2')] });
    assert.equal(store.getEnvironmentEntry(netease('2')).play_count, 12);

    const summary = describeEnvironment(store);
    assert.equal(summary.total, 2);
    assert.equal(summary.knownPlayCounts, 1);
    assert.equal(summary.knownDates, 1);
    assert.equal(summary.bySource.playlist.count, 2);
    assert.equal(summary.bySource.playlist.label, '用户歌单');
    assert.equal(summary.batches.length, 2);
  } finally {
    store.close();
  }
});

test('an import must not carry tracks from another platform', () => {
  const store = new MusicStore();
  try {
    assert.throws(
      () => importSeedTracks({ store, provider: 'netease', source: 'recent', tracks: [qq('1')] }),
      /received a qq track/,
    );
    assert.equal(store.countEnvironment(), 0, 'a rejected import must not leave rows behind');
    assert.equal(store.listImportBatches().length, 0, 'nor a batch record');
  } finally {
    store.close();
  }
});

test('the same seed over the same environment reproduces the same personality', () => {
  const first = new MusicStore();
  const second = new MusicStore();
  try {
    for (const store of [first, second]) {
      importSeedTracks({
        store, provider: 'netease', source: 'recent', requested: 5,
        tracks: [netease('3'), netease('1'), netease('2')],
      });
      importSeedTracks({ store, provider: 'qq', source: 'liked', requested: 2, tracks: [qq('9')] });
    }
    // Imported in different orders on purpose: the result must not depend on it.
    const a = initializeAgentPreferences({ store: first, seed: 20260927, now: 1 });
    const b = initializeAgentPreferences({ store: second, seed: 20260927, now: 1 });

    assert.equal(a.created, b.created);
    assert.ok(a.created > 0);
    const preferencesA = first.listPreferences().map((row) => [row.target_type, row.target_key, row.affinity]);
    const preferencesB = second.listPreferences().map((row) => [row.target_type, row.target_key, row.affinity]);
    assert.deepEqual(preferencesA, preferencesB, 'a fixed seed must reproduce identical affinities');

    // A string seed is accepted and hashed stably.
    assert.equal(normalizeSeed('fishfm'), normalizeSeed('fishfm'));
    assert.notEqual(normalizeSeed('fishfm'), normalizeSeed('fishfm2'));
  } finally {
    first.close();
    second.close();
  }
});

test('preferences are bounded, biased by source and never copied from the user', () => {
  const store = new MusicStore();
  try {
    importSeedTracks({ store, provider: 'netease', source: 'liked', requested: 1, tracks: [netease('1', { playCount: 99 })] });
    importSeedTracks({ store, provider: 'netease', source: 'playlist', requested: 1, tracks: [netease('2', { playCount: 1 })] });
    const result = initializeAgentPreferences({ store, seed: 7, now: 5 });
    assert.equal(result.tracks, 2);
    assert.equal(result.artists, 1, 'Artist A appears on both tracks');

    for (const row of store.listPreferences()) {
      assert.ok(row.affinity >= SEED_PARAMETERS.min && row.affinity <= SEED_PARAMETERS.max,
        `${row.target_key} affinity ${row.affinity} escaped the bounds`);
      assert.equal(row.source, 'seed', 'initialization must be labelled as seed, not as user feedback');
    }

    // A high user play count must not become a high agent affinity: the liked
    // track is only slightly biased, and both stay near the base.
    const liked = store.getPreference('track', 'netease:1');
    const playlist = store.getPreference('track', 'netease:2');
    assert.ok(Math.abs(liked.affinity - SEED_PARAMETERS.base) <= SEED_PARAMETERS.jitter + SEED_PARAMETERS.sourceBias.liked + 1e-9);
    assert.ok(Math.abs(playlist.affinity - SEED_PARAMETERS.base) <= SEED_PARAMETERS.jitter + 1e-9);
    assert.notEqual(liked.affinity, 99);

    const artist = store.getPreference('artist', 'Artist A');
    assert.ok(artist.affinity >= SEED_PARAMETERS.min && artist.affinity <= SEED_PARAMETERS.max);

    const summary = describeTaste(store);
    assert.equal(summary.seed, 7);
    assert.equal(summary.tracks, 2);
    assert.equal(summary.artists, 1);
    assert.ok(summary.mean > 0 && summary.mean < 1);
    assert.equal(getAffinity(store, { targetType: 'track', targetKey: 'netease:1' }), liked.affinity);
  } finally {
    store.close();
  }
});

test('a restart keeps the same personality instead of reshuffling it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-taste-'));
  const path = join(directory, 'taste.sqlite');
  try {
    const first = new MusicStore(path);
    importSeedTracks({
      store: first, provider: 'netease', source: 'recent', requested: 4,
      tracks: [netease('1'), netease('2'), netease('3')],
    });
    const created = initializeAgentPreferences({ store: first, seed: null, now: 10 });
    // seed: null means "pick one and remember it".
    assert.ok(Number.isSafeInteger(created.seed));
    const before = first.listPreferences().map((row) => [row.target_key, row.affinity]);
    first.close();

    const second = new MusicStore(path);
    const again = initializeAgentPreferences({ store: second, seed: 999, now: 20 });
    assert.equal(again.initialized, false, 'existing preferences must not be regenerated');
    assert.equal(again.seed, created.seed, 'the stored seed wins over a newly supplied one');
    const after = second.listPreferences().map((row) => [row.target_key, row.affinity]);
    assert.deepEqual(after, before, 'a restart must not change a single affinity');
    assert.equal(readAgentSeed(second), created.seed);
    assert.equal(second.countEnvironment('netease'), 3, 'the environment survives the restart too');
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the seeded generator is deterministic and the schema is at the current version', () => {
  const rng = createRng(42);
  const second = createRng(42);
  const values = [rng(), rng(), rng()];
  assert.deepEqual(values, [second(), second(), second()]);
  assert.ok(values.every((value) => value >= 0 && value < 1));

  const store = new MusicStore();
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 11);
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    for (const table of ['tracks', 'seed_imports', 'user_environment', 'agent_preferences']) {
      assert.ok(tables.includes(table), `${table} must exist after migration 2`);
    }
    const migrations = store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
    assert.deepEqual(migrations, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Migration 1 data must still be reachable.
    assert.equal(store.getSetting('missing', 'fallback'), 'fallback');
  } finally {
    store.close();
  }
});

test('an empty environment initializes an empty, honest taste', () => {
  const store = new MusicStore();
  try {
    const result = initializeAgentPreferences({ store, seed: 5 });
    assert.equal(result.created, 0);
    assert.equal(result.tracks, 0);
    assert.equal(store.countPreferences(), 0);
    const summary = describeTaste(store);
    assert.equal(summary.total, 0);
    assert.equal(summary.seed, 5, 'the seed is remembered even before there is anything to like');
  } finally {
    store.close();
  }
});
