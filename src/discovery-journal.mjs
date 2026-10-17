// Bounded read-only projection of the current valid filtered batch, not a new log.
import {trackId} from './contracts.mjs';
import {qualifiesAsListen} from './growth.mjs';
import {describeCandidateEvidence} from './discovery-facts.mjs';

const safeLabel = value => {
  const text = String(value ?? '').trim().slice(0, 160);
  return /https?:\/\/|\b(?:MUSIC_U|cookie|token)\s*[:=]/i.test(text) ? '[内容已隐藏]' : text;
};
const parse = json => { try { return JSON.parse(json); } catch { return null; } };
const keyOf = track => { try { return trackId(track); } catch { return null; } };
export function describeDiscoveryJournal({store, pipeline, snapshot = null, now = Date.now()}) {
  const base = {version: 1, scope: 'current-valid-filtered-batch', status: 'empty', reason: 'no-current-batch',
    recommendedAt: null, items: [], retained: false, historyLimit: 200};
  if (!pipeline || pipeline.pipeline !== 'platform-filter') return {...base, status: 'unavailable'};
  if (!pipeline.referenceCount) return {...base, reason: 'no-input'};
  const filter = store.getSetting('discovery_filter_v1', null);
  if (filter?.source !== 'llm-discovery-filter' || !filter.callId || filter.callId !== pipeline.filterCallId) return base;
  if (!filter.candidateOwner || filter.candidateOwner !== pipeline.candidateOwner) return {...base, reason: 'account-changed'};
  const since = filter.generatedAt;
  if (!Number.isSafeInteger(since) || since < 0 || since > now) return {...base, reason: 'unknown-time'};
  const call = store.db.prepare("SELECT facts_json,status FROM music_model_calls WHERE call_id=? AND purpose='discovery-filter'").get(filter.callId);
  const facts = call?.status === 'completed' ? parse(call.facts_json) : null;
  if (!facts || facts.candidateOwner !== filter.candidateOwner || facts.candidateRevision !== filter.candidateRevision
    || !Array.isArray(facts.candidates) || !Array.isArray(filter.picks)) return {...base, reason: 'unverified-batch'};
  const rows = new Map();
  for (const track of (pipeline.tracks ?? []).slice(0, 12)) {
    const key = keyOf(track);
    if (!key || rows.has(key) || !Number.isFinite(track.discovery?.expiresAt) || track.discovery.expiresAt <= now) continue;
    if (!filter.picks?.some(p => p.trackKey === key)) continue;
    const candidate = facts.candidates?.find(c => c.key === key);
    if (!candidate) continue;
    const original = Array.isArray(facts.localCandidates) ? facts.localCandidates.find(t => keyOf(t) === key) : null;
    const origin = original?.discovery ?? {};
    const source = ['netease_similar', 'netease_daily', 'netease_personal_fm', 'platform_recommendation'].includes(origin.source) ? origin.source : 'unknown';
    const linked = source === 'netease_similar' && [origin.seedTrackKey, ...(Array.isArray(origin.seedTrackKeys) ? origin.seedTrackKeys : [])].some(k => typeof k === 'string' && /^netease:[\w.-]{1,80}$/.test(k));
    rows.set(key, {key, title: safeLabel(track.title) || '曲名未提供', artist: safeLabel(track.artist) || '艺人未提供',
      recommended: true, evidence: describeCandidateEvidence({id: key, source, known: null, feedback: candidate?.feedback, seedRelated: linked}).facts,
      userRequested: false, agentExperienced: false, silentExperienced: false, audibleHeard: false, latestListenAt: null});
  }
  if (!rows.size) return {...base, reason: 'no-valid-selected-tracks', recommendedAt: since};
  const query = `SELECT g.entry_json FROM listen_history h JOIN growth_jobs g USING(play_instance_id)
    WHERE h.track_key IN (${[...rows].map(() => '?').join(',')}) AND h.ended_at>=? AND h.ended_at<=?
    ORDER BY h.ended_at DESC,h.play_instance_id LIMIT 200`;
  const recorded = store.db.prepare(query).all(...rows.keys(), since, now);
  for (const row of recorded) {
    const entry = parse(row.entry_json), item = rows.get(keyOf(entry?.track));
    if (!item || !['user', 'agent'].includes(entry.selectedBy) || !Number.isFinite(entry.startedAt) || entry.startedAt < since
      || !Number.isFinite(entry.endedAt) || entry.endedAt < entry.startedAt || entry.endedAt > now) continue;
    const user = entry.selectedBy === 'user';
    if (!user && entry.origin?.modelCallId !== filter.callId) continue;
    if (user) item.userRequested = true;
    const verdict = qualifiesAsListen({entry, durationMs: entry.durationMs ?? entry.track.durationMs});
    if (!user && verdict.qualifies) item.agentExperienced = true;
    if (!user && verdict.qualifies && entry.audibleMs === 0) item.silentExperienced = true;
    // audible=true only means some sound occurred. Require measured audible time.
    if (entry.endReason !== 'error' && Number.isFinite(entry.effectiveMs) && Number.isFinite(entry.audibleMs)
      && entry.audibleMs <= entry.effectiveMs && entry.audibleMs >= verdict.thresholdMs) item.audibleHeard = true;
    if (verdict.qualifies || item.audibleHeard) item.latestListenAt = Math.max(item.latestListenAt ?? 0, entry.endedAt);
  }
  const current = snapshot?.current, active = rows.get(keyOf(current?.track));
  if (active && current?.selectedBy === 'user' && Number.isFinite(current.startedAt) && current.startedAt >= since) active.userRequested = true;
  return {...base, status: 'ready', reason: null, recommendedAt: since, items: [...rows.values()],
    retained: Boolean(pipeline.refreshing || pipeline.filtering || pipeline.lastError),
    historyLimited: recorded.length === 200};
}
