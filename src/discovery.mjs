// A bounded background discovery cache. Selection never waits for network I/O.
import { trackId, normalizeTrack } from './contracts.mjs';
import { collectDiscovery } from './providers/coordinator.mjs';
import {selectRecommendationSeeds} from './recommendation.mjs';
import { randomUUID, createHash } from 'node:crypto';
import {APPROVED_POOL_KEY,approvedPlaybackTracks} from './approved-pool.mjs';
import {SUPPLY_POLICY,REVIEW_KEY} from './recommendation-supply.mjs';
export const DISCOVERY_PARAMETERS = Object.freeze({ limit: 40, capacity: 200, ttlMs: 6 * 60 * 60_000,
  lowWater: 10, intervalMs: 30 * 60_000, manualIntervalMs: 60_000, retryMs: 5 * 60_000 });
export function createDiscoveryCache({ registry, store = null, now = () => Date.now(), onLog = () => {}, parameters = DISCOVERY_PARAMETERS } = {}) {
  let enabled = false, entries = [], lastAttemptAt = null, lastSuccessAt = null, nextAttemptAt = 0;
  let state = 'disabled', reason = null, generation = 0, inflight = null, controller = null;
  let owner = null, candidateRevision = randomUUID();
  let seedOffset=0,failureUntil=0;
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
  const persist = () => store?.setSetting('discovery_cache_v1', { owner, entries, lastSuccessAt, lastAttemptAt, nextAttemptAt, candidateRevision,seedOffset,failureUntil });
  const synchronizeAccount = () => {
    const key = accountKey();
    if (key === owner) return;
    owner = key; generation++; candidateRevision = randomUUID(); controller?.abort(); entries = []; lastSuccessAt = null;
    lastAttemptAt = null; nextAttemptAt = 0; seedOffset=0;failureUntil=0;reason = null; state = enabled ? 'idle' : 'disabled';
    try { store?.removeSetting?.('discovery_filter_v1');store?.removeSetting?.(APPROVED_POOL_KEY);store?.removeSetting?.(REVIEW_KEY); } catch { /* a lost filter result is the safe direction */ }
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
    seedOffset=Number.isSafeInteger(saved.seedOffset)&&saved.seedOffset>=0?saved.seedOffset:0;
    failureUntil=Number.isFinite(saved.failureUntil)?saved.failureUntil:0;
  }
  // One batched lookup per projection instead of one prepared statement per
  // cached candidate: a real library made every snapshot cost 100-300 ms.
  const candidates = () => {
    const unavailable = store?.unavailableKeys?.(now()) ?? new Set();
    return entries.filter(track => {
      const expiry = track.discovery?.expiresAt;
      return Number.isFinite(expiry) && expiry > now() && !unavailable.has(trackId(track));
    });
  };
  const usable = () => {
    const unavailable = store?.unavailableKeys?.(now()) ?? new Set();
    const environment = store?.environmentKeys?.() ?? new Set();
    const effective = store?.effectiveListenKeys?.() ?? new Set();
    const feedback = store?.feedbackScores?.() ?? new Map();
    return entries.filter(track => {
      const expiry = track.discovery?.expiresAt;
      if (!(Number.isFinite(expiry) && expiry > now())) return false;
      const key = trackId(track);
      return !unavailable.has(key) && !environment.has(key) && !effective.has(key) && feedback.get(key) !== 1;
    });
  };
  /** LLM 筛选结果按 trackKey 戳到候选上；结果随缓存清理一并失效。 */
  const stamped = (tracks) => {
    if (!store) return tracks;
    let picks, filter;
    try { filter = store.getSetting('discovery_filter_v1', null); picks = filter?.picks; } catch { return tracks; }
    if (!Array.isArray(picks) || !picks.length) return tracks;
    const ranked = new Map(picks.filter(p => p && typeof p.trackKey === 'string').map(p => [p.trackKey, p]));
    if (!ranked.size) return tracks;
    return tracks.map(track => {
      const pick = ranked.get(trackId(track));
      if (!pick) return track;
      return { ...track, discovery: { ...track.discovery, llmRank: Number.isSafeInteger(pick.rank) ? pick.rank : null, llmReason: typeof pick.reason === 'string' ? pick.reason : '',
        ...(typeof filter.callId === 'string' && /^[\w-]{1,100}$/.test(filter.callId) ? {modelCallId: filter.callId} : {}) } };
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
    const retained=sameOwner&&Array.isArray(filter.tracks)?(()=>{const unavailable=store?.unavailableKeys?.(now())??new Set();return filter.tracks.filter(track=>track.discovery?.expiresAt>now()&&!unavailable.has(trackId(track)));})():[];
    const source=filter.candidateRevision===candidateRevision?candidates():retained;
    return stamped(source).filter(track => Number.isSafeInteger(track.discovery?.llmRank)&&track.discovery.llmRank>0)
      .sort((a,b) => a.discovery.llmRank - b.discovery.llmRank);
  };
  const refresh = ({ manual = false, signal = null, replenish = false } = {}) => {
    synchronizeAccount();
    if (!enabled) return Promise.resolve({ tracks: [], attempts: [], reason: 'discovery-disabled' });
    if (inflight) return inflight;
    const earliest = manual && lastAttemptAt !== null ? lastAttemptAt + parameters.manualIntervalMs
      :replenish?Math.max(failureUntil,lastAttemptAt===null?0:lastAttemptAt+SUPPLY_POLICY.refreshMs):nextAttemptAt;
    if (now() < earliest) return Promise.resolve({ tracks: usable(), attempts: [], reason: 'refresh-budget' });
    const key = owner, version = generation;
    controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    lastAttemptAt = now(); nextAttemptAt = now() + parameters.intervalMs; state = 'refreshing'; reason = null;
    persist();
    const work = Promise.resolve().then(async () => {
      const seeds=selectRecommendationSeeds({store,now:now(),offset:seedOffset});
      const result = await collectDiscovery({ registry, limit: parameters.limit, signal: combined,seeds });
      if (combined.aborted || generation !== version || accountKey() !== key || !enabled) return { tracks: [], attempts: [], reason: 'cancelled' };
      const succeeded = result.attempts.some(a => a.ok);
      if (succeeded) {
        const seen = new Set(),previous=entries;
        const identity=tracks=>JSON.stringify(tracks.map(t=>[trackId(t),t.title,t.artist,t.discovery?.seedTrackKey]).sort((a,b)=>a[0].localeCompare(b[0])));
        entries = [...result.tracks.map(normalize).filter(Boolean),...previous.filter(t=>t.discovery.expiresAt>now())].filter(track => {
          const id = trackId(track); if (seen.has(id)) return false; seen.add(id); return true;
        }).slice(0, parameters.capacity);
        if(identity(previous)!==identity(entries))candidateRevision = randomUUID();
        seedOffset=(seedOffset+seeds.length)%1_000_000;failureUntil=0;
        lastSuccessAt = now(); state = usable().length ? 'ready' : 'empty';
        reason = usable().length ? null : 'no-unfamiliar-candidates';
        persist();
      } else {
        const signedIn = Object.values(registry.providers).some(p => p.getAccount().status === 'authorized');
        const unavailable = result.attempts.every(a => ['provider_unavailable','capability_unavailable','login_required'].includes(a.code));
        state = usable().length ? 'ready' : !signedIn ? 'login_required' : unavailable ? 'unavailable' : 'error';
        reason = !signedIn ? 'login-required' : unavailable ? 'recommendation-unavailable' : 'refresh-failed';
        nextAttemptAt = now() + parameters.retryMs;
        failureUntil=nextAttemptAt;
        persist();
      }
      onLog({ type: 'discovery', count: usable().length, status: state });
      return { ...result, tracks: stamped(usable()) };
    }).catch(error => {
      if (generation === version && enabled) { state = usable().length ? 'ready' : 'error'; reason = 'refresh-failed'; nextAttemptAt = now() + parameters.retryMs;failureUntil=nextAttemptAt; persist(); }
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
    playbackRecommendations() {synchronizeAccount();return enabled&&store?approvedPlaybackTracks(store,createHash('sha256').update(owner??'').digest('hex'),now()):[];},
    setEnabled(value) {
      if (enabled === Boolean(value)) return;
      enabled = Boolean(value); generation++;
      if (!enabled) { controller?.abort(); state = 'disabled'; }
      else { state = usable().length ? 'ready' : 'idle'; }
      notify();
    },
    tick({replenish=null}={}) {
      synchronizeAccount();
      if(replenish!==null){if(enabled&&!inflight&&replenish)void refresh({replenish:true});return;}
      if (enabled && !inflight && now() >= nextAttemptAt && (usable().length < parameters.lowWater || entries.some(t => t.discovery.expiresAt <= now()))) void refresh();
    },
    clear() { generation++; candidateRevision = randomUUID(); controller?.abort(); entries = []; lastSuccessAt = null;lastAttemptAt=null;nextAttemptAt = 0;seedOffset=0;failureUntil=0; state = enabled ? 'idle' : 'disabled';
      try { store?.removeSetting?.('discovery_filter_v1');store?.removeSetting?.(APPROVED_POOL_KEY);store?.removeSetting?.(REVIEW_KEY); } catch { /* nothing to keep */ }
      persist(); notify(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { generation++; enabled = false; controller?.abort(); listeners.clear(); },
  };
}
