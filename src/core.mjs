import { randomUUID } from 'node:crypto';
import { assertCommand, MusicError, normalizeTrack, PROVIDERS, trackId } from './contracts.mjs';
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

const DEFAULT_SETTINGS = Object.freeze({
  listening: true,
  humanPlayback: true,
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
    this.state.commandVersion += 1;
    if (this.state.current) {
      if(this.state.current.selectedBy==='user'&&!this.state.current.selectionTrigger)this.state.current.selectionTrigger='legacy-unknown';
      this.state.current.effectiveMs ??= 0;
      this.state.current.agentEffectiveMs ??= 0;
      this.state.current.audibleMs ??= 0;
    }
    this.autoFailures = 0;
    this.abortController = null;
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
    const value = structuredClone({ ...this.state, ...(discovery ? { discovery } : {}), navigation: this._navigationView() });
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
      inflight = { controller, foreground: !background, promise: null };
      const entry = inflight;
      // The provider attempt is bounded separately from each foreground wait.
      // A timed-out foreground wait retires it before starting a fresh retry.
      entry.promise = resolveWithTimeout(this.provider, track, controller.signal, version, 15_000)
        .then((resource) => {
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
      // A manual next can use the input library when the approved pool is
      // exhausted. Prepare that same fallback without allowing auto playback
      // to choose it or consuming the selector's random stream.
      return !decision?.track && this.selector && manualFallback
        ? selector.decide({ ...options, libraryFallback: true }) : decision;
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

  _launch(work, version) {
    const task = Promise.resolve().then(work).catch((error) => {
      if (version !== this.state.commandVersion) return;
      this.state.lastError = {
        code: error.code ?? 'internal',
        message: error.message,
        // Whether trying again could help is part of the reason, and a caller
        // cannot tell "do not retry" from "unknown" without it.
        retryable: error.retryable === true,
      };
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
      const candidateFailure = ['media_unavailable', 'resource_unavailable', 'media_open_timeout', 'media_failed'].includes(error.code);
      // One network stall must not mark a track unplayable for long: a timeout
      // backs off for a minute while a platform-declared unavailable keeps 30.
      if (failed && candidateFailure) this.store.markUnavailable(failed.track, error.code, this.clock.now()
        + (error.code === 'media_open_timeout' ? 1 : ['media_failed'].includes(error.code) ? 5 : 30) * 60_000);
      if (this.state.current) {
        // A failed recovery still belongs to the listen that already happened.
        // Only a never-started load is discarded without a history row.
        if (this.state.current.startedAt != null) this._finishCurrent('error');
        this.state.current.finished = true;
        this.state.current = null;
        if (this.navigation?.playInstanceId === failed?.playInstanceId) this.navigation.playInstanceId = null;
      }
      this.state.paused = true;
      this.state.status = 'error';
      this._commit();
      if (failed?.selectedBy === 'agent' && candidateFailure && this.autoFailures < 2
        && this.state.settings.listening && !this._blockedUntil()) {
        this.autoFailures++;
        this.state.paused = false;
        this.state.status = 'idle';
        this.selectAutonomously();
      }
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  async waitForIdle() {
    while (this.tasks.size) await Promise.all([...this.tasks]);
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
      startPositionMs: current.positionMs, version, signal: controller.signal, muted, autoplay, usePreload }));
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
      await stage('mute', () => this.playback.setMuted({ muted, version }));
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
        if (this.state.paused || this.state.status !== 'playing') {
          this.state.paused = false;
          if (this.state.current) this._resumeCurrent();
        }
        break;
      case 'next': {
        if (this._forwardTrack()) break;
        const exclude = this.state.current ? [trackId(this.state.current.track)] : [];
        const rate = this.state.settings.discovery ? this.state.settings.discoveryRate : 0;
        const selector=this.selector??this.queueSelector;
        const options={discoveryRate:rate,at:now,excludeTrackKeys:exclude,queuedTracks:this.state.queue};
        let decision = selector.next(options);
        let recentBlocked=decision?.reason==='recent-window-exhausted';
        // 用户明确要求换曲：模型歌单没有可播曲目（未核对/冷却/不可用）时
        // 回退到输入曲库，而不是报错收场；自主续播不受此影响。
        if (this.selector&&!decision?.track) {
          decision = this.selector?.next({
            ...options,libraryFallback:true,
          });
          recentBlocked||=decision?.reason==='recent-window-exhausted';
          if (decision?.track) {
            decision = { ...decision, fellBack: true,
              fallbackReason: '模型歌单暂时没有可播的曲目，已回退你的输入曲库' };
          }
        }
        if (!decision?.track) {
          throw new MusicError('no_candidates', this._noCandidatesReason(true,recentBlocked?'recent-window-exhausted':decision?.reason));
        }
        this._applyRecommendation(decision,{trigger:'user-next',keepPaused:this.state.paused});
        break;
      }
      case 'previous':
        this._previousTrack();
        break;
      case 'requestTrack':
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
      if (!this.selectAutonomously()) {
        if (this._blockedUntil()) {
          throw new MusicError('autonomy_blocked', '今天已停止自主听歌。点击提示条里的「恢复自主听歌」即可重新开启。');
        }
        throw new MusicError('no_candidates', this._noCandidatesReason(false,this.state.lastSelection?.reason));
      }
    }
    return this.snapshot();
  }

  /** 为什么现在没有可自动播放的歌曲，按推荐来源给出可操作的原因。 */
  _noCandidatesReason(fallbackAttempted = false, reason = null) {
    if(reason==='recent-window-exhausted')return '最近 50 首播放过的歌曲暂不重复，请换一批新歌，也可以明确点播。';
    if(this.store.getSetting('recommendation_mode_v1')==='filtered'){
      const status=this.provider.discoveryStatus?.();
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
      if (current.effectiveMs >= 30_000) this.autoFailures = 0;
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
        this.store.markUnavailable(current.track, event.code, this.clock.now() + (event.code === 'media_unavailable' ? 30 : event.code === 'media_stalled' ? 1 : 5) * 60_000);
        if (this.autoFailures < 2) { this.autoFailures++; this.selectAutonomously(); }
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
