// Explicit user feedback is a separate, reversible rule. Never rewrite agent taste.
import { randomUUID } from 'node:crypto';
import { MusicError, trackId } from './contracts.mjs';
import { initializeAgentPreferences } from './taste.mjs';

export const FEEDBACK_WEIGHT = Object.freeze({ liked: 0.25, reduced: -0.75 });
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
  store.db.prepare(`INSERT INTO user_track_feedback VALUES (?,?,?)
    ON CONFLICT(track_key) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at`).run(key, score, now);
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
    if(commandId) store.recordCommand(commandId,now);
    return {queue:backup.queue};
  });
}
export function feedbackView(store, snapshot) {
  const rows = store.db.prepare('SELECT score,COUNT(*) count FROM user_track_feedback GROUP BY score').all();
  return { version: 1, current: snapshot.current ? trackFeedback(store, snapshot.current.track) : 0,
    liked: rows.find(r => r.score === 1)?.count ?? 0, reduced: rows.find(r => r.score === -1)?.count ?? 0,
    resetAt: store.getSetting('preference_reset_v1', null)?.at ?? null,
    canUndoReset: Boolean(store.db.prepare("SELECT 1 FROM settings WHERE key='preference_reset_backup_v1'").get()) };
}
