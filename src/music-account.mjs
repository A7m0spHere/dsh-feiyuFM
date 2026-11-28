import { MusicError, PROVIDERS } from './contracts.mjs';
import { advanceFeedbackRevision } from './feedback.mjs';
import { mergeHistoricalPlayback, recentPlayback } from './recent-playback.mjs';

const KEY = 'music_account_v1';
const LEGACY = 'legacy';
const LOGGED_OUT = 'logged-out';
const directProvider = column => column('provider');
const trackProvider = column => `substr(${column('track_key')}, 1, instr(${column('track_key')}, ':') - 1)`;
const TABLES = {
  seed_imports: directProvider,
  user_environment: directProvider,
  environment_sources: trackProvider,
  listen_history: trackProvider,
  track_stats: trackProvider,
  user_track_feedback: trackProvider,
  track_availability: trackProvider,
  session_influence: trackProvider,
  growth_jobs: column => `CASE WHEN json_valid(${column('entry_json')}) THEN json_extract(${column('entry_json')}, '$.track.provider') END`,
  constraints: trackProvider,
  settings: () => 'NULL',
};
const columnsOf = (store, table) => store.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
const archivedColumn = column => `json_extract(value_json, '$.${column}')`;
const archivedProvider = `CASE table_name ${Object.entries(TABLES).map(
  ([table, provider]) => `WHEN '${table}' THEN ${provider(archivedColumn)}`,
).join(' ')} END`;

const recoverConflicts = {
  track_stats: `ON CONFLICT(track_key) DO UPDATE SET
    play_count = track_stats.play_count + excluded.play_count,
    effective_ms = track_stats.effective_ms + excluded.effective_ms`,
  session_influence: `ON CONFLICT(session_id, track_key) DO UPDATE SET
    applied = session_influence.applied + excluded.applied,
    updated_at = max(session_influence.updated_at, excluded.updated_at)`,
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
    const columns = columnsOf(store, table);
    const json = columns.flatMap(column => [`'${column}'`, `row.${column}`]).join(',');
    const key = legacy ? `COALESCE((SELECT json_array(c.provider,c.account_id) FROM credential_references c
      WHERE c.provider=${provider(column => `row.${column}`)} AND c.state IN ('authorized','expired') AND length(c.account_id)>0), ?)` : '?';
    store.db.prepare(`INSERT INTO music_account_archive
      SELECT ${key}, '${table}', row.rowid, json_object(${json}) FROM ${table} row WHERE ${where(table)}`).run(owner);
    store.db.exec(`DELETE FROM ${table} WHERE ${where(table)}`);
  }
}

function restore(store, owner) {
  for (const table of Object.keys(TABLES)) {
    const columns = columnsOf(store, table);
    const values = columns.map(archivedColumn);
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

export function hasLegacyMusicData(store, provider) {
  return Boolean(store.db.prepare(`SELECT 1 FROM music_account_archive
    WHERE account_key=? AND ${archivedProvider}=? LIMIT 1`).get(LEGACY, provider));
}

export function recoverLegacyMusicData(store, provider, accountRevision) {
  if (!PROVIDERS.includes(provider) || !Number.isSafeInteger(accountRevision)) {
    throw new MusicError('invalid_command', '恢复旧版资料需要当前音乐账号。');
  }
  return store.transaction(() => {
    const account = requireCurrentMusicAccount(store, provider, accountRevision);
    if (!account?.accountId || !hasLegacyMusicData(store, provider)) return false;
    const recent = recentPlayback(store);
    let restoredHistory = false;
    for (const [table, providerOf] of Object.entries(TABLES)) {
      if (table === 'settings') continue;
      const columns = columnsOf(store, table);
      const selection = `account_key=? AND table_name=? AND ${providerOf(archivedColumn)}=?`;
      // Omit rowid so old rows cannot replace unrelated records in the active account.
      const result = store.db.prepare(`INSERT INTO ${table} (${columns.join(',')})
        SELECT ${columns.map(archivedColumn).join(',')} FROM music_account_archive WHERE ${selection}
        ORDER BY original_rowid ${recoverConflicts[table] ?? 'ON CONFLICT DO NOTHING'}`).run(LEGACY, table, provider);
      if (result.changes && table === 'user_track_feedback') advanceFeedbackRevision(store);
      if (result.changes && table === 'listen_history') restoredHistory = true;
      store.db.prepare(`DELETE FROM music_account_archive WHERE ${selection}`).run(LEGACY, table, provider);
    }
    if (restoredHistory) mergeHistoricalPlayback(store, recent);
    return true;
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
