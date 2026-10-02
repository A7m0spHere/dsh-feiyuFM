// Verifies the v1 -> v2 upgrade on a database created by the previous schema,
// which is the path a real installation takes. Creates a v1-shaped file with
// the original migration, then opens it with the current store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicStore } from '../src/storage.mjs';

const V1 = `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE core_state (id INTEGER PRIMARY KEY CHECK (id = 1), value_json TEXT NOT NULL);
CREATE TABLE constraints (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, track_key TEXT,
  expires_at INTEGER, created_at INTEGER NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE credential_references (
  provider TEXT PRIMARY KEY, account_id TEXT, credential_ref TEXT NOT NULL,
  state TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE listen_history (
  play_instance_id TEXT PRIMARY KEY, track_key TEXT NOT NULL,
  selected_by TEXT NOT NULL, progress_source TEXT NOT NULL,
  effective_ms INTEGER NOT NULL, agent_listening INTEGER NOT NULL,
  audible INTEGER NOT NULL,
  end_reason TEXT NOT NULL, ended_at INTEGER NOT NULL
);
CREATE TABLE track_stats (
  track_key TEXT PRIMARY KEY, play_count INTEGER NOT NULL DEFAULT 0,
  effective_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE processed_commands (command_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL);
`;

test('an existing version 1 database upgrades to the current version without losing data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-migrate-'));
  const path = join(directory, 'legacy.sqlite');
  try {
    // Build a genuine v1 file with the old schema and some history in it.
    const legacy = new DatabaseSync(path);
    legacy.exec(V1);
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, '2026-09-01T00:00:00.000Z');
    legacy.exec('PRAGMA user_version = 1');
    legacy.prepare('INSERT INTO settings VALUES (?, ?)').run('window', JSON.stringify({ x: 10, y: 20 }));
    legacy.prepare('INSERT INTO listen_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('inst-1', 'netease:1', 'user', 'audio', 4200, 1, 1, 'ended', 1700000000000);
    legacy.prepare('INSERT INTO track_stats VALUES (?, ?, ?)').run('netease:1', 1, 4200);
    legacy.prepare('INSERT INTO credential_references VALUES (?, ?, ?, ?, ?)')
      .run('netease', 'acct', 'fishfm/netease', 'authorized', 1700000000000);
    legacy.close();

    const store = new MusicStore(path);
    try {
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 4, 'all migrations applied');
      // Old data is intact.
      assert.deepEqual(store.getSetting('window'), { x: 10, y: 20 });
      assert.equal(store.getHistory('inst-1').effective_ms, 4200);
      assert.equal(store.getTrackStats({ provider: 'netease', providerTrackId: '1' }).play_count, 1);
      assert.equal(store.getCredentialReference('netease').credential_ref, 'fishfm/netease');
      // New tables are usable right away.
      assert.equal(store.countEnvironment(), 0);
      assert.equal(store.countPreferences(), 0);
      assert.deepEqual(
        store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
        [1, 2, 3, 4],
      );
    } finally {
      store.close();
    }

    // Reopening is idempotent: no second migration, no error.
    const again = new MusicStore(path);
    try {
      assert.equal(again.db.prepare('PRAGMA user_version').get().user_version, 4);
      assert.deepEqual(
        again.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
        [1, 2, 3, 4],
      );
    } finally {
      again.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a version 2 database gains session attribution without losing history', () => {
  // Migration 3 adds a column to listen_history, which is the risky kind: prove
  // existing rows survive and simply have no session attached.
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-migrate-v3-'));
  const path = join(directory, 'v2.sqlite');
  try {
    // Build a genuine v2 database: v1 schema plus migration 2's tables.
    const legacy = new DatabaseSync(path);
    legacy.exec(V1);
    legacy.exec(`
      CREATE TABLE tracks (track_key TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_track_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', duration_ms INTEGER, updated_at INTEGER NOT NULL);
      CREATE TABLE user_environment (track_key TEXT PRIMARY KEY, provider TEXT NOT NULL, source TEXT NOT NULL,
        batch_id TEXT, play_count INTEGER, last_played_at INTEGER, added_at INTEGER NOT NULL);
      CREATE TABLE agent_preferences (target_type TEXT NOT NULL, target_key TEXT NOT NULL, affinity REAL NOT NULL,
        source TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (target_type, target_key));
    `);
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, 'x');
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(2, 'x');
    legacy.exec('PRAGMA user_version = 2');
    legacy.prepare('INSERT INTO listen_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old-1', 'netease:9', 'agent', 'audio', 5000, 1, 1, 'ended', 1700000000000);
    legacy.prepare('INSERT INTO agent_preferences VALUES (?, ?, ?, ?, ?)')
      .run('track', 'netease:9', 0.77, 'listen', 1700000000000);
    legacy.close();

    const store = new MusicStore(path);
    try {
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 4);
      // The pre-existing listen survived, with no session attached.
      const row = store.getHistory('old-1');
      assert.equal(row.effective_ms, 5000);
      assert.equal(row.session_id, null, 'an old listen has no session, and that is honest');
      assert.equal(store.getPreference('track', 'netease:9').affinity, 0.77, 'preferences are untouched');
      // The new capability works on the upgraded database.
      store.recordHistory({
        playInstanceId: 'new-1', track: { provider: 'netease', providerTrackId: '9' },
        selectedBy: 'agent', progressSource: 'audio', effectiveMs: 4000,
        agentListening: true, audible: true, endReason: 'ended', endedAt: 1700000001000, sessionId: 'sess-a',
      });
      assert.equal(store.countSessionListens('sess-a', { provider: 'netease', providerTrackId: '9' }), 1);
      assert.equal(store.countSessionListens('sess-b', { provider: 'netease', providerTrackId: '9' }), 0);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unknown newer schema version is refused instead of being run blindly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-migrate-future-'));
  const path = join(directory, 'future.sqlite');
  try {
    const future = new DatabaseSync(path);
    future.exec(V1);
    future.exec('PRAGMA user_version = 99');
    future.close();
    assert.throws(() => new MusicStore(path), /Unsupported schema version 99/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
