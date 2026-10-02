import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { trackId } from './contracts.mjs';

const MIGRATION_1 = `
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

// T1: the user's music environment and the agent's own preferences are kept in
// separate tables on purpose. An import describes where the user's music came
// from; a preference describes what the agent has grown to like, and neither is
// allowed to overwrite the other. Missing metadata stays NULL rather than being
// filled with a zero, because "unknown" and "zero plays" are different facts.
const MIGRATION_2 = `
CREATE TABLE tracks (
  track_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_track_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE seed_imports (
  batch_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source TEXT NOT NULL,
  requested INTEGER NOT NULL,
  imported INTEGER NOT NULL,
  duplicates INTEGER NOT NULL DEFAULT 0,
  degraded INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE user_environment (
  track_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source TEXT NOT NULL,
  batch_id TEXT,
  play_count INTEGER,
  last_played_at INTEGER,
  added_at INTEGER NOT NULL
);
CREATE TABLE agent_preferences (
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  affinity REAL NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_key)
);
CREATE INDEX user_environment_provider ON user_environment (provider);
CREATE INDEX seed_imports_provider ON seed_imports (provider, created_at);
`;

// T3/A06: which session a listen belonged to. A transient session's influence on
// long-term preferences has to be bounded, and that requires knowing where a
// listen came from. Nullable: a listen with no session context keeps full weight.
const MIGRATION_3 = `
ALTER TABLE listen_history ADD COLUMN session_id TEXT;
CREATE INDEX listen_history_session ON listen_history (session_id, track_key);
CREATE TABLE session_influence (
  session_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, track_key)
);
`;

const MIGRATION_4 = `
ALTER TABLE listen_history ADD COLUMN agent_effective_ms INTEGER;
ALTER TABLE listen_history ADD COLUMN audible_ms INTEGER;
ALTER TABLE listen_history ADD COLUMN progress_accounting TEXT NOT NULL DEFAULT 'legacy-position';
CREATE TABLE growth_jobs (play_instance_id TEXT PRIMARY KEY, entry_json TEXT NOT NULL, processed_at INTEGER, result_json TEXT);
CREATE TABLE track_availability (track_key TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;

export class MusicStore {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 2000 });
    this.db.exec('PRAGMA foreign_keys = ON');
    try {
      this.migrate();
    } catch (error) {
      // A refused schema must not leave the database file locked behind us.
      try { this.db.close(); } catch { /* already gone */ }
      throw error;
    }
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 4) throw new Error(`Unsupported schema version ${version}`);
    if (version === 0) {
      this.transaction(() => {
        this.db.exec(MIGRATION_1);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, new Date().toISOString());
        this.db.exec('PRAGMA user_version = 1');
      });
    }
    if (this.db.prepare('PRAGMA user_version').get().user_version === 1) {
      this.transaction(() => {
        this.db.exec(MIGRATION_2);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(2, new Date().toISOString());
        this.db.exec('PRAGMA user_version = 2');
      });
    }
    if (this.db.prepare('PRAGMA user_version').get().user_version === 2) {
      this.transaction(() => {
        this.db.exec(MIGRATION_3);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(3, new Date().toISOString());
        this.db.exec('PRAGMA user_version = 3');
      });
    }
    if (this.db.prepare('PRAGMA user_version').get().user_version === 3) {
      this.transaction(() => {
        this.db.exec(MIGRATION_4);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(4, new Date().toISOString());
        this.db.exec('PRAGMA user_version = 4');
      });
    }
  }

  transaction(fn) {
    const nested = this.transactionDepth > 0;
    const savepoint = `fishfm_${this.transactionDepth ?? 0}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.transactionDepth = (this.transactionDepth ?? 0) + 1;
    try {
      const result = fn();
      this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
      if (nested) this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  close() { this.db.close(); }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value_json) : fallback;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json')
      .run(key, JSON.stringify(value));
  }

  /** Removing a setting is a real operation: absent and "set to null" differ. */
  removeSetting(key) {
    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return result.changes > 0;
  }

  getCoreState() {
    const row = this.db.prepare('SELECT value_json FROM core_state WHERE id = 1').get();
    return row ? JSON.parse(row.value_json) : null;
  }

  setCoreState(value) {
    this.db.prepare('INSERT INTO core_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json')
      .run(JSON.stringify(value));
  }

  addConstraint({ id, kind, track = null, expiresAt = null, createdAt, summary = '' }) {
    this.db.prepare('INSERT OR REPLACE INTO constraints VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, track ? trackId(track) : null, expiresAt, createdAt, summary);
  }

  removeConstraint(id) {
    this.db.prepare('DELETE FROM constraints WHERE id = ?').run(id);
  }

  activeConstraints(now) {
    return this.db.prepare('SELECT * FROM constraints WHERE expires_at IS NULL OR expires_at > ?').all(now);
  }

  setCredentialReference({ provider, accountId = null, credentialRef, state, updatedAt }) {
    if (!credentialRef || /[\r\n]/.test(credentialRef)) throw new Error('Credential reference required');
    this.db.prepare(`INSERT INTO credential_references VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET account_id=excluded.account_id,
      credential_ref=excluded.credential_ref, state=excluded.state, updated_at=excluded.updated_at`)
      .run(provider, accountId, credentialRef, state, updatedAt);
  }

  getCredentialReference(provider) {
    return this.db.prepare('SELECT * FROM credential_references WHERE provider = ?').get(provider) ?? null;
  }

  removeCredentialReference(provider) {
    this.db.prepare('DELETE FROM credential_references WHERE provider = ?').run(provider);
  }

  hasCommand(commandId) {
    return Boolean(this.db.prepare('SELECT 1 FROM processed_commands WHERE command_id = ?').get(commandId));
  }

  recordCommand(commandId, now) {
    this.db.prepare('INSERT INTO processed_commands VALUES (?, ?)').run(commandId, now);
  }

  recordHistory(entry) {
    return this.transaction(() => {
      const result = this.db.prepare(`INSERT OR IGNORE INTO listen_history
        (play_instance_id, track_key, selected_by, progress_source, effective_ms,
         agent_listening, audible, end_reason, ended_at, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        entry.playInstanceId, trackId(entry.track), entry.selectedBy,
        entry.progressSource, entry.effectiveMs, Number(entry.agentListening), Number(entry.audible),
        entry.endReason, entry.endedAt, entry.sessionId ?? null);
      if (result.changes === 0) return false;
      this.db.prepare('UPDATE listen_history SET agent_effective_ms=?, audible_ms=?, progress_accounting=? WHERE play_instance_id=?')
        .run(entry.agentEffectiveMs ?? null, entry.audibleMs ?? null, entry.progressAccounting ?? 'legacy-position', entry.playInstanceId);
      this.db.prepare('INSERT OR IGNORE INTO growth_jobs (play_instance_id, entry_json) VALUES (?, ?)')
        .run(entry.playInstanceId, JSON.stringify(entry));
      this.db.prepare(`INSERT INTO track_stats (track_key, play_count, effective_ms) VALUES (?, ?, ?)
        ON CONFLICT(track_key) DO UPDATE SET play_count=play_count+excluded.play_count,
        effective_ms=effective_ms+excluded.effective_ms`)
        .run(trackId(entry.track), entry.endReason === 'ended' && entry.effectiveMs > 0 ? 1 : 0, entry.effectiveMs);
      return true;
    });
  }

  /** How many listens a session has already contributed to one track. */
  countSessionListens(sessionId, track) {
    if (!sessionId) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM listen_history WHERE session_id = ? AND track_key = ?')
      .get(sessionId, trackId(track));
    return row?.count ?? 0;
  }

  /**
   * How much a session has already changed one track's preference.
   *
   * Growth counts its own applications rather than inferring them from history,
   * so the ceiling holds no matter who called it and survives a restart.
   */
  getSessionInfluence(sessionId, track) {
    if (!sessionId) return 0;
    const row = this.db.prepare('SELECT applied FROM session_influence WHERE session_id = ? AND track_key = ?')
      .get(sessionId, trackId(track));
    return row?.applied ?? 0;
  }

  bumpSessionInfluence(sessionId, track, now) {
    if (!sessionId) return 0;
    const row = this.db.prepare(`INSERT INTO session_influence (session_id, track_key, applied, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(session_id, track_key) DO UPDATE SET applied = applied + 1, updated_at = excluded.updated_at
      RETURNING applied`).get(sessionId, trackId(track), now);
    return row?.applied ?? 1;
  }

  getHistory(playInstanceId) {
    return this.db.prepare('SELECT * FROM listen_history WHERE play_instance_id = ?').get(playInstanceId) ?? null;
  }

  pendingGrowthEntries({ limit = 100 } = {}) {
    return this.db.prepare('SELECT entry_json FROM growth_jobs WHERE processed_at IS NULL ORDER BY rowid LIMIT ?').all(limit).map(row => JSON.parse(row.entry_json));
  }

  getGrowthResult(id) {
    const row = this.db.prepare('SELECT result_json FROM growth_jobs WHERE play_instance_id=? AND processed_at IS NOT NULL').get(id);
    return row ? JSON.parse(row.result_json) : null;
  }

  completeGrowth(entry, result, now) {
    this.db.prepare(`INSERT INTO growth_jobs (play_instance_id, entry_json, processed_at, result_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(play_instance_id) DO UPDATE SET processed_at=excluded.processed_at, result_json=excluded.result_json`)
      .run(entry.playInstanceId, JSON.stringify(entry), now, JSON.stringify(result));
  }

  markUnavailable(track, code, expiresAt) {
    this.db.prepare('INSERT OR REPLACE INTO track_availability VALUES (?, ?, ?)').run(trackId(track), code, expiresAt);
  }

  isTrackAvailable(track, now) {
    return !this.db.prepare('SELECT 1 FROM track_availability WHERE track_key=? AND expires_at>?').get(trackId(track), now);
  }

  hasEffectiveListen(track) {
    return Boolean(this.db.prepare(`SELECT 1 FROM listen_history h LEFT JOIN tracks t USING(track_key)
      WHERE h.track_key=? AND h.end_reason IN ('ended','skipped')
      AND h.effective_ms >= MIN(30000, COALESCE(t.duration_ms / 2.0, 30000)) LIMIT 1`).get(trackId(track)));
  }

  listAgentKnownTracks() {
    return this.db.prepare(`SELECT DISTINCT t.* FROM tracks t JOIN listen_history h USING(track_key)
      WHERE h.selected_by='agent' AND h.agent_listening=1 AND h.end_reason IN ('ended','skipped')
      AND COALESCE(h.agent_effective_ms, h.effective_ms) >= MIN(30000, COALESCE(t.duration_ms / 2.0, 30000))
      ORDER BY t.track_key`).all();
  }

  getTrackStats(track) {
    return this.db.prepare('SELECT * FROM track_stats WHERE track_key = ?').get(trackId(track)) ?? null;
  }

  // ---- T1: user environment, import batches and agent preferences ----

  upsertTrack(track, now) {
    const key = trackId(track);
    this.db.prepare(`INSERT INTO tracks (track_key, provider, provider_track_id, title, artist, duration_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_key) DO UPDATE SET
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE tracks.title END,
        artist = CASE WHEN excluded.artist <> '' THEN excluded.artist ELSE tracks.artist END,
        duration_ms = COALESCE(excluded.duration_ms, tracks.duration_ms),
        updated_at = excluded.updated_at`)
      .run(key, track.provider, track.providerTrackId,
        typeof track.title === 'string' ? track.title : '',
        typeof track.artist === 'string' ? track.artist : '',
        Number.isSafeInteger(track.durationMs) && track.durationMs > 0 ? track.durationMs : null,
        now);
    return key;
  }

  getTrack(track) {
    return this.db.prepare('SELECT * FROM tracks WHERE track_key = ?').get(trackId(track)) ?? null;
  }

  recordImportBatch(batch) {
    this.db.prepare(`INSERT INTO seed_imports
      (batch_id, provider, source, requested, imported, duplicates, degraded, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(batch.batchId, batch.provider, batch.source, batch.requested, batch.imported,
        batch.duplicates ?? 0, batch.degraded ? 1 : 0, batch.reason ?? null, batch.createdAt);
  }

  getImportBatch(batchId) {
    return this.db.prepare('SELECT * FROM seed_imports WHERE batch_id = ?').get(batchId) ?? null;
  }

  listImportBatches({ limit = 20 } = {}) {
    return this.db.prepare('SELECT * FROM seed_imports ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  addEnvironmentEntry(entry, now) {
    this.db.prepare(`INSERT INTO user_environment
      (track_key, provider, source, batch_id, play_count, last_played_at, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_key) DO UPDATE SET
        source = user_environment.source,
        play_count = COALESCE(excluded.play_count, user_environment.play_count),
        last_played_at = COALESCE(excluded.last_played_at, user_environment.last_played_at)`)
      .run(trackId(entry.track), entry.track.provider, entry.source, entry.batchId ?? null,
        Number.isSafeInteger(entry.playCount) ? entry.playCount : null,
        Number.isSafeInteger(entry.lastPlayedAt) ? entry.lastPlayedAt : null,
        now);
  }

  getEnvironmentEntry(track) {
    return this.db.prepare('SELECT * FROM user_environment WHERE track_key = ?').get(trackId(track)) ?? null;
  }

  countEnvironment(provider = null) {
    const row = provider
      ? this.db.prepare('SELECT COUNT(*) AS count FROM user_environment WHERE provider = ?').get(provider)
      : this.db.prepare('SELECT COUNT(*) AS count FROM user_environment').get();
    return row?.count ?? 0;
  }

  listEnvironment({ provider = null, limit = 1000 } = {}) {
    return provider
      ? this.db.prepare('SELECT * FROM user_environment WHERE provider = ? ORDER BY track_key LIMIT ?').all(provider, limit)
      : this.db.prepare('SELECT * FROM user_environment ORDER BY track_key LIMIT ?').all(limit);
  }

  setPreference(preference) {
    this.db.prepare(`INSERT INTO agent_preferences (target_type, target_key, affinity, source, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_key) DO UPDATE SET
        affinity = excluded.affinity, source = excluded.source, updated_at = excluded.updated_at`)
      .run(preference.targetType, preference.targetKey, preference.affinity, preference.source, preference.updatedAt);
  }

  getPreference(targetType, targetKey) {
    return this.db.prepare('SELECT * FROM agent_preferences WHERE target_type = ? AND target_key = ?')
      .get(targetType, targetKey) ?? null;
  }

  countPreferences() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM agent_preferences').get()?.count ?? 0;
  }

  listPreferences({ targetType = null, limit = 1000 } = {}) {
    return targetType
      ? this.db.prepare('SELECT * FROM agent_preferences WHERE target_type = ? ORDER BY target_key LIMIT ?').all(targetType, limit)
      : this.db.prepare('SELECT * FROM agent_preferences ORDER BY target_type, target_key LIMIT ?').all(limit);
  }
}
