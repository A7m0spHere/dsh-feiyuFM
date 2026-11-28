import { playbackSourceView } from './playback-source.mjs';
import { publicMusicAccount } from './music-account.mjs';
import { randomUUID } from 'node:crypto';
import { assertCommand, MusicError, normalizeTrack, PLAYABILITY_CHECK_BATCH_SIZE, PROVIDERS, trackId, UNAVAILABLE_BACKOFF_MS } from './contracts.mjs';
import {setTrackFeedback,resetRecommendationTaste,undoRecommendationReset} from './feedback.mjs';
import {modelRecommendations} from './model-recommendations.mjs';
import {createSelector} from './selection.mjs';
import {initializeRecentPlayback,recentPlayback,recordPlaybackStart} from './recent-playback.mjs';

async function resolveWithTimeout(provider, track, signal, version, timeoutMs) {
  const attempt = new AbortController();
  const combined = AbortSignal.any([signal, attempt.signal]);
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      provider.resolve(track, { signal: combined, version }),
      new Promise((_, reject) => {
        onAbort = () => reject(new MusicError('cancelled', 'Resolve was cancelled'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          attempt.abort();
          reject(new MusicError('provider_timeout', 'Provider resolve timed out', { retryable: true }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Bounds a shared resolve without cancelling the underlying request. */
function withTimeout(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new MusicError('provider_timeout', 'Provider resolve timed out', { retryable: true })); }, timeoutMs);
    const onAbort = () => { cleanup(); reject(new MusicError('cancelled', 'Resolve was cancelled')); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    // Always observe the shared request, even when the caller already aborted.
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const MAX_AUTO_FAILURES = 2;
export const MAX_UNAVAILABLE_SKIPS = 8;

const DEFAULT_SETTINGS = Object.freeze({
  listening: true,
  humanPlayback: true,
  volume: 0.35,
  discovery: true,
  discoveryRate: 0.2,
  strategy: 'normal',
});

/**
 * Keeps the expiry map from growing: it only needs the current play instance and
 * a few recent ones, never the whole history.
 */
function _pruneExpiries(map, now, keepMs = 10 * 60 * 1000, max = 32) {
  for (const [id, entry] of map) {
    const expiry = entry.expiresAt ?? (entry.resolvedAt + keepMs);
    if (now - expiry > keepMs) map.delete(id);
  }
  if (map.size > max) {
    const ordered = [...map.entries()].sort((a, b) => a[1].resolvedAt - b[1].resolvedAt);
    for (const [id] of ordered.slice(0, map.size - max)) map.delete(id);
  }
}

export class MusicCore {
  constructor({ store, provider, playback, selector = null, onListened = null, onLog = () => {}, prefetchDelayMs = 3000, clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } }) {
    if (!store || !provider || !playback) throw new Error('store, provider and playback are required');
    this.store = store;
    this.provider = provider;
    this.playback = playback;
    // Ordinary next and autonomy share the policy; an explicit point request
    // remains the user's intentional replay exception.
    this.selector = selector;
    /**
     * The session currently being used, set by the host from session events.
     * It is recorded with each listen so a transient session's influence can be
     * bounded; it never changes playback behaviour on its own.
     */
    this.currentSessionId = null;
    /**
     * When each play instance's resolved handle expires. A platform URL is time
     * limited (NetEase reports `expi`), so a track can outlive its handle; this
     * is bounded and pruned, never persisted, because a handle must not reach
     * storage.
     */
    this.resourceExpiries = new Map();
    // Optional growth hook, called once per recorded listen. Policy lives in
    // src/growth.mjs so the core stays free of taste rules.
    this.onListened = onListened;
    this.onLog = onLog;
    this.clock = clock;
    // The selector already filters unavailable tracks with the same clock; a
    // second per-track check here doubled the queries for every candidate.
    this.queueSelector=createSelector({store,now:()=>clock.now()});
    const saved = store.getCoreState();
    this.state = saved ? {
      ...saved,
      decisionVersion: saved.decisionVersion ?? 0,
      paused: true,
      status: saved.current ? 'paused' : 'idle',
    } : {
      revision: 0, commandVersion: 0, decisionVersion: 0, settings: { ...DEFAULT_SETTINGS },
      queue: [], current: null, paused: true, status: 'idle', blockUntil: null,
      lastError: null,
    };
    this.state.settings = { ...DEFAULT_SETTINGS, ...this.state.settings };
    if (!Number.isFinite(this.state.settings.volume) || this.state.settings.volume <= 0 || this.state.settings.volume > 1) {
      this.state.settings.volume = DEFAULT_SETTINGS.volume;
    }
    this.volumeRevision = 0;
    this.state.volumeError = null;
    this.state.commandVersion += 1;
    this.state.seekPending = null;
    this.state.seekError = null;
    if (this.state.current) {
      if(this.state.current.selectedBy==='user'&&!this.state.current.selectionTrigger)this.state.current.selectionTrigger='legacy-unknown';
      this.state.current.effectiveMs ??= 0;
      this.state.current.agentEffectiveMs ??= 0;
      this.state.current.audibleMs ??= 0;
    }
    this.autoFailures = 0;
    this.unavailableSkips = 0;
    this.availabilityProbedInChain = false;
    this.abortController = null;
    // 显式回退触发的一次发现刷新等待；只保存内存状态，不落盘。
    this.discoveryRefresh = null;
    this.tasks = new Set();
    // Resolved platform handles are reusable until they expire; the next track's
    // URL is prefetched while the current one plays so a switch does not wait
    // for the platform. Prefetch is advisory: a miss only means resolve runs on
    // demand, exactly as before.
    this.resourceCache = new Map();
    this.resolveInflight = new Map();
    this.prefetchTimer = null;
    this.prefetchAbort = null;
    this.prefetchDelayMs = prefetchDelayMs;
    // Track whose media is already open in the host's standby player.
    this.preloadedTrackKey = null;
    initializeRecentPlayback(store);
    this.store.setCoreState(this.state);
  }

  snapshot() {
    const started = performance.now();
    const discovery = this.provider.discoveryStatus ? this.provider.discoveryStatus() : null;
    const afterDiscovery = performance.now();
    const musicAccount = publicMusicAccount(this.store);
    const value = structuredClone({ ...this.state, ...(musicAccount ? { musicAccount } : {}), playbackSource: playbackSourceView(this.store), ...(discovery ? { discovery } : {}), navigation: this._navigationView(),
      playbackCapabilities: { seek: this.playback.canSeek?.({ playInstanceId: this.state.current?.playInstanceId }) === true } });
    const afterClone = performance.now();
    const durationMs = afterClone - started;
    if (durationMs >= 40) this.onLog({ type: 'slow-op', op: 'snapshot-parts', durationMs: Math.round(durationMs),
      discoveryMs: Math.round(afterDiscovery - started), cloneMs: Math.round(afterClone - afterDiscovery) });
    return value;
  }

  setQueue(tracks) {
    this.state.queue = tracks.map(normalizeTrack);
    this._commit();
    return this.snapshot();
  }

  _commit() {
    const started = performance.now();
    this.state.revision += 1;
    this.store.setCoreState(this.state);
    const durationMs = performance.now() - started;
    if (durationMs >= 40) this.onLog({ type: 'slow-op', op: 'commit', durationMs: Math.round(durationMs) });
  }

  _invalidate({ keepResourceKey = null } = {}) {
    this.state.commandVersion += 1;
    this.state.seekPending = null;
    this.state.seekError = null;
    // 任何取代当前等待的用户动作（暂停、点播、换曲、模式切换）都取消在途的
    // 发现刷新等待，迟到结果不再选歌，更不能撤销暂停。
    this._cancelDiscoveryRefresh();
    this.abortController?.abort();
    this.abortController = null;
    this._cancelPrefetch({ keepResourceKey });
    for (const [key, entry] of this.resolveInflight) {
      if (key !== keepResourceKey) this._discardResolve(key, entry);
    }
  }

  /** Stops the advisory prefetch. Never touches the current playback. */
  _cancelPrefetch({ keepResourceKey = null } = {}) {
    if (this.prefetchTimer) { clearTimeout(this.prefetchTimer); this.prefetchTimer = null; }
    const preparation = this.prefetchAbort;
    const entry = preparation && this.resolveInflight.get(preparation.trackKey);
    // Hand the selected track's request to the foreground before cancelling
    // the background waiter. A background signal never owns a shared request.
    if (entry && preparation.trackKey === keepResourceKey) entry.foreground = true;
    preparation?.abort();
    this.prefetchAbort = null;
    if (entry && !entry.foreground) this._discardResolve(preparation.trackKey, entry);
  }

  _discardResolve(key, entry = this.resolveInflight.get(key)) {
    if (!entry) return;
    if (this.resolveInflight.get(key) === entry) this.resolveInflight.delete(key);
    entry.controller.abort();
  }

  cancelSourcePreparation() {
    this._cancelPrefetch();
    this.preloadedTrackKey = null;
    void this.playback.cancelPreload?.().catch?.(() => {});
  }

  suspendProvider(provider) {
    for (const key of this.resourceCache.keys()) if (key.startsWith(`${provider}:`)) this.resourceCache.delete(key);
    for (const key of this.resolveInflight.keys()) if (key.startsWith(`${provider}:`)) this._discardResolve(key);
    if (this.preloadedTrackKey?.startsWith(`${provider}:`) || this.prefetchAbort?.trackKey?.startsWith(`${provider}:`)) this.cancelSourcePreparation();
    if (this.state.current?.track.provider !== provider) return;
    this._finishCurrent('account_changed');
    this._invalidate();
    this.state.current = null;
    this.state.paused = true;
    this.state.status = 'idle';
    this._control('stop', { version: this.state.commandVersion }, true);
    this._commit();
  }

  resetAccountPlayback() {
    this._finishCurrent('account_changed');
    this._invalidate();
    this.cancelSourcePreparation();
    this.resourceCache.clear();
    this.navigation = null;
    this.autoFailures = 0;
    this.unavailableSkips = 0;
    this.availabilityProbedInChain = false;
    Object.assign(this.state, { current: null, queue: [], lastSelection: null, lastError: null, paused: true, status: 'idle' });
    this._control('stop', { version: this.state.commandVersion }, true);
    this._commit();
  }

  _resourceFresh(entry) {
    if (!entry || typeof entry.handle !== 'string') return false;
    if (Number.isSafeInteger(entry.expiresAt)) return entry.expiresAt - this.clock.now() > 60_000;
    return this.clock.now() - entry.resolvedAt < 10 * 60_000;
  }

  _rememberResource(track, resource) {
    const key = trackId(track);
    this.resourceCache.set(key, {
      handle: resource.handle,
      expiresAt: Number.isSafeInteger(resource.expiresAt) ? resource.expiresAt : null,
      resolvedAt: this.clock.now(),
      context: this.provider.resourceContext?.(track) ?? '',
    });
    if (this.resourceCache.size > 8) this.resourceCache.delete(this.resourceCache.keys().next().value);
  }

  /**
   * Resolve one track, reusing a live cached handle and sharing an in-flight
   * request with the prefetcher. The entry owns its provider signal; cancelling
   * a background waiter cannot abort a request claimed by foreground playback.
   */
  _resolveResource(track, signal, version, force = false, { background = false } = {}) {
    const key = trackId(track);
    const context = this.provider.resourceContext?.(track) ?? '';
    const previous = this.resourceCache.get(key);
    if (previous?.context !== undefined && previous.context !== context) this.resourceCache.delete(key);
    if (this.resolveInflight.has(key) && this.resolveInflight.get(key).context !== context) this._discardResolve(key);
    // Recovery must not trust the handle that just failed: force starts a new
    // request even when a cached one still looks fresh.
    if (force) { this.resourceCache.delete(key); this._discardResolve(key); }
    const cached = this.resourceCache.get(key);
    if (this._resourceFresh(cached)) {
      this.onLog({ type: 'resource-source', source: 'cache', trackKey: key, version, background, at: this.clock.now(), playInstanceId: background ? null : this.state.current?.playInstanceId });
      return Promise.resolve({ handle: cached.handle, ...(cached.expiresAt ? { expiresAt: cached.expiresAt } : {}) });
    }
    let inflight = this.resolveInflight.get(key);
    this.onLog({ type: 'resource-source', source: inflight ? 'inflight' : 'provider', trackKey: key, version, background, at: this.clock.now(), playInstanceId: background ? null : this.state.current?.playInstanceId });
    if (!inflight) {
      const controller = new AbortController();
      inflight = { controller, context, foreground: !background, promise: null };
      const entry = inflight;
      // The provider attempt is bounded separately from each foreground wait.
      // A timed-out foreground wait retires it before starting a fresh retry.
      entry.promise = resolveWithTimeout(this.provider, track, controller.signal, version, 15_000)
        .then((resource) => {
          if (context !== (this.provider.resourceContext?.(track) ?? '')) throw new MusicError('cancelled', '账号状态已变化，请重新选择歌曲。');
          if (!controller.signal.aborted && this.resolveInflight.get(key) === entry) this._rememberResource(track, resource);
          return resource;
        })
        .finally(() => {
          if (this.resolveInflight.get(key) === entry) this.resolveInflight.delete(key);
        });
      this.resolveInflight.set(key, inflight);
    }
    if (!background) inflight.foreground = true;
    return withTimeout(inflight.promise, background ? 15_000 : 4000, signal);
  }

  /**
   * Peek at the next autonomous decision without advancing the seeded random
   * stream, so the prefetched track is the one the real command will pick.
   */
  _peekNextDecision({ history = true, manualFallback = true } = {}) {
    const cursor = history ? this._activeNavigation() : null;
    if (cursor && cursor.index < cursor.keys.length - 1) {
      return this._historyCandidate(cursor, this.state.current ? trackId(this.state.current.track) : null, 1);
    }
    const selector = this.selector ?? this.queueSelector;
    if (!selector?.decide || typeof selector.randomState !== 'function' || typeof selector.restoreRandomState !== 'function') return null;
    const saved = selector.randomState();
    try {
      const options = {
        discoveryRate: this.state.settings.discovery ? this.state.settings.discoveryRate : 0,
        at: this.clock.now(),
        excludeTrackKeys: this.state.current ? [trackId(this.state.current.track)] : [],
        queuedTracks: this.state.queue,
      };
      const decision = selector.decide(options);
      // A manual next can use the input library, and then platform discovery
      // candidates already pre-checked as playable, when the approved pool is
      // exhausted. Prepare the same fallbacks without allowing auto playback to
      // choose them or consuming the selector's random stream.
      if (decision?.track || !this.selector || !manualFallback) return decision;
      const library = selector.decide({ ...options, libraryFallback: true });
      return library?.track ? library : selector.decide({ ...options, discoveryFallback: true });
    } finally {
      selector.restoreRandomState(saved);
    }
  }

  _schedulePrefetch() {
    this._cancelPrefetch();
    if (!(this.selector ?? this.queueSelector) || this.state.paused || !this.state.current) return;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      this._prefetchNext().catch(() => {});
    }, Math.max(0, this.prefetchDelayMs));
    this.prefetchTimer.unref?.();
  }

  async _prefetchNext() {
    if (this.state.paused || !this.state.current || this.prefetchAbort) return;
    const decision = this._peekNextDecision();
    const track = decision?.track;
    if (!track) return;
    const key = trackId(track);
    if (!this._resourceFresh(this.resourceCache.get(key)) && !this.resolveInflight.has(key) && this.resolveInflight.size >= 4) return;
    const controller = new AbortController();
    controller.trackKey = key;
    this.prefetchAbort = controller;
    const version = this.state.commandVersion;
    try {
      const resource = await this._resolveResource(track, controller.signal, version, false, { background: true });
      // A host that can hold the next track in a standby player turns the
      // switch into a player swap; the load that the user waits for is gone.
      const ready = this.playback.isPreloaded?.(resource) ?? this.preloadedTrackKey === key;
      if (this.playback.supportsPreload?.() === true && !ready && this._isCurrent(version, controller.signal)) {
        const loaded = await this.playback.preload({ resource, playInstanceId: 'preload:' + key, version, signal: controller.signal });
        // Cancellation belongs to the service token. An old completion must
        // never cancel or claim a newer standby stream.
        if (this._isCurrent(version, controller.signal) && loaded?.preloaded !== false) this.preloadedTrackKey = key;
      }
    } catch { /* advisory only */ } finally {
      if (this.prefetchAbort === controller) this.prefetchAbort = null;
    }
  }

  _isCurrent(version, signal) {
    return this.state.commandVersion === version && !signal.aborted;
  }

  async _probeFallbackAvailability(failed, version) {
    if (this.availabilityProbedInChain || typeof this.provider.checkPlayability !== 'function') return true;
    const providerName = failed?.track?.provider;
    if (!providerName) return true;
    this.availabilityProbedInChain = true;
    const now = this.clock.now();
    const unavailable = this.store.unavailableKeys?.(now) ?? new Set();
    const recent = new Set(recentPlayback(this.store).map(entry => entry.trackKey));
    const banned = new Set(this.store.activeConstraints(now)
      .filter(row => row.kind === 'ban_track' && typeof row.track_key === 'string')
      .map(row => row.track_key));
    const failedKey = trackId(failed.track);
    const seen = new Set([failedKey]);
    const batch = [];
    const addCandidate = (track) => {
      if (!track || track.provider !== providerName || batch.length >= PLAYABILITY_CHECK_BATCH_SIZE) return;
      const key = trackId(track);
      if (seen.has(key) || banned.has(key) || unavailable.has(key) || recent.has(key)) return;
      seen.add(key);
      batch.push(track);
    };
    for (const track of this.provider.discoveryTracks?.() ?? []) addCandidate(track);
    const userInitiatedPool = ['user-start', 'user-next'].includes(failed.selectionTrigger);
    // 显式回退候选同样要预检：否则连跳会把预算花在已知不可播的发现曲上。
    if (userInitiatedPool) for (const track of this.provider.discoveryFallbackTracks?.() ?? []) addCandidate(track);
    if (userInitiatedPool || this.store.getSetting('recommendation_mode_v1') !== 'filtered') {
      for (const row of this.store.listEnvironment({ provider: providerName, limit: 100 })) {
        const track = this.store.getNormalizedTrack({
          provider: row.provider,
          providerTrackId: row.track_key.slice(row.provider.length + 1),
        });
        addCandidate(track);
      }
    }
    if (!batch.length) return true;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      let targetBatch = batch;
      if (typeof this.provider.joinLibraryWarmup === 'function') {
        const warmed = await this.provider.joinLibraryWarmup(providerName, { signal: controller.signal });
        if (version !== this.state.commandVersion || controller.signal.aborted) return false;
        if (warmed && !warmed.skipped && warmed.checked > 0) {
          const refreshedUnavailable = this.store.unavailableKeys?.(this.clock.now()) ?? new Set();
          const checkedKeys = warmed.checkedKeys instanceof Set ? warmed.checkedKeys : null;
          targetBatch = batch.filter(track => {
            const key = trackId(track);
            return !refreshedUnavailable.has(key) && !(checkedKeys?.has(key));
          });
          if (!targetBatch.length) return true;
        }
      }
      const probe = await this.provider.checkPlayability(providerName, targetBatch, { signal: controller.signal });
      if (version !== this.state.commandVersion || controller.signal.aborted) return false;
      if (probe && !probe.skipped && Array.isArray(probe.unplayable) && probe.unplayable.length) {
        const byKey = new Map(targetBatch.map(track => [trackId(track), track]));
        const expiresAt = this.clock.now() + UNAVAILABLE_BACKOFF_MS.media_unavailable;
        for (const key of probe.unplayable) {
          const track = byKey.get(key);
          if (track) this.store.markUnavailable(track, 'media_unavailable', expiresAt);
        }
        this.onLog({ type: 'playback-playability-probe', provider: providerName,
          checked: probe.checked ?? targetBatch.length, playable: probe.playable?.length ?? 0, unplayable: probe.unplayable.length });
      }
      return true;
    } catch (error) {
      if (version !== this.state.commandVersion || controller.signal.aborted || error?.code === 'cancelled') return false;
      if (error?.code === 'login_required') {
        this.state.paused = true;
        this.state.status = 'error';
        this.state.lastError = { code: 'login_required', message: error.message, retryable: false };
        this._commit();
        return false;
      }
      return true;
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  _launch(work, version) {
    const task = Promise.resolve().then(work).catch(async (error) => {
      if (version !== this.state.commandVersion) return;
      const failureError = {
        code: error.code ?? 'internal',
        message: error.message,
        // Whether trying again could help is part of the reason, and a caller
        // cannot tell "do not retry" from "unknown" without it.
        retryable: error.retryable === true,
        ...(error.details?.stage === 'download' ? { details: { stage: 'download' } } : {}),
      };
      this.state.lastError = failureError;
      // Release the track that could not be started. Leaving it as `current`
      // would block every later selection, so one unplayable track would stop
      // music for good. Nothing is recorded: a track that never played is not a
      // listen, and history must not invent one (A10).
      const failed = this.state.current;
      // Classify the failure without leaking the media URL: host open progress
      // and the resource age separate a stalled CDN from an expired handle.
      const expiry = this.resourceExpiries.get(failed?.playInstanceId);
      this.onLog({ type: 'playback-error', code: error.code ?? 'internal', playInstanceId: failed?.playInstanceId,
        ...(Number.isFinite(error.downloadProgress) ? { downloadProgress: error.downloadProgress } : {}),
        ...(Number.isFinite(error.bufferingProgress) ? { bufferingProgress: error.bufferingProgress } : {}),
        ...(Number.isFinite(error.openElapsedMs) ? { openElapsedMs: error.openElapsedMs } : {}),
        ...(Number.isFinite(expiry?.expiresAt) ? { expiresAt: expiry.expiresAt } : {}),
        ...(Number.isFinite(expiry?.resolvedAt) ? { resourceAgeMs: this.clock.now() - expiry.resolvedAt } : {}) });
      const availabilityFailure = ['media_unavailable', 'resource_unavailable'].includes(error.code);
      const candidateFailure = availabilityFailure || ['media_open_timeout', 'media_failed', 'media_download_failed'].includes(error.code);
      // One network stall must not mark a track unplayable for long: a timeout
      // backs off for a minute, media failures for 5 minutes, while an account
      // entitlement refusal (VIP/restricted) backs off for 24 hours.
      if (failed && candidateFailure) {
        const backoffMs = UNAVAILABLE_BACKOFF_MS[error.code] ?? 5 * 60_000;
        this.store.markUnavailable(failed.track, error.code, this.clock.now() + backoffMs);
      }
      if (this.state.current) {
        // A failed recovery still belongs to the listen that already happened.
        // Only a never-started load is discarded without a history row.
        if (this.state.current.startedAt != null) this._finishCurrent('error');
        this.state.current.finished = true;
        this.state.current = null;
        if (this.navigation?.playInstanceId === failed?.playInstanceId) this.navigation.playInstanceId = null;
      }
      const userInitiatedPool = ['user-start', 'user-next'].includes(failed?.selectionTrigger);
      const withinBudget = availabilityFailure
        ? this.unavailableSkips < MAX_UNAVAILABLE_SKIPS
        : this.autoFailures < MAX_AUTO_FAILURES;
      const canSkip = failed?.selectedBy === 'agent' && candidateFailure && withinBudget
        && !this._blockedUntil() && (userInitiatedPool || this.state.settings.listening);
      if (!canSkip) {
        this.state.paused = true;
        this.state.status = 'error';
        this._commit();
        return;
      }
      if (availabilityFailure) this.unavailableSkips++;
      else this.autoFailures++;
      if (availabilityFailure) {
        this.state.paused = false;
        this.state.status = 'selecting';
        this.state.lastError = null;
        this._commit();
        const ok = await this._probeFallbackAvailability(failed, version);
        if (!ok || version !== this.state.commandVersion) return;
      }
      this.state.paused = false;
      this.state.status = 'idle';
      if (userInitiatedPool) {
        try {
          this._selectForUser(failed.selectionTrigger, false, this.clock.now());
        } catch (selectError) {
          this.state.paused = true;
          this.state.status = 'error';
          this.state.lastError = {
            code: availabilityFailure ? 'media_unavailable' : (selectError.code ?? 'no_candidates'),
            message: availabilityFailure
              ? '当前可选曲目对这个账号均无法播放完整版，已自动跳过受限歌曲。'
              : selectError.message,
            retryable: false,
          };
          this._commit();
        }
      } else if (!this.selectAutonomously()) {
        this.state.paused = true;
        this.state.status = 'error';
        this.state.lastError = failureError;
        this._commit();
      }
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  async waitForIdle() {
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }

  _seek(command) {
    const current = this.state.current;
    if (!current || current.playInstanceId !== command.playInstanceId) throw new MusicError('stale_track', '歌曲已经切换，请重新选择播放位置。');
    if (current.finished || !['playing', 'paused'].includes(this.state.status)
      || !this.playback.canSeek?.({ playInstanceId: current.playInstanceId })) throw new MusicError('seek_unsupported', '当前歌曲尚未就绪，或宿主不支持跳转。');
    if (!current.track.durationMs || command.positionMs >= current.track.durationMs) throw new MusicError('invalid_command', '跳转位置超出歌曲时长。');
    this._invalidate();
    const version = this.state.commandVersion;
    const controller = new AbortController();
    this.abortController = controller;
    this.state.seekPending = { playInstanceId: current.playInstanceId, positionMs: command.positionMs };
    const task = Promise.resolve().then(async () => {
      if (!this._isCurrent(version, controller.signal)) return;
      try {
        const result = await this.playback.seek({ playInstanceId: current.playInstanceId, positionMs: command.positionMs, version, signal: controller.signal });
        if (!this._isCurrent(version, controller.signal) || this.state.current !== current) return;
        if (!Number.isFinite(result?.positionMs) || result.positionMs < 0) throw new MusicError('seek_failed', '播放宿主没有返回实际位置。');
        current.positionMs = Math.round(result.positionMs);
        current.progressSource = 'audio';
        this.state.seekPending = null;
        this._commit();
        if (!this.state.paused) this._schedulePrefetch();
      } catch (error) {
        if (!this._isCurrent(version, controller.signal) || this.state.current !== current) return;
        this.state.seekPending = null;
        this.state.seekError = { code: error.code ?? 'seek_failed', message: '播放进度跳转未成功，请重试。' };
        this._commit();
      }
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  _control(method, args, stopOnError = false) {
    const version = args.version;
    this._launch(async () => {
      try {
        await this.playback[method](args);
      } catch (error) {
        if (stopOnError && version === this.state.commandVersion) {
          try { await this.playback.stop({ version }); } catch { /* Keep the original error. */ }
        }
        throw error;
      }
    }, version);
  }

  _syncVolume() {
    const revision = ++this.volumeRevision;
    this.state.volumeError = null;
    const task = Promise.resolve().then(() => {
      if (revision !== this.volumeRevision) return;
      return this.playback.setVolume({ volume: this.state.settings.volume, muted: !this.state.settings.humanPlayback });
    }).catch(error => {
      if (revision !== this.volumeRevision) return;
      this.state.volumeError = { code: error.code ?? 'volume_failed', message: '音量未能同步到播放器，请重试。' };
      this._commit();
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  /** Resume a paused player directly when the host still holds the track. */
  _resumeCurrent() {
    this._invalidate();
    const version = this.state.commandVersion;
    const current = this.state.current;
    this.state.status = 'resolving';
    this._launch(async () => {
      if (this.playback.canResume?.({ playInstanceId: current.playInstanceId })) {
        await this.playback.play({ playInstanceId: current.playInstanceId, version });
        // The service only reports 'started' once per instance, so a direct
        // resume confirms playing from the accepted play command itself.
        if (version === this.state.commandVersion && this.state.current === current) {
          this.state.status = 'playing';
          this.state.lastError = null;
          this._commit();
          this._schedulePrefetch();
        }
        return;
      }
      await this._resolveAndPlay(version);
    }, version);
  }

  _restartCurrent() {
    this._invalidate();
    const version = this.state.commandVersion;
    this.state.status = 'resolving';
    this._launch(() => this._resolveAndPlay(version), version);
  }

  _blockedTrack(track) {
    return this.store.activeConstraints(this.clock.now()).some((row) => row.kind === 'ban_track' && row.track_key === trackId(track));
  }

  _blockedUntil() {
    return this.state.blockUntil !== null && this.state.blockUntil > this.clock.now();
  }

  _finishCurrent(reason) {
    const current = this.state.current;
    if (!current || current.finished) return;
    const recorded = this.store.recordHistory({
      playInstanceId: current.playInstanceId,
      track: current.track,
      selectedBy: current.selectedBy,
      progressSource: current.progressSource,
      effectiveMs: current.effectiveMs ?? 0,
      agentEffectiveMs: current.agentEffectiveMs ?? 0,
      audibleMs: current.audibleMs ?? 0,
      progressAccounting: 'segments-v1',
      durationMs: current.track.durationMs ?? null,
      sessionTransient: current.sessionTransient ?? false,
      startedAt:current.startedAt??null,selectionPool:current.selectionPool??null,decisionId:current.decisionId??null,
      origin: current.origin ?? null,
      agentListening: current.agentListening,
      audible: current.audible,
      endReason: reason,
      endedAt: this.clock.now(),
      // Which session this listen belonged to, so a transient session's
      // influence on long-term preferences can be bounded (A06).
      sessionId: current.sessionId ?? null,
    });
    current.finished = true;
    this.onLog({ type: 'history', playInstanceId: current.playInstanceId,
      selectedBy: current.selectedBy, endReason: reason, trackKey: trackId(current.track), source: current.origin?.source,
      effectiveMs: current.effectiveMs ?? 0, agentEffectiveMs: current.agentEffectiveMs ?? 0, audibleMs: current.audibleMs ?? 0 });
    // Growth is a policy decision, so the core only reports the finished
    // listen; whether it changes anything is decided outside (src/growth.mjs).
    if (recorded && typeof this.onListened === 'function') {
      try {
        this.onListened({
          playInstanceId: current.playInstanceId,
          track: current.track,
          selectedBy: current.selectedBy,
          progressSource: current.progressSource,
          effectiveMs: current.effectiveMs ?? 0,
          agentEffectiveMs: current.agentEffectiveMs ?? 0,
          audibleMs: current.audibleMs ?? 0,
          sessionTransient: current.sessionTransient ?? false,
          agentListening: current.agentListening,
          audible: current.audible,
          endReason: reason,
          durationMs: current.track.durationMs ?? null,
          sessionId: current.sessionId ?? null,
        });
      } catch { /* a growth fault must not break playback */ }
    }
  }

  _select(track, selectedBy, keepPaused, navigation = null) {
    // A preload only pays off for the track that is actually selected next.
    if (this.preloadedTrackKey && (this.preloadedTrackKey !== trackId(track) || keepPaused)) {
      this.preloadedTrackKey = null;
      this.playback.cancelPreload?.().catch?.(() => {});
    }
    const stored=this.store.getTrack(track);
    const enriched=stored ? this.store.getNormalizedTrack(track) : null;
    this._finishCurrent('skipped');
    this._invalidate({ keepResourceKey: keepPaused ? null : trackId(track) });
    const version = this.state.commandVersion;
    this.state.current = {
      track: normalizeTrack(selectedBy==='user'&&enriched ? enriched : {...enriched,...track,artists:track.artists??enriched?.artists}), playInstanceId: randomUUID(), selectedBy,
      decisionId: selectedBy === 'agent' ? this.state.lastSelection?.decisionId ?? randomUUID() : randomUUID(),
      positionMs: 0, effectiveMs: 0, agentEffectiveMs: 0, audibleMs: 0,
      progressSource: 'audio', agentListening: false, audible: false, finished: false,
      // The session that caused this listen, if any. A user's own pick carries
      // whatever session made it; autonomous playback carries the active one.
      sessionId: this.currentSessionId ?? null,
      sessionTransient: this.currentSessionTransient ?? false,
      selectionPool:selectedBy==='agent'?this.state.lastSelection?.pool??'queue':'user',startedAt:null,
      selectionTrigger:selectedBy==='agent'?this.state.lastSelection?.trigger??'automatic':'user-track',
      origin: selectedBy === 'agent' ? track.discovery ?? null : null,
    };
    // Only explicit history traversal retains this fixed snapshot. Point
    // requests and fresh recommendations establish a new live anchor.
    this.navigation = navigation ? { ...navigation, playInstanceId: this.state.current.playInstanceId } : null;
    this.store.upsertTrack(this.state.current.track, this.clock.now());
    const rngState = this.selector?.randomState?.();
    if (Number.isSafeInteger(rngState)) this.state.selectionRngState = rngState;
    this.state.paused = keepPaused;
    this.state.status = keepPaused ? 'paused' : 'resolving';
    this.state.lastError = null;
    this._commit();
    this.onLog({ type: 'selected', version, at: this.clock.now(), playInstanceId: this.state.current.playInstanceId, trackKey: trackId(track), selectedBy, decisionId: this.state.current.decisionId, pool: selectedBy === 'agent' ? this.state.lastSelection?.pool : 'user' });
    if (keepPaused) this._control('stop', { version });
    else this._launch(() => this._resolveAndPlay(version), version);
  }

  async _resolveAndPlay(version, { forceResolve = false } = {}) {
    const current = this.state.current;
    if (!current) return;
    const controller = new AbortController();
    this.abortController = controller;
    const stage = async (phase, work) => {
      const started = performance.now();
      try { return await work(); }
      // Diagnostics must never replace the failure being reported: a throwing
      // logger would otherwise turn a named playback error into "internal".
      finally {
        try { this.onLog({ type: 'playback-stage', phase, playInstanceId: current.playInstanceId, durationMs: Math.round(performance.now() - started) }); }
        catch { /* A logger fault is not a playback fault. */ }
      }
    };
    // Stop and resolve are independent. Waiting for the host to tear down the
    // old stream before asking the platform for the next URL added the two
    // phases together (measured 0.3-4.6 s + 0.7-9.5 s); they now overlap and
    // load still runs only after both settle.
    // A host that replaces the source on Open() needs no explicit stop: the
    // old stream keeps playing until the new one is ready, and Stop()+Close()
    // (measured up to 4.6 s on a network stream) leaves the critical path.
    const reuseSwitch = this.playback.supportsReuseSwitch?.() === true;
    let stopError = null;
    const stopTask = reuseSwitch
      ? Promise.resolve()
      : stage('stop', () => this.playback.stop({ version })).catch((error) => { stopError = error; });
    let resource;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          resource = await stage('resolve', () => this._resolveResource(current.track, controller.signal, version, forceResolve));
          break;
        } catch (error) {
          if (!this._isCurrent(version, controller.signal)) { await stopTask; return; }
          // Never retry the same timed-out shared Promise or let its late
          // result repopulate the cache after a new attempt has taken over.
          if (error.code === 'provider_timeout') this._discardResolve(trackId(current.track));
          if (!error.retryable || attempt === 1) throw error;
          forceResolve = true;
          await this.clock.sleep(100 * (attempt + 1), controller.signal);
          if (!this._isCurrent(version, controller.signal)) { await stopTask; return; }
        }
      }
    } catch (error) {
      await stopTask;
      // With source replacement the old track is still audible; a failed switch
      // must silence it before the error state is published.
      if (reuseSwitch) { try { await this.playback.stop({ version }); } catch { /* keep the original error */ } }
      throw error;
    }
    await stopTask;
    if (stopError) throw stopError;
    if (!this._isCurrent(version, controller.signal)) return;
    if (!resource || typeof resource.handle !== 'string' || !resource.handle) {
      throw new MusicError('resource_unavailable', 'Provider returned no playable resource');
    }
    // One round trip when the host can mute + start inside load. The old
    // three-command sequence cost a host tick per step and could be superseded
    // by a pause between them.
    const autoplay = this.playback.supportsAutoplay?.() === true;
    const muted = !this.state.settings.humanPlayback;
    const standbyReady = this.playback.isPreloaded?.(resource) ?? this.preloadedTrackKey === trackId(current.track);
    const usePreload = standbyReady && this.playback.supportsPreload?.() === true;
    this.onLog({ type: 'load-start', version, playInstanceId: current.playInstanceId, at: this.clock.now(), standbyReady, usePreload });
    this.preloadedTrackKey = null;
    const loaded = await stage('load', () => this.playback.load({ resource, playInstanceId: current.playInstanceId,
      startPositionMs: current.positionMs, version, signal: controller.signal, muted, volume: this.state.settings.volume, autoplay, usePreload }));
    if (!this._isCurrent(version, controller.signal)) return;
    // A platform handle is time limited. Remembering when it expires is what
    // lets the core recover instead of failing the track when it goes stale.
    const previousExpiry = this.resourceExpiries.get(current.playInstanceId);
    this.resourceExpiries.set(current.playInstanceId, {
      expiresAt: Number.isSafeInteger(resource.expiresAt) ? resource.expiresAt : null,
      resolvedAt: this.clock.now(),
      // Re-resolving must not clear the guard, or an unplayable track would be
      // retried forever.
      reResolved: previousExpiry?.reResolved ?? false,
    });
    _pruneExpiries(this.resourceExpiries, this.clock.now());
    const actualPositionMs = loaded?.positionMs ?? 0;
    if (!Number.isFinite(actualPositionMs) || actualPositionMs < 0) {
      throw new MusicError('invalid_playback_position', 'Playback reported invalid loaded position');
    }
    if (actualPositionMs !== current.positionMs) {
      current.positionMs = actualPositionMs;
      current.progressSource = 'audio';
      this._commit();
    }
    if (!autoplay) {
      await stage('mute', () => this.playback.setMuted({ muted: !this.state.settings.humanPlayback, version }));
      if (!this._isCurrent(version, controller.signal)) return;
      await stage('play', () => this.playback.play({ playInstanceId: current.playInstanceId, version }));
    }
  }

  dispatch(rawCommand) {
    const command = assertCommand(rawCommand);
    if (this.store.hasCommand(command.commandId)) return this.snapshot();
    if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) {
      throw new MusicError('stale_revision', 'Refresh snapshot before sending this command');
    }
    const now = this.clock.now();
    switch (command.type) {
      case 'seek':
        this._seek(command);
        break;
      case 'pause':
        this._invalidate();
        // The host cancels the standby stream inside the pause command itself;
        // a separate cancel would queue in front of the pause and add ~300 ms.
        this.preloadedTrackKey = null;
        this.state.paused = true;
        this.state.status = this.state.current ? 'paused' : 'idle';
        this._control('pause', { version: this.state.commandVersion }, true);
        break;
      case 'resume':
        this.autoFailures = 0;
        this.unavailableSkips = 0;
        this.availabilityProbedInChain = false;
        if (this.state.paused || this.state.status !== 'playing') {
          this.state.paused = false;
          if (this.state.current) this._resumeCurrent();
        }
        break;
      case 'next':
        this.autoFailures = 0;
        this.unavailableSkips = 0;
        this.availabilityProbedInChain = false;
        if (!this._forwardTrack()) this._selectForUser('user-next', this.state.paused, now);
        break;
      case 'previous':
        this._previousTrack();
        break;
      case 'requestTrack':
        this.autoFailures = 0;
        this.unavailableSkips = 0;
        this.availabilityProbedInChain = false;
        if (this._blockedTrack(command.track)) throw new MusicError('constraint_conflict', 'Track is banned by a user constraint');
        this._select(command.track, 'user', false);
        break;
      case 'setListening':
        this.state.settings.listening = command.value;
        if (!command.value && this.state.current?.selectedBy === 'agent') {
          this._invalidate();
          this.state.paused = true;
          this.state.status = 'paused';
          this._control('pause', { version: this.state.commandVersion }, true);
        }
        break;
      case 'setHumanPlayback':
        this.state.settings.humanPlayback = command.value;
        if (this.state.current && !this.state.paused && this.state.status === 'resolving') {
          this._restartCurrent();
        } else {
          if (this.state.current && !this.state.paused) this._invalidate();
          this._control('setMuted', { muted: !command.value, version: this.state.commandVersion }, !command.value);
        }
        break;
      case 'setVolume':
        if (command.value > 0) this.state.settings.volume = command.value;
        else if (command.previousVolume !== undefined) this.state.settings.volume = command.previousVolume;
        this.state.settings.humanPlayback = command.value > 0;
        this._syncVolume();
        break;
      case 'setDiscovery': this.state.settings.discovery = command.value; break;
      case 'setDiscoveryRate': this.state.settings.discoveryRate = command.value; break;
      case 'setMode':
        if (command.value === 'off') {
          this._invalidate();
          this.state.settings.listening = false;
          this.state.settings.humanPlayback = false;
          this.state.paused = true;
          this.state.status = this.state.current ? 'paused' : 'idle';
          this._control('pause', { version: this.state.commandVersion }, true);
          this._control('setMuted', { muted: true, version: this.state.commandVersion }, true);
        } else {
          const wasPlaying = this.state.current && !this.state.paused && this.state.status === 'playing';
          this.state.settings.listening = true;
          if (command.value === 'silent') {
            this.state.settings.humanPlayback = false;
          } else {
            this.state.settings.strategy = command.value;
            // 日常/专注承诺保留声音：从静音状态切回来必须恢复输出，
            // 否则按钮看起来没有生效，声音也回不来。
            if (!this.state.settings.humanPlayback) {
              this.state.settings.humanPlayback = true;
              if (wasPlaying) {
                this._invalidate();
                this._control('setMuted', { muted: false, version: this.state.commandVersion }, true);
              }
            }
          }
          this.state.paused = false;
          if (this.state.current && !wasPlaying) this._restartCurrent();
          else if (wasPlaying && command.value === 'silent') {
            this._invalidate();
            this._control('setMuted', { muted: true, version: this.state.commandVersion }, true);
          }
        }
        break;
      case 'stopForToday': {
        this._invalidate();
        const date = new Date(now);
        date.setHours(24, 0, 0, 0);
        this.state.blockUntil = date.getTime();
        this.store.addConstraint({ id: 'stop-today', kind: 'autonomy_until', expiresAt: this.state.blockUntil,
          createdAt: now, summary: 'User stopped autonomous listening for today' });
        this.state.paused = true;
        this.state.status = this.state.current ? 'paused' : 'idle';
        this._control('pause', { version: this.state.commandVersion }, true);
        break;
      }
      case 'chooseSelf':
        this.autoFailures = 0;
        this.unavailableSkips = 0;
        this.availabilityProbedInChain = false;
        this.store.removeConstraint('stop-today');
        this.state.blockUntil = null;
        this.state.settings.listening = true;
        const shouldRestart = this.state.current && (this.state.paused || this.state.status !== 'playing');
        this.state.paused = false;
        if (shouldRestart) this._restartCurrent();
        break;
      case 'banTrack':
        this.store.addConstraint({ id: `ban:${trackId(command.track)}`, kind: 'ban_track',
          track: command.track, createdAt: now, summary: command.summary ?? '' });
        break;
      case 'unbanTrack': this.store.removeConstraint(`ban:${trackId(command.track)}`); break;
      case 'setTrackFeedback':
        if (this.state.current?.playInstanceId !== command.playInstanceId || trackId(this.state.current.track) !== trackId(command.track)) throw new MusicError('stale_track', '歌曲已经切换，请对当前歌曲重新反馈。');
        setTrackFeedback(this.store, this.state.current.track, command.value, now);
        break;
      case 'resetTaste': resetRecommendationTaste(this.store, this.state, { clearFeedback:command.value.clearFeedback, now,commandId:command.commandId }); break;
      case 'resetLibrary': {
        const before=structuredClone(this.state);
        try{this.store.transaction(()=>{resetRecommendationTaste(this.store, this.state, { clearFeedback:command.value.clearFeedback,clearLibrary:true,now,commandId:command.commandId });this.state.queue=[];this._commit();});}
        catch(error){this.state=before;throw error;}break;
      }
      case 'undoTasteReset': {
        const before=structuredClone(this.state);
        try{this.store.transaction(()=>{const restored=undoRecommendationReset(this.store,{commandId:command.commandId,now});if(Array.isArray(restored.queue))this.state.queue=restored.queue;this._commit();});}
        catch(error){this.state=before;throw error;}break;
      }
      case 'setRecommendationMode':this.store.setSetting('recommendation_mode_v1',command.value);break;
    }
    this.state.decisionVersion += 1;
    if(!this.store.hasCommand(command.commandId)) this.store.recordCommand(command.commandId, now);
    this._commit();
    if ((command.type === 'resume' || command.type === 'chooseSelf' ||
      (command.type === 'setMode' && command.value !== 'off')) && !this.state.current) {
      // 用户主动要求开始听歌却没有任何候选时必须说出原因：静默返回会让
      // 「开始听歌」「恢复自主听歌」看起来像坏了的按钮。
      if (this._blockedUntil()) {
        throw new MusicError('autonomy_blocked', '今天已停止自主听歌。点击提示条里的「恢复自主听歌」即可重新开启。');
      }
      if (command.type === 'resume' && this.state.settings.listening) {
        // An explicit start can use the input library, as an explicit next can.
        this._selectForUser('user-start', false, now);
      } else if (!this.selectAutonomously()) {
        throw new MusicError('no_candidates', this._noCandidatesReason(false, this.state.lastSelection?.reason));
      }
    }
    return this.snapshot();
  }

  _selectForUser(trigger, keepPaused, at, { refreshDiscovery = true } = {}) {
    const selector = this.selector ?? this.queueSelector;
    const options = {
      discoveryRate: this.state.settings.discovery ? this.state.settings.discoveryRate : 0,
      at,
      excludeTrackKeys: this.state.current ? [trackId(this.state.current.track)] : [],
      queuedTracks: trigger === 'user-start' && this.selector ? [] : this.state.queue,
    };
    let decision = selector.next(options);
    let recentBlocked = decision?.reason === 'recent-window-exhausted';
    // 显式用户操作的回退链：① 入选池 → ② 输入曲库 → ③ 平台已预检可播的发现
    // 候选。自动续播（selectAutonomously）不经过这里，仍只播入选曲；三段都
    // 遵守当前曲排除与最近 50 次硬窗口。
    if (this.selector && !decision?.track) {
      decision = selector.next({ ...options, libraryFallback: true });
      recentBlocked ||= decision?.reason === 'recent-window-exhausted';
      if (decision?.track) {
        decision = { ...decision, fellBack: true,
          fallbackReason: '推荐歌单暂时没有可播的曲目，已回退你的输入曲库' };
      }
    }
    if (this.selector && !decision?.track) {
      decision = selector.next({ ...options, discoveryFallback: true });
      recentBlocked ||= decision?.reason === 'recent-window-exhausted';
      if (decision?.track) {
        decision = { ...decision, fellBack: true,
          fallbackReason: '推荐歌单与输入曲库暂无未播曲目，已从平台相似推荐选取可播歌曲' };
      }
    }
    if (!decision?.track) {
      const reason = recentBlocked ? 'recent-window-exhausted' : decision?.reason;
      // 缓存里暂时没有可播候选时，允许一次有界、可被暂停／换曲取消的平台发现
      // 刷新，刷新后再走一次同一条回退链。刷新不发模型请求，也不阻塞状态读取。
      if (refreshDiscovery && this.selector && this._canRefreshDiscovery()) {
        this._refreshDiscoveryForUser(trigger, keepPaused, reason);
        return;
      }
      throw new MusicError('no_candidates', this._noCandidatesReason(true, reason));
    }
    this._applyRecommendation(decision, { trigger, keepPaused });
  }

  /** 显式回退能否再刷新一次平台发现：需要发现能力、探索开启且账号已就绪。 */
  _canRefreshDiscovery() {
    if (typeof this.provider?.refreshDiscovery !== 'function') return false;
    if (!this.state.settings.discovery || !(this.state.settings.discoveryRate > 0)) return false;
    const status = this.provider.discoveryStatus?.() ?? null;
    return status?.state !== 'disabled' && status?.state !== 'login_required';
  }

  /**
   * 手动开始／下一首在三个池都空时的一次发现刷新。保持用户原本的暂停意图，
   * 只把状态标成找歌；任何新用户命令（含暂停）经 _invalidate 取消等待，迟到
   * 结果不选歌、不撤销暂停。
   *
   * 失败后的状态必须与扬声器一致：刷新前原曲仍在播放且没被切走时，保持
   * `playing` 并只把缺少候选记进 lastError，绝不把界面改成暂停／错误却继续
   * 出声；其余情况先取消可能仍在进行的旧解析，再真正暂停播放器。
   */
  _refreshDiscoveryForUser(trigger, keepPaused, reason) {
    this._cancelDiscoveryRefresh();
    const controller = new AbortController();
    const version = this.state.commandVersion;
    const entry = { controller, version };
    this.discoveryRefresh = entry;
    const prior = {
      playInstanceId: this.state.current?.playInstanceId ?? null,
      playing: Boolean(this.state.current) && !this.state.paused && this.state.status === 'playing',
    };
    this.state.status = 'selecting';
    this.state.paused = keepPaused;
    this.state.lastError = null;
    this._commit();
    this.onLog({ type: 'selection-refresh', trigger, reason: reason ?? null });
    const task = (async () => {
      try {
        await Promise.race([
          Promise.resolve(this.provider.refreshDiscovery({ manual: true, signal: controller.signal })),
          new Promise((_, reject) => {
            const abort = () => reject(new MusicError('cancelled', '发现刷新已取消'));
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener('abort', abort, { once: true });
          }),
        ]);
      } catch (error) {
        if (version !== this.state.commandVersion || controller.signal.aborted) return;
        this.onLog({ type: 'selection-refresh-error', trigger, code: error?.code ?? 'provider_failure' });
      }
      if (version !== this.state.commandVersion || controller.signal.aborted) return;
      try {
        this._selectForUser(trigger, keepPaused, this.clock.now(), { refreshDiscovery: false });
      } catch (error) {
        if (version !== this.state.commandVersion) return;
        const stillPlaying = prior.playing && this.state.current
          && this.state.current.playInstanceId === prior.playInstanceId && !this.state.current.finished;
        this.state.lastError = { code: error.code ?? 'no_candidates', message: error.message, retryable: false };
        if (stillPlaying) {
          // 用户只是请求下一首，原曲没有被切走：让它继续播放，只报告没有新歌。
          this.state.paused = false;
          this.state.status = 'playing';
        } else {
          // 先取消可能仍在进行的旧解析，再让播放器真正停下；否则错误态之后
          // 迟到的解析会突然起播，界面与声音再次不一致。
          this._invalidate();
          if (this.state.current) this._control('pause', { version: this.state.commandVersion }, true);
          this.state.paused = true;
          this.state.status = 'error';
        }
        this._commit();
      }
    })().finally(() => { if (this.discoveryRefresh === entry) this.discoveryRefresh = null; });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  _cancelDiscoveryRefresh() {
    const pending = this.discoveryRefresh;
    if (!pending) return;
    this.discoveryRefresh = null;
    pending.controller.abort();
  }

  /** 为什么现在没有可播放的歌曲，按推荐来源给出可操作的原因。 */
  _noCandidatesReason(fallbackAttempted = false, reason = null) {
    const mode=this.store.getSetting('recommendation_mode_v1',null);
    // 默认 filtered 需要模型才能把平台候选变成歌单。未配置模型时「重新找歌」
    // 无效，必须直接说明缺的是什么，避免用户反复点一个不会生效的按钮。
    if(mode==='filtered'){
      const route=this.store.getSetting('recommendation_route_v1',null);
      const status=this.provider.discoveryStatus?.();
      if(!(route?.provider&&route?.model)&&(fallbackAttempted||status?.referenceCount>0))
        return '还没有配置推荐模型，暂时无法从平台候选里筛出歌单。请到「电台设置」选择模型，或导入更多可播放的歌曲。';
    }
    if(reason==='recent-window-exhausted')return '最近 50 首播放过的歌曲暂不重复，请换一批新歌，也可以明确点播。';
    if(mode==='filtered'){
      const status=this.provider.discoveryStatus?.();
      if(fallbackAttempted&&status?.referenceCount>0)return '推荐歌单、输入曲库和平台相似推荐暂时都没有未播曲目，可以点播其他歌曲或稍后再试。';
      if(status?.refreshing||status?.filtering)return '大肥鱼正在找歌和挑歌，稍后再开始听。';
      if(!status?.picked)return '还没有挑好的歌单，请先导入参考歌曲，再让大肥鱼找一批歌。';
      return '这批歌已经听过、正在播放或暂时不可用，可以换一批，也可以点播参考曲库。';
    }
    if (this.store.getSetting('recommendation_mode_v1') === 'llm') {
      const playlist = modelRecommendations(this.store);
      if (!playlist) return '还没有模型歌单，请先根据歌曲推荐一批。';
      if (!playlist.verified.length) return '推荐歌单还没有确认可播放的歌曲，请查看各首状态后重新确认。';
      return fallbackAttempted
        ? '模型歌单和输入曲库都没有其他可播歌曲：当前曲目、禁播和不可播限制不能放宽，请稍后再试或更新歌单。'
        : '模型歌单暂时没有其他可播歌曲：当前曲目、禁播和不可播限制不能放宽，请稍后再试或更新歌单。';
    }
    return '现在没有可自动播放的歌曲：曲库为空或候选刚播过、被规则排除。';
  }

  selectAutonomously() {
    if (!this.state.settings.listening || this.state.paused || this._blockedUntil() || this.state.current) return false;

    // With a selector, the local decision layer picks from the user's
    // environment and platform candidates; otherwise the fixed debug queue is
    // used. Either way, no user command is involved and nothing is retried
    // when there is nothing to play.
    const decision = (this.selector??this.queueSelector).next({
        discoveryRate: this.state.settings.discovery ? this.state.settings.discoveryRate : 0,
        at: this.clock.now(),
        queuedTracks:this.selector?[]:this.state.queue,
      });
    return this._applyRecommendation(decision,{trigger:'automatic',keepPaused:false});
  }

  _applyRecommendation(decision,{trigger,keepPaused}) {
      const next = decision?.track ?? null;
      this.state.lastSelection = {
        decisionId: randomUUID(),
        trigger,
        at: this.clock.now(),
        trackKey: next ? trackId(next) : null,
        pool: decision?.pool ?? null,
        fellBack: Boolean(decision?.fellBack),
        fallbackReason: decision?.fallbackReason ?? null,
        reason: decision?.reason ?? null,
        discoveryRate: decision?.discoveryRate ?? null,
        score: decision?.score ?? null,
        detail:decision?.detail??null,
        source: next?.discovery?.source ?? null,
        attemptedDiscovery:Boolean(decision?.attemptedDiscovery),
        considered: decision?.considered ?? null,
      };
    this.onLog({ type: 'selection', ...this.state.lastSelection });
    this.store.transaction(()=>{
      if(next){
        if(decision.pool==='queue'){const index=this.state.queue.findIndex(t=>trackId(t)===trackId(next));if(index>=0)this.state.queue.splice(index,1);}
        this._select(next,'agent',keepPaused);
      }else this._commit();
      if(decision){
        const log=this.store.getSetting('decision_history_v1',[]);
        log.push({...this.state.lastSelection,playInstanceId:next?this.state.current.playInstanceId:null});
        this.store.setSetting('decision_history_v1',log.slice(-200));
      }
    });
    if (!next) return false;
    return true;
  }

  onPlaybackEvent(event) {
    const current = this.state.current;
    if (!current || event.playInstanceId !== current.playInstanceId || current.finished) return false;
    if (event.version !== undefined && event.version !== this.state.commandVersion) return false;
    if (event.type === 'positioned') {
      if (!Number.isFinite(event.positionMs) || event.positionMs < 0) return false;
      current.positionMs = current.track.durationMs ? Math.min(event.positionMs, current.track.durationMs) : event.positionMs;
      current.progressSource = 'audio';
      this._commit();
      return true;
    }
    if (event.type === 'started') {
      if (this.state.paused) return false;
      this.state.status = 'playing';
      current.startedAt??=this.clock.now();
      // 播放真正开始即证明解析层错误已过时：过期句柄重解析成功后若保留
      // lastError，界面会在音乐正常播放时继续显示「播放未成功」。
      this.state.lastError = null;
      this.onLog({ type: 'started', version: this.state.commandVersion, playInstanceId: current.playInstanceId, at: this.clock.now() });
      this.store.transaction(()=>{recordPlaybackStart(this.store,current,current.startedAt);this._commit();});
      // The next track's URL is fetched while this one plays, so the next
      // command does not wait for the platform.
      this._schedulePrefetch();
      return true;
    }
    if (event.type === 'progress') {
      if (this.state.paused || !Number.isFinite(event.positionMs)) return false;
      if (event.progressSource === 'logical' && !current.track.durationMs) return false;
      const nextPosition = current.track.durationMs ? Math.min(event.positionMs, current.track.durationMs) : event.positionMs;
      if (nextPosition <= current.positionMs) return false;
      const positionalDelta = nextPosition - current.positionMs;
      const delta = Number.isFinite(event.effectiveDeltaMs)
        ? Math.max(0, Math.min(positionalDelta, event.effectiveDeltaMs)) : positionalDelta;
      // A measured advance also proves playback started if its start event was
      // missing; a seek/position-only update with zero effective delta does not.
      const firstAdvance=delta>0&&!Number.isFinite(current.startedAt);
      if(firstAdvance)current.startedAt=this.clock.now();
      current.effectiveMs = (current.effectiveMs ?? 0) + delta;
      if (current.selectedBy === 'agent' && this.state.settings.listening) current.agentEffectiveMs = (current.agentEffectiveMs ?? 0) + delta;
      if (event.progressSource !== 'logical' && this.state.settings.humanPlayback) current.audibleMs = (current.audibleMs ?? 0) + delta;
      if (current.effectiveMs >= 30_000) {
        this.autoFailures = 0;
        this.unavailableSkips = 0;
        this.availabilityProbedInChain = false;
      }
      current.positionMs = nextPosition;
      current.progressSource = event.progressSource === 'logical' ? 'logical' : 'audio';
      current.agentListening ||= current.selectedBy === 'agent' && this.state.settings.listening;
      current.audible ||= current.progressSource === 'audio' && this.state.settings.humanPlayback;
      // Progress arrives every ~400 ms. Committing every sample bumped the
      // revision (and rewrote the whole state) several times a second, which
      // in turn pushed a full snapshot — including the up-to-100-track pool —
      // down stdout each time. A 2 s cadence keeps the visible progress and the
      // persisted position fresh without that write/publish storm.
      const progressNow = this.clock.now();
      if(firstAdvance){this.lastProgressCommitAt=progressNow;this.store.transaction(()=>{recordPlaybackStart(this.store,current,current.startedAt);this._commit();});}
      else if(progressNow-(this.lastProgressCommitAt??0)>=2000){this.lastProgressCommitAt=progressNow;this._commit();}
      return true;
    }
    if ((event.type === 'ended' || event.type === 'error') && this.state.paused) return false;
    if (event.type === 'ended' || event.type === 'error') {
      // A platform handle is time limited. If this one had expired (or the
      // platform says the media is gone) the track is not necessarily
      // unplayable: re-resolve once before treating it as a failure. Only one
      // retry is allowed, so a genuinely dead track cannot loop.
      if (event.type === 'error') {
        const expiry = this.resourceExpiries.get(current.playInstanceId);
        const at = this.clock.now();
        // A known expiry that has passed is the clear case. An *unknown* expiry
        // is not the same as an expired one: treating it as stale would re-resolve
        // for every unrelated media failure, so only an explicit expiry signal
        // triggers recovery then.
        const knownAndPassed = Boolean(expiry)
          && Number.isSafeInteger(expiry.expiresAt)
          && at >= expiry.expiresAt - 1000;
        const platformSaysGone = event.code === 'media_unavailable' || event.code === 'resource_expired';
        const interrupted = event.code === 'playback_host_lost' || event.code === 'media_stalled'
          || (event.code === 'media_failed' && event.retryable === true);
        if (!(current.recoveryAttempts > 0) && expiry && !expiry.reResolved
          && (knownAndPassed || platformSaysGone || interrupted)) {
          expiry.reResolved = true;
          current.recoveryAttempts = 1;
          // A new version rejects duplicate/late events from the failed player.
          this._invalidate();
          this.state.status = 'resolving';
          this.state.lastError = {
            code: interrupted ? event.code : 'resource_expired',
            message: interrupted ? 'Playback was interrupted, so the current track is being restored'
              : 'the platform handle expired, so it is being resolved again',
          };
          this._commit();
          const version = this.state.commandVersion;
          // The handle just failed; recovery re-resolves instead of reusing it.
          this._launch(() => this._resolveAndPlay(version, { forceResolve: true }), version);
          return true;
        }
      }
      const expectedNext = event.type === 'ended' ? this._peekNextDecision({ history: false, manualFallback: false })?.track : null;
      this._cancelPrefetch({ keepResourceKey: expectedNext ? trackId(expectedNext) : null });
      this._finishCurrent(event.type === 'ended' ? 'ended' : 'error');
      this.state.status = event.type === 'ended' ? 'idle' : 'error';
      if (event.type === 'error') this.state.lastError = { code: event.code ?? 'playback_error', message: event.message ?? 'Playback failed' };
      this.state.current = null;
      if (this.navigation?.playInstanceId === current.playInstanceId) this.navigation.playInstanceId = null;
      this._commit();
      if (event.type === 'ended') this.selectAutonomously();
      else if (current.selectedBy === 'agent' && ['media_unavailable','media_failed','media_open_timeout','media_stalled'].includes(event.code)) {
        const backoffMs = UNAVAILABLE_BACKOFF_MS[event.code] ?? 5 * 60_000;
        this.store.markUnavailable(current.track, event.code, this.clock.now() + backoffMs);
        if (event.code === 'media_unavailable') {
          if (this.unavailableSkips < MAX_UNAVAILABLE_SKIPS) { this.unavailableSkips++; this.selectAutonomously(); }
        } else if (this.autoFailures < MAX_AUTO_FAILURES) {
          this.autoFailures++;
          this.selectAutonomously();
        }
      }
      return true;
    }
    return false;
  }

  /** Fixed, bidirectional history; newly recorded starts never move its anchor. */
  _activeNavigation() {
    return this.navigation && (this.state.current?.playInstanceId ?? null) === this.navigation.playInstanceId
      ? this.navigation : null;
  }

  _previousTrack() {
    const current = this.state.current;
    const currentKey = current ? trackId(current.track) : null;
    const currentInstance = current?.playInstanceId ?? null;
    const cursor = this._activeNavigation() ?? this._historyCursor(currentInstance);
    if (!cursor) throw new MusicError('no_previous', '还没有可以返回的播放记录。');
    const candidate = this._historyCandidate(cursor, currentKey, -1);
    if (!candidate) {
      // 已经到最早一首：保留游标，重复按下仍返回同一个明确错误。
      this.navigation = cursor;
      throw new MusicError('no_previous', '没有更早的可播放歌曲了。');
    }
    this._selectHistory(cursor, candidate, 'previous');
  }

  _forwardTrack() {
    const cursor = this._activeNavigation();
    if (!cursor || cursor.index >= cursor.keys.length - 1) return false;
    const candidate = this._historyCandidate(cursor, this.state.current ? trackId(this.state.current.track) : null, 1);
    if (!candidate) throw new MusicError('no_next_history', '后续历史歌曲均被禁播或暂时不可播放。');
    this._selectHistory(cursor, candidate, 'next');
    return true;
  }

  _selectHistory(cursor, candidate, direction) {
    this.onLog({ type: 'navigation', event: direction, direction, trackKey: trackId(candidate.track) });
    // Explicit replay bypasses the recommendation window, never adds feedback,
    // and accrues history/listening only through the normal playback events.
    this._select(candidate.track, 'user', this.state.paused, { keys: cursor.keys, index: candidate.index });
  }

  /** 当前曲在最近播放历史里的位置；尚未记录的当前曲视为排在最后一条之后。 */
  _historyCursor(currentInstance) {
    const entries = recentPlayback(this.store);
    if (!entries.length) return null;
    const keys = entries.map((entry) => entry.trackKey);
    const recorded = currentInstance ? entries.findIndex((entry) => entry.playInstanceId === currentInstance) : -1;
    if (recorded < 0 && this.state.current) keys.push(trackId(this.state.current.track));
    return { keys, index: recorded >= 0 ? recorded : this.state.current ? keys.length - 1 : keys.length, playInstanceId: currentInstance };
  }

  /** 从游标向前找第一首可播歌曲：跳过当前曲、禁播与不可用，不看自动防重复窗口。 */
  _historyCandidate(cursor, currentKey, direction) {
    const now = this.clock.now();
    const banned = new Set(this.store.activeConstraints(now)
      .filter((row) => row.kind === 'ban_track' && typeof row.track_key === 'string')
      .map((row) => row.track_key));
    for (let index = cursor.index + direction; index >= 0 && index < cursor.keys.length; index += direction) {
      const key = cursor.keys[index];
      if (key === currentKey) continue;
      const track = this._trackFromKey(key);
      if (!track || banned.has(trackId(track)) || !this.store.isTrackAvailable(track, now)) continue;
      return { index, track };
    }
    return null;
  }

  _trackFromKey(key) {
    if (typeof key !== 'string') return null;
    const separator = key.indexOf(':');
    const provider = separator > 0 ? key.slice(0, separator) : '';
    const providerTrackId = separator > 0 ? key.slice(separator + 1) : '';
    if (!PROVIDERS.includes(provider) || !providerTrackId) return null;
    return this.store.getNormalizedTrack({ provider, providerTrackId });
  }

  /** 供 UI 判断「上一首」是否可用；只读，不推进游标。 */
  _navigationView() {
    try {
      const current = this.state.current;
      const currentKey = current ? trackId(current.track) : null;
      const currentInstance = current?.playInstanceId ?? null;
      const cursor = this.navigation && currentInstance === this.navigation.playInstanceId
        ? this.navigation : this._historyCursor(currentInstance);
      return { previous: Boolean(cursor && this._historyCandidate(cursor, currentKey, -1)) };
    } catch {
      // 导航提示只是界面可用性，读取失败不能连累快照本身。
      return { previous: false };
    }
  }
}
