import { MusicError, PROVIDERS } from './contracts.mjs';

const KEY = 'music_account_v1';
const LEGACY = 'legacy';
const LOGGED_OUT = 'logged-out';
const TABLES = {
  seed_imports: 'row.provider',
  user_environment: 'row.provider',
  environment_sources: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  listen_history: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  track_stats: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  user_track_feedback: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  track_availability: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  session_influence: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  growth_jobs: "CASE WHEN json_valid(row.entry_json) THEN json_extract(row.entry_json, '$.track.provider') END",
  constraints: "substr(row.track_key, 1, instr(row.track_key, ':') - 1)",
  settings: 'NULL',
};
const PRIVATE_SETTINGS = [
  'decision_history_v1', 'recent_playback_v1', 'feedback_revision_v1', 'preference_reset_v1',
  'preference_reset_backup_v1', 'persona_summary_v1', 'model_recommendations_v1', 'recommendation_error_v1',
  'discovery_cache_v1', 'discovery_filter_v1', 'filtered_playback_pool_v1', 'discovery_reviews_v1',
];

export function musicAccount(store) {
  return store?.getSetting?.(KEY, null) ?? null;
}

export function publicMusicAccount(store) {
  const account = musicAccount(store);
  return account && { provider: account.provider, revision: account.revision };
}

export function requireCurrentMusicAccount(store, provider = null, expectedRevision = undefined) {
  const account = musicAccount(store);
  if (account && expectedRevision !== undefined && expectedRevision !== account.revision) {
    throw new MusicError('music_account_changed', '音乐账号已变化，请刷新后重试。');
  }
  if (account && (!account.provider || (provider && account.provider !== provider))) {
    throw new MusicError('login_required', '请先登录当前要使用的音乐平台。');
  }
  return account;
}

const keyOf = account => account?.provider ? JSON.stringify([account.provider, account.accountId]) : LOGGED_OUT;
const where = table => table === 'settings' ? `key IN (${PRIVATE_SETTINGS.map(key => `'${key}'`).join(',')})`
  : table === 'constraints' ? 'track_key IS NOT NULL' : '1';

// Keep one working set so all existing library, history and growth queries use
// the same account. Move rows in one SQLite transaction when the owner changes.
function archive(store, owner, legacy = false) {
  for (const [table, provider] of Object.entries(TABLES)) {
    const columns = store.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    const json = columns.flatMap(column => [`'${column}'`, `row.${column}`]).join(',');
    const key = legacy ? `COALESCE((SELECT json_array(c.provider,c.account_id) FROM credential_references c
      WHERE c.provider=${provider} AND c.state IN ('authorized','expired') AND length(c.account_id)>0), ?)` : '?';
    store.db.prepare(`INSERT INTO music_account_archive
      SELECT ${key}, '${table}', row.rowid, json_object(${json}) FROM ${table} row WHERE ${where(table)}`).run(owner);
    store.db.exec(`DELETE FROM ${table} WHERE ${where(table)}`);
  }
}

function restore(store, owner) {
  for (const table of Object.keys(TABLES)) {
    const columns = store.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    const values = columns.map(column => `json_extract(value_json, '$.${column}')`);
    if (table !== 'constraints' && table !== 'settings') {
      columns.unshift('rowid');
      values.unshift('original_rowid');
    }
    store.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${values.join(',')}
      FROM music_account_archive WHERE account_key=? AND table_name=? ORDER BY original_rowid`).run(owner, table);
  }
  store.db.prepare('DELETE FROM music_account_archive WHERE account_key=?').run(owner);
}

export function activateMusicAccount(store, provider = null, accountId = null) {
  return store.transaction(() => {
    const previous = musicAccount(store);
    const next = { provider, accountId, revision: (previous?.revision ?? -1) + 1 };
    if (previous && keyOf(next) === keyOf(previous)) return previous;
    archive(store, previous ? keyOf(previous) : LEGACY, !previous);
    restore(store, keyOf(next));
    store.setSetting(KEY, next);
    return next;
  });
}

export function initializeMusicAccount(store, preferredProvider) {
  const active = musicAccount(store);
  const recorded = active?.provider ? store.getCredentialReference(active.provider) : null;
  // A restart can see a verified reference written just before the previous
  // Core stopped. The selected owner is restored before the first snapshot.
  const chosen = recorded && recorded.account_id === active.accountId && ['authorized', 'expired'].includes(recorded.state)
    ? recorded : [...new Set([preferredProvider, ...PROVIDERS])].map(provider => store.getCredentialReference(provider))
      .find(reference => reference?.state === 'authorized' && reference.account_id);
  return activateMusicAccount(store, chosen?.provider ?? null, chosen?.account_id ?? null);
}
