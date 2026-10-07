// A bounded background discovery cache. Selection never waits for network I/O.
import { trackId, normalizeTrack } from './contracts.mjs';
import { collectDiscovery } from './providers/coordinator.mjs';
import {selectRecommendationSeeds} from './recommendation.mjs';
import {trackFeedback} from './feedback.mjs';
import { randomUUID, createHash } from 'node:crypto';
export const DISCOVERY_PARAMETERS = Object.freeze({ limit: 40, capacity: 200, ttlMs: 6 * 60 * 60_000,
  lowWater: 10, intervalMs: 30 * 60_000, manualIntervalMs: 60_000, retryMs: 5 * 60_000 });
export function createDiscoveryCache({ registry, store = null, now = () => Date.now(), onLog = () => {}, parameters = DISCOVERY_PARAMETERS } = {}) {
  let enabled = false, entries = [], lastAttemptAt = null, lastSuccessAt = null, nextAttemptAt = 0;
  let state = 'disabled', reason = null, generation = 0, inflight = null, controller = null;
  let owner = null, candidateRevision = randomUUID();
  const listeners = new Set();
  const normalize = track => {
    try {
      const basic = normalizeTrack(track);
      const origin = track.discovery ?? {};
      return { ...basic, discovery: {
        source: ['netease_daily','netease_personal_fm','netease_similar','platform_recommendation'].includes(origin.source) ? origin.source : 'platform_recommendation',
        seedTrackKey: typeof origin.seedTrackKey === 'string' && /^[\w:.-]{1,100}$/.test(origin.seedTrackKey) ? origin.seedTrackKey : null,
        seedTrackKeys:Array.isArray(origin.seedTrackKeys)?[...new Set(origin.seedTrackKeys.filter(k=>typeof k==='string'&&/^[\w:.-]{1,100}$/.test(k)))].slice(0,3):[],
        fetchedAt: Number.isFinite(origin.fetchedAt) ? origin.fetchedAt : now(),
        expiresAt: Math.min(Number.isFinite(origin.expiresAt) ? origin.expiresAt : now() + parameters.ttlMs, now() + parameters.ttlMs),
      } };
    } catch { return null; }
  };
  const accountKey = () => Object.entries(registry.providers).map(([name, provider]) => {
    const a = provider.getAccount(); return `${name}:${a.status}:${a.accountId ?? ''}`;
  }).sort().join('|');
  const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* UI is optional. */ } });
  const persist = () => store?.setSetting('discovery_cache_v1', { owner, entries, lastSuccessAt, lastAttemptAt, nextAttemptAt, candidateRevision });
  const synchronizeAccount = () => {
    const key = accountKey();
    if (key === owner) return;
    owner = key; generation++; candidateRevision = randomUUID(); controller?.abort(); entries = []; lastSuccessAt = null;
    lastAttemptAt = null; nextAttemptAt = 0; reason = null; state = enabled ? 'idle' : 'disabled';
    try { store?.removeSetting?.('discovery_filter_v1'); } catch { /* a lost filter result is the safe direction */ }
    persist(); notify();
  };
  owner = accountKey();
  const saved = store?.getSetting('discovery_cache_v1');
  if (saved?.owner === owner && Array.isArray(saved.entries)) {
    candidateRevision = saved.candidateRevision ?? candidateRevision;
    entries = saved.entries.slice(0, parameters.capacity).map(normalize).filter(Boolean);
    lastSuccessAt = saved.lastSuccessAt ?? null;
    lastAttemptAt = Number.isFinite(saved.lastAttemptAt) ? saved.lastAttemptAt : null;
    nextAttemptAt = Number.isFinite(saved.nextAttemptAt) ? saved.nextAttemptAt : 0;
  }
  const candidates = () => entries.filter(track => {
    const expiry = track.discovery?.expiresAt;
    return Number.isFinite(expiry) && expiry > now()
      && (!store || store.isTrackAvailable(track, now()));
  });
  const usable = () => candidates().filter(track => !store?.getEnvironmentEntry(track)
    && !store?.hasEffectiveListen(track) && (!store || trackFeedback(store,track)!==1));
  /** LLM 筛选结果按 trackKey 戳到候选上；结果随缓存清理一并失效。 */
  const stamped = (tracks) => {
    if (!store) return tracks;
    let picks;
    try { picks = store.getSetting('discovery_filter_v1', null)?.picks; } catch { return tracks; }
    if (!Array.isArray(picks) || !picks.length) return tracks;
    const ranked = new Map(picks.filter(p => p && typeof p.trackKey === 'string').map(p => [p.trackKey, p]));
    if (!ranked.size) return tracks;
    return tracks.map(track => {
      const pick = ranked.get(trackId(track));
      if (!pick) return track;
      return { ...track, discovery: { ...track.discovery, llmRank: Number.isSafeInteger(pick.rank) ? pick.rank : null, llmReason: typeof pick.reason === 'string' ? pick.reason : '' } };
    });
  };
  const status = () => {
    synchronizeAccount();
    const tracks = stamped(usable());
    const picked = tracks.filter(track => Number.isSafeInteger(track.discovery?.llmRank)).length;
    return { state: !enabled ? 'disabled' : inflight ? 'refreshing' : state === 'ready' && !tracks.length ? 'empty' : state,
      count: enabled ? tracks.length : 0, cached: tracks.length, lastAttemptAt, lastSuccessAt, nextAttemptAt,
      reason, sources: [...new Set(tracks.map(t => t.discovery?.source).filter(Boolean))], refreshing: Boolean(inflight),
      picked, candidateRevision, candidateOwner:createHash('sha256').update(owner??'').digest('hex'),
      candidateCount: enabled ? candidates().length : 0,
      filtering: Boolean(store?.db.prepare("SELECT 1 FROM music_model_calls WHERE status IN ('reserved','running') AND purpose='discovery-filter'").get()) };
  };
  const recommendations = () => {
    const filter = store?.getSetting('discovery_filter_v1', null);
    if (filter?.source !== 'llm-discovery-filter') return [];
    const sameOwner=filter.candidateOwner===createHash('sha256').update(owner??'').digest('hex');
    const retained=sameOwner&&Array.isArray(filter.tracks)?filter.tracks.filter(track=>track.discovery?.expiresAt>now()&&(!store||store.isTrackAvailable(track,now()))):[];
    const source=filter.candidateRevision===candidateRevision?candidates():retained;
    return stamped(source).filter(track => Number.isSafeInteger(track.discovery?.llmRank)&&track.discovery.llmRank>0)
      .sort((a,b) => a.discovery.llmRank - b.discovery.llmRank);
  };
  const refresh = ({ manual = false, signal = null } = {}) => {
    synchronizeAccount();
    if (!enabled) return Promise.resolve({ tracks: [], attempts: [], reason: 'discovery-disabled' });
    if (inflight) return inflight;
    const earliest = manual && lastAttemptAt !== null ? lastAttemptAt + parameters.manualIntervalMs : nextAttemptAt;
    if (now() < earliest) return Promise.resolve({ tracks: usable(), attempts: [], reason: 'refresh-budget' });
    const key = owner, version = generation;
    controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    lastAttemptAt = now(); nextAttemptAt = now() + parameters.intervalMs; state = 'refreshing'; reason = null;
    persist();
    const work = Promise.resolve().then(async () => {
      const seeds=selectRecommendationSeeds({store,now:now()});
      const result = await collectDiscovery({ registry, limit: parameters.limit, signal: combined,seeds });
      if (combined.aborted || generation !== version || accountKey() !== key || !enabled) return { tracks: [], attempts: [], reason: 'cancelled' };
      const succeeded = result.attempts.some(a => a.ok);
      if (succeeded) {
        const seen = new Set();
        entries = result.tracks.map(normalize).filter(Boolean).filter(track => {
          const id = trackId(track); if (seen.has(id)) return false; seen.add(id); return true;
        }).slice(0, parameters.capacity);
        candidateRevision = randomUUID();
        lastSuccessAt = now(); state = usable().length ? 'ready' : 'empty';
        reason = usable().length ? null : 'no-unfamiliar-candidates';
        persist();
      } else {
        const signedIn = Object.values(registry.providers).some(p => p.getAccount().status === 'authorized');
        const unavailable = result.attempts.every(a => ['provider_unavailable','capability_unavailable','login_required'].includes(a.code));
        state = usable().length ? 'ready' : !signedIn ? 'login_required' : unavailable ? 'unavailable' : 'error';
        reason = !signedIn ? 'login-required' : unavailable ? 'recommendation-unavailable' : 'refresh-failed';
        nextAttemptAt = now() + parameters.retryMs;
        persist();
      }
      onLog({ type: 'discovery', count: usable().length, status: state });
      return { ...result, tracks: stamped(usable()) };
    }).catch(error => {
      if (generation === version && enabled) { state = usable().length ? 'ready' : 'error'; reason = 'refresh-failed'; nextAttemptAt = now() + parameters.retryMs; persist(); }
      onLog({ type: 'discovery-error', code: error.code ?? 'provider_failure' });
      return { tracks: combined.aborted ? [] : usable(), attempts: [], reason: combined.aborted ? 'cancelled' : 'refresh-failed' };
    }).finally(() => { if (inflight === work) { inflight = null; controller = null; } notify(); });
    inflight = work; notify();
    return work;
  };
  return {
    tracks() { synchronizeAccount(); return enabled ? stamped(usable()) : []; }, status, refresh,
    candidates() { synchronizeAccount(); return enabled ? candidates() : []; },
    recommendations() { synchronizeAccount(); return enabled ? recommendations() : []; },
    setEnabled(value) {
      if (enabled === Boolean(value)) return;
      enabled = Boolean(value); generation++;
      if (!enabled) { controller?.abort(); state = 'disabled'; }
      else { state = usable().length ? 'ready' : 'idle'; }
      notify();
    },
    tick() {
      synchronizeAccount();
      if (enabled && !inflight && now() >= nextAttemptAt && (usable().length < parameters.lowWater || entries.some(t => t.discovery.expiresAt <= now()))) void refresh();
    },
    clear() { generation++; candidateRevision = randomUUID(); controller?.abort(); entries = []; lastSuccessAt = null; nextAttemptAt = 0; state = enabled ? 'idle' : 'disabled';
      try { store?.removeSetting?.('discovery_filter_v1'); } catch { /* nothing to keep */ }
      persist(); notify(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { generation++; enabled = false; controller?.abort(); listeners.clear(); },
  };
}
