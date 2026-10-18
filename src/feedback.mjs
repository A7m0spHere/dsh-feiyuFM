// Explicit user feedback is a separate, reversible rule. Never rewrite agent taste.
import { randomUUID } from 'node:crypto';
import { MusicError, trackId, normalizeTrack } from './contracts.mjs';
import { initializeAgentPreferences } from './taste.mjs';

export const FEEDBACK_WEIGHT = Object.freeze({ liked: 0.25, reduced: -0.75 });
const REVISION_KEY = 'feedback_revision_v1';
export function feedbackRevision(store) { return store.getSetting(REVISION_KEY, 0); }
function advanceFeedbackRevision(store) {
  const revision = feedbackRevision(store);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw new MusicError('feedback_unavailable', '反馈版本无法更新，请检查本机数据。');
  }
  store.setSetting(REVISION_KEY, revision + 1);
}
export function validateFeedbackQuery(options = {}) {
  const { query = '', filter = 'all', offset = 0, limit = 12 } = options;
  if (typeof query !== 'string' || query.length > 200 || !['all', 'liked', 'reduced'].includes(filter)
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new MusicError('invalid_command', '反馈查询参数无效。');
  }
  return { query: query.trim(), filter, offset, limit };
}
export function validateFeedbackClear({ track, commandId, expectedRevision } = {}) {
  trackId(track);
  if (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 128
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new MusicError('invalid_command', '撤销反馈需要操作标识和反馈版本。');
  }
}
export function listTrackFeedback(store, options = {}) {
  const { query, filter, limit, offset: requestedOffset } = validateFeedbackQuery(options);
  const counts = store.db.prepare(`SELECT
    COUNT(CASE WHEN score=1 THEN 1 END) liked, COUNT(CASE WHEN score=-1 THEN 1 END) reduced
    FROM user_track_feedback`).get();
  const where = `f.score IN (-1,1) AND (?='all' OR f.score=?)
    AND (?='' OR instr(lower(t.title),lower(?))>0 OR instr(lower(t.artist),lower(?))>0
      OR instr(lower(t.provider_track_id),lower(?))>0)`;
  const parameters = [filter, filter === 'liked' ? 1 : -1, query, query, query, query];
  const matched = store.db.prepare(`SELECT COUNT(*) count FROM user_track_feedback f
    JOIN tracks t USING(track_key) WHERE ${where}`).get(...parameters).count;
  const offset = Math.min(requestedOffset, matched ? Math.floor((matched - 1) / limit) * limit : 0);
  const items = store.db.prepare(`SELECT t.*,f.score,f.updated_at feedback_at FROM user_track_feedback f
    JOIN tracks t USING(track_key) WHERE ${where} ORDER BY f.updated_at DESC,f.track_key ASC LIMIT ? OFFSET ?`)
    .all(...parameters, limit, offset).map(row => ({ key: row.track_key,
      track: normalizeTrack({ provider: row.provider, providerTrackId: row.provider_track_id,
        title: row.title, artist: row.artist, durationMs: row.duration_ms }), score: row.score, updatedAt: row.feedback_at }));
  return { version: 1, revision: feedbackRevision(store), query, filter, offset, limit,
    total: counts.liked + counts.reduced, matched, counts: { ...counts }, items };
}
export function clearTrackFeedback(store, input, now = Date.now()) {
  validateFeedbackClear(input);
  const { track, expectedRevision, commandId } = input;
  return store.transaction(() => {
    const id = `feedback-clear:${commandId}`;
    if (store.hasCommand(id)) return;
    if (feedbackRevision(store) !== expectedRevision) {
      throw new MusicError('feedback_conflict', '反馈已在其他操作中更新，请核对最新列表后再撤销。');
    }
    // Keep a neutral row, even after a reset removed the old vote. Undo must
    // never resurrect a vote that the user explicitly cleared afterwards.
    setTrackFeedback(store, track, 0, now);
    store.recordCommand(id, now);
  });
}
export function trackFeedback(store, track) {
  return store.db.prepare('SELECT score FROM user_track_feedback WHERE track_key=?').get(trackId(track))?.score ?? 0;
}
export function feedbackScore(store, track) {
  const score = trackFeedback(store, track);
  return score === 1 ? FEEDBACK_WEIGHT.liked : score === -1 ? FEEDBACK_WEIGHT.reduced : 0;
}
export function setTrackFeedback(store, track, score, now) {
  if (![-1, 0, 1].includes(score)) throw new MusicError('invalid_command', '反馈只能为喜欢、少推荐或撤销。');
  const key = trackId(track);
  if (!store.getTrack(track)) throw new MusicError('invalid_track', '歌曲尚未记录，无法保存反馈。');
  store.transaction(() => {
    store.db.prepare(`INSERT INTO user_track_feedback VALUES (?,?,?)
      ON CONFLICT(track_key) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at`).run(key, score, now);
    advanceFeedbackRevision(store);
  });
  return score;
}
function assertNoSummary(store) {
  if (store.db.prepare("SELECT 1 FROM music_model_calls WHERE status IN ('reserved','running')").get()) {
    throw new MusicError('summary_busy', '总结正在进行，请完成后再重置偏好。');
  }
}
export function resetRecommendationTaste(store, snapshot, { clearFeedback = false, clearLibrary = false, now = Date.now(), commandId = null } = {}) {
  return store.transaction(() => {
    assertNoSummary(store);
    store.setSetting('preference_reset_backup_v1', {
      at: now, preferences: store.db.prepare('SELECT * FROM agent_preferences ORDER BY target_type,target_key').all(),
      feedback: store.db.prepare('SELECT * FROM user_track_feedback').all(),
      sessionInfluence: store.db.prepare('SELECT * FROM session_influence').all(),
      previousReset: store.getSetting('preference_reset_v1', null),
      summary: store.getSetting('persona_summary_v1', null), clearFeedback,
      recommendations: store.getSetting('model_recommendations_v1',null),
      environment:clearLibrary?store.db.prepare('SELECT * FROM user_environment').all():null,
      environmentSources:clearLibrary?store.db.prepare('SELECT * FROM environment_sources').all():null,
      queue:clearLibrary?snapshot.queue??[]:null,
    });
    store.db.exec('DELETE FROM agent_preferences; DELETE FROM session_influence;');
    if(clearLibrary)store.db.exec('DELETE FROM environment_sources; DELETE FROM user_environment;');
    if (clearFeedback) store.db.exec('DELETE FROM user_track_feedback');
    const result = initializeAgentPreferences({ store, now });
    store.setSetting('preference_reset_v1', { at: now, id: randomUUID(), playInstanceId: snapshot.current?.playInstanceId ?? null });
    store.removeSetting('persona_summary_v1');
    store.removeSetting('model_recommendations_v1');
    advanceFeedbackRevision(store);
    if(commandId) store.recordCommand(commandId,now);
    return result;
  });
}
export function undoRecommendationReset(store, { commandId = null, now = Date.now() } = {}) {
  return store.transaction(() => {
    assertNoSummary(store);
    const backup = store.getSetting('preference_reset_backup_v1', null);
    if (!backup) throw new MusicError('no_reset_backup', '没有可撤销的偏好重置。');
    store.db.exec('DELETE FROM agent_preferences; DELETE FROM session_influence;');
    if(backup.environment){
      store.db.exec('DELETE FROM environment_sources; DELETE FROM user_environment;');
      for(const r of backup.environment)store.db.prepare('INSERT INTO user_environment VALUES (?,?,?,?,?,?,?)').run(r.track_key,r.provider,r.source,r.batch_id,r.play_count,r.last_played_at,r.added_at);
      for(const r of backup.environmentSources)store.db.prepare('INSERT INTO environment_sources VALUES (?,?,?,?,?,?,?)').run(r.track_key,r.source,r.source_ref,r.play_count,r.last_played_at,r.first_seen_at,r.observed_at);
    }
    for (const p of backup.preferences) store.setPreference({ targetType: p.target_type, targetKey: p.target_key, affinity: p.affinity, source: p.source, updatedAt: p.updated_at });
    for (const row of backup.sessionInfluence) store.db.prepare('INSERT INTO session_influence VALUES (?,?,?,?)').run(row.session_id, row.track_key, row.applied, row.updated_at);
    // Restore cleared votes, but keep any explicit votes made since the reset.
    if (backup.clearFeedback) for (const row of backup.feedback) store.db.prepare('INSERT OR IGNORE INTO user_track_feedback VALUES (?,?,?)').run(row.track_key, row.score, row.updated_at);
    if (backup.previousReset) store.setSetting('preference_reset_v1', backup.previousReset); else store.removeSetting('preference_reset_v1');
    if (backup.summary) store.setSetting('persona_summary_v1', backup.summary); else store.removeSetting('persona_summary_v1');
    if (backup.recommendations) store.setSetting('model_recommendations_v1', backup.recommendations); else store.removeSetting('model_recommendations_v1');
    store.removeSetting('preference_reset_backup_v1');
    advanceFeedbackRevision(store);
    if(commandId) store.recordCommand(commandId,now);
    return {queue:backup.queue};
  });
}
export function feedbackView(store, snapshot) {
  const rows = store.db.prepare('SELECT score,COUNT(*) count FROM user_track_feedback GROUP BY score').all();
  return { version: 1, managementVersion: 1, revision: feedbackRevision(store),
    playInstanceId: snapshot.current?.playInstanceId ?? null,
    current: snapshot.current ? trackFeedback(store, snapshot.current.track) : 0,
    liked: rows.find(r => r.score === 1)?.count ?? 0, reduced: rows.find(r => r.score === -1)?.count ?? 0,
    resetAt: store.getSetting('preference_reset_v1', null)?.at ?? null,
    canUndoReset: Boolean(store.db.prepare("SELECT 1 FROM settings WHERE key='preference_reset_backup_v1'").get()) };
}
