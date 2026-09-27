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

export class MusicStore {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 2000 });
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error(`Unsupported schema version ${version}`);
    if (version === 0) {
      this.transaction(() => {
        this.db.exec(MIGRATION_1);
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, new Date().toISOString());
        this.db.exec('PRAGMA user_version = 1');
      });
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        entry.playInstanceId, trackId(entry.track), entry.selectedBy,
        entry.progressSource, entry.effectiveMs, Number(entry.agentListening), Number(entry.audible),
        entry.endReason, entry.endedAt);
      if (result.changes === 0) return false;
      this.db.prepare(`INSERT INTO track_stats (track_key, play_count, effective_ms) VALUES (?, ?, ?)
        ON CONFLICT(track_key) DO UPDATE SET play_count=play_count+excluded.play_count,
        effective_ms=effective_ms+excluded.effective_ms`)
        .run(trackId(entry.track), entry.endReason === 'ended' && entry.effectiveMs > 0 ? 1 : 0, entry.effectiveMs);
      return true;
    });
  }

  getHistory(playInstanceId) {
    return this.db.prepare('SELECT * FROM listen_history WHERE play_instance_id = ?').get(playInstanceId) ?? null;
  }

  getTrackStats(track) {
    return this.db.prepare('SELECT * FROM track_stats WHERE track_key = ?').get(trackId(track)) ?? null;
  }
}
