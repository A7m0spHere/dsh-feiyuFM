// A bounded background discovery cache. Selection never waits for network I/O.
import { trackId, normalizeTrack } from './contracts.mjs';
import { collectDiscovery } from './providers/coordinator.mjs';
export const DISCOVERY_PARAMETERS = Object.freeze({ limit: 40, capacity: 200, ttlMs: 6 * 60 * 60_000,
  lowWater: 10, intervalMs: 30 * 60_000, manualIntervalMs: 60_000, retryMs: 5 * 60_000 });
export function createDiscoveryCache({ registry, store = null, now = () => Date.now(), onLog = () => {}, parameters = DISCOVERY_PARAMETERS } = {}) {
  let enabled = false, entries = [], lastAttemptAt = null, lastSuccessAt = null, nextAttemptAt = 0;
  let state = 'disabled', reason = null, generation = 0, inflight = null, controller = null;
  let owner = null;
  const listeners = new Set();
  const normalize = track => {
    try {
      const basic = normalizeTrack(track);
      const origin = track.discovery ?? {};
      return { ...basic, discovery: {
        source: ['netease_daily','netease_personal_fm','platform_recommendation'].includes(origin.source) ? origin.source : 'platform_recommendation',
        seedTrackKey: typeof origin.seedTrackKey === 'string' && /^[\w:.-]{1,100}$/.test(origin.seedTrackKey) ? origin.seedTrackKey : null,
        fetchedAt: Number.isFinite(origin.fetchedAt) ? origin.fetchedAt : now(),
        expiresAt: Math.min(Number.isFinite(origin.expiresAt) ? origin.expiresAt : now() + parameters.ttlMs, now() + parameters.ttlMs),
      } };
    } catch { return null; }
  };
  const accountKey = () => Object.entries(registry.providers).map(([name, provider]) => {
    const a = provider.getAccount(); return `${name}:${a.status}:${a.accountId ?? ''}`;
  }).sort().join('|');
  const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* UI is optional. */ } });
  const persist = () => store?.setSetting('discovery_cache_v1', { owner, entries, lastSuccessAt, lastAttemptAt, nextAttemptAt });
  const synchronizeAccount = () => {
    const key = accountKey();
    if (key === owner) return;
    owner = key; generation++; controller?.abort(); entries = []; lastSuccessAt = null;
    lastAttemptAt = null; nextAttemptAt = 0; reason = null; state = enabled ? 'idle' : 'disabled';
    persist(); notify();
  };
  owner = accountKey();
  const saved = store?.getSetting('discovery_cache_v1');
  if (saved?.owner === owner && Array.isArray(saved.entries)) {
    entries = saved.entries.slice(0, parameters.capacity).map(normalize).filter(Boolean);
    lastSuccessAt = saved.lastSuccessAt ?? null;
    lastAttemptAt = Number.isFinite(saved.lastAttemptAt) ? saved.lastAttemptAt : null;
    nextAttemptAt = Number.isFinite(saved.nextAttemptAt) ? saved.nextAttemptAt : 0;
  }
  const usable = () => entries.filter(track => {
    const expiry = track.discovery?.expiresAt;
    return Number.isFinite(expiry) && expiry > now()
      && !store?.getEnvironmentEntry(track) && !store?.hasEffectiveListen(track)
      && (!store || store.isTrackAvailable(track, now()));
  });
  const status = () => {
    synchronizeAccount();
    const tracks = usable();
    return { state: !enabled ? 'disabled' : inflight ? 'refreshing' : state === 'ready' && !tracks.length ? 'empty' : state,
      count: enabled ? tracks.length : 0, cached: tracks.length, lastAttemptAt, lastSuccessAt, nextAttemptAt,
      reason, sources: [...new Set(tracks.map(t => t.discovery?.source).filter(Boolean))], refreshing: Boolean(inflight) };
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
      const result = await collectDiscovery({ registry, limit: parameters.limit, signal: combined });
      if (combined.aborted || generation !== version || accountKey() !== key || !enabled) return { tracks: [], attempts: [], reason: 'cancelled' };
      const succeeded = result.attempts.some(a => a.ok);
      if (succeeded) {
        const seen = new Set();
        entries = result.tracks.map(normalize).filter(Boolean).filter(track => {
          const id = trackId(track); if (seen.has(id)) return false; seen.add(id); return true;
        }).slice(0, parameters.capacity);
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
      return { ...result, tracks: usable() };
    }).catch(error => {
      if (generation === version && enabled) { state = usable().length ? 'ready' : 'error'; reason = 'refresh-failed'; nextAttemptAt = now() + parameters.retryMs; persist(); }
      onLog({ type: 'discovery-error', code: error.code ?? 'provider_failure' });
      return { tracks: combined.aborted ? [] : usable(), attempts: [], reason: combined.aborted ? 'cancelled' : 'refresh-failed' };
    }).finally(() => { if (inflight === work) { inflight = null; controller = null; } notify(); });
    inflight = work; notify();
    return work;
  };
  return {
    tracks() { synchronizeAccount(); return enabled ? usable() : []; }, status, refresh,
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
    clear() { generation++; controller?.abort(); entries = []; lastSuccessAt = null; nextAttemptAt = 0; state = enabled ? 'idle' : 'disabled'; persist(); notify(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { generation++; enabled = false; controller?.abort(); listeners.clear(); },
  };
}
