// Implements the Phase 1 Playback contract on top of the audio host pipe.
// Core keeps deciding what to play; this module only turns host facts into the
// started/progress/ended/error events Core already understands, and refuses to
// let late or stale host answers overwrite a newer user command.
import { MusicError } from '../contracts.mjs';
import { playbackError } from './protocol.mjs';

function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { promise.catch(() => {}); return Promise.reject(new MusicError('cancelled', 'Playback command was cancelled')); }
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new MusicError('cancelled', 'Playback command was cancelled')); };
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn) => (value) => {
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    promise.then(settle(resolve), settle(reject));
  });
}

export class PlaybackService {
  constructor({
    supervisor,
    openTimeoutMs = 12000,
    commandTimeoutMs = 6000,
    recoveryTimeoutMs = 20000,
    progressIntervalMs = 400,
    maxRecoveries = 3,
    onLog = () => {},
  } = {}) {
    if (!supervisor) throw new Error('supervisor is required');
    this.supervisor = supervisor;
    this.openTimeoutMs = openTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.progressIntervalMs = progressIntervalMs;
    this.maxRecoveries = maxRecoveries;
    this.onLog = onLog;

    this.sink = null;
    this.active = null;
    this.acceptedVersion = -1;
    this.muted = false;
    this.closing = false;
    this.hostExiting = false;
    this.lastForwardedMs = 0;
    this.lastProgressAt = 0;
    this.lastEffectiveAt = performance.now();
    this.recoveries = 0;
    this._recovery = null;
    this._recoveryContext = null;
    this._preload = null;
    this._preloadCancellation = null;
    this.capabilities = { seek: null, mute: null };

    supervisor.onMessage = (message) => this._onHostMessage(message);
    supervisor.onHostClose = (error) => this._onHostClose(error);
  }

  onEvent(sink) { this.sink = sink; }

  /** Diagnostics only: never contains credential or resource material. */
  state() {
    const host = this.supervisor.hostState;
    return {
      hostPid: this.supervisor.pid,
      hostStatus: host?.status ?? null,
      hostBusy: this.supervisor.connected,
      muted: this.muted,
      acceptedVersion: this.acceptedVersion,
      playInstanceId: this.active?.playInstanceId ?? null,
      positionMs: this.active?.positionMs ?? 0,
      capabilities: { ...this.capabilities },
      preloadStatus: this._preload ? (this._preload.ready ? 'ready' : 'loading') : 'idle',
    };
  }

  /**
   * True when the connected host can apply mute + autoplay inside `load`.
   * A switch then costs one round trip instead of three; older hosts keep the
   * explicit setMuted/play path.
   */
  supportsAutoplay() {
    return this.supervisor.hello?.capabilities?.autoplay === true;
  }

  /**
   * True when the host can replace the source with Open() instead of paying
   * Stop()+Close() first. A switch then does not need an explicit stop.
   */
  supportsReuseSwitch() {
    return this.supervisor.hello?.capabilities?.reuseSwitch === true;
  }

  /**
   * True when the host still holds this paused instance, so a resume can be a
   * plain play command instead of a full re-resolve + reload.
   */
  canResume({ playInstanceId } = {}) {
    const host = this.supervisor.hostState;
    if (!host || host.status !== 'paused') return false;
    if (!this.active || this.active.finished) return false;
    if (playInstanceId && host.playInstanceId !== playInstanceId) return false;
    return true;
  }

  /** True when the host can open the next track in a standby player. */
  supportsPreload() {
    return this.supervisor.hello?.capabilities?.preload === true;
  }

  canSeek({ playInstanceId } = {}) {
    return this.supervisor.hello?.capabilities?.seekInPlace === true && Boolean(this.active && !this.active.finished)
      && (!playInstanceId || this.active.playInstanceId === playInstanceId);
  }

  _position(active, positionMs, version) {
    if (this.active !== active || version !== this.acceptedVersion || !Number.isFinite(positionMs) || positionMs < 0) return;
    active.positionMs = Math.round(positionMs);
    this.lastForwardedMs = active.positionMs;
    this.lastProgressAt = 0;
    this.lastEffectiveAt = performance.now();
    this._emit({ type: 'positioned', playInstanceId: active.playInstanceId, version, positionMs: active.positionMs });
  }

  async seek({ playInstanceId, positionMs, version, signal }) {
    if (!this.canSeek({ playInstanceId })) throw playbackError('seek_unsupported', '当前播放宿主不支持歌词跳转。');
    if (!this._acceptVersion(version)) throw playbackError('cancelled', '跳转已被新的操作取代。');
    const active = this.active;
    const seeking = { active, version };
    this.seeking = seeking;
    let observedState;
    try {
      const answer = await raceAbort(this._send('seek', { playInstanceId, positionMs, version },
        { timeoutMs: this.commandTimeoutMs, invalidateOnTimeout: false }), signal);
      if (signal?.aborted || this.active !== active || version !== this.acceptedVersion) throw playbackError('cancelled', '跳转已被新的操作取代。');
      if (!Number.isFinite(answer.positionMs) || answer.positionMs < 0) throw playbackError('seek_failed', '宿主没有确认跳转位置。');
      observedState = answer.state;
      this._position(active, answer.positionMs, version);
      return { positionMs: answer.positionMs };
    } catch (error) {
      if (this.active === active && version === this.acceptedVersion) {
        try {
          const snapshot = await this._send('snapshot', { version }, { invalidateOnTimeout: false });
          observedState = snapshot.state;
          if (snapshot.state?.playInstanceId === active.playInstanceId) this._position(active, snapshot.state.positionMs, version);
        } catch { /* Preserve the seek failure; no automatic track replacement. */ }
      }
      throw error;
    } finally {
      if (this.seeking === seeking) {
        this.seeking = null;
        // An end arriving during seek may belong to the old position. Only the
        // final host snapshot can prove that it really ended at the new one.
        if (this.active === active && version === this.acceptedVersion && observedState) this._adoptState(observedState);
      }
    }
  }

  /**
   * Opens the next track in the standby player. Advisory: a failure only means
   * the real load opens normally.
   */
  async preload({ resource, playInstanceId, version, signal, timeoutMs = this.openTimeoutMs + this.commandTimeoutMs }) {
    if (this.closing) throw playbackError('playback_closed', 'Playback service is closing');
    if (!resource || typeof resource.handle !== 'string' || !resource.handle) {
      throw playbackError('resource_missing', 'Preload needs a resolved resource handle');
    }
    if (signal?.aborted) throw new MusicError('cancelled', 'Preload was cancelled');
    if (Number.isFinite(version) && version < this.acceptedVersion) {
      throw playbackError('stale_version', 'Ignored a preload for an older command version');
    }
    const previous = this._preload;
    if (previous?.handle === resource.handle && (!previous.ready || previous.generation === this.supervisor.generation)) {
      return raceAbort(previous.promise, signal);
    }
    if (previous) void this.cancelPreload();
    const entry = { handle: resource.handle, ready: false, controller: new AbortController(), generation: this.supervisor.generation };
    this._preload = entry;
    const onAbort = () => { if (this._preload === entry) void this.cancelPreload(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cancellation = this._preloadCancellation;
    entry.promise = (async () => {
      try {
        // A cancelled old open must be acknowledged before a new standby open
        // is sent, otherwise its late cancellation could close the new resource.
        if (cancellation) await cancellation;
        if (this._preload !== entry || entry.controller.signal.aborted) {
          throw new MusicError('cancelled', 'Preload was superseded');
        }
        const answer = await raceAbort(this._send('preload', {
          resource: resource.handle, playInstanceId, version, openTimeoutMs: this.openTimeoutMs,
        }, { timeoutMs }), entry.controller.signal);
        if (this._preload !== entry || entry.controller.signal.aborted) {
          throw new MusicError('cancelled', 'Preload was superseded');
        }
        entry.generation = this.supervisor.generation;
        entry.ready = answer.preloaded === true;
        if (!entry.ready) this._preload = null;
        this.onLog({ type: 'preload-ready', at: Date.now(), playInstanceId, version, ready: entry.ready });
        return answer;
      } catch (error) {
        if (this._preload === entry) this._preload = null;
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    })();
    return entry.promise;
  }

  /** Exact resource identity matters: refreshed URLs cannot reuse stale media. */
  isPreloaded(resource) {
    const entry = this._preload;
    return Boolean(entry?.ready && entry.handle === resource?.handle
      && entry.generation === this.supervisor.generation && this.supervisor.connected !== false);
  }

  _forgetPreload() {
    const entry = this._preload;
    this._preload = null;
    entry?.controller.abort();
  }

  async cancelPreload() {
    this._forgetPreload();
    if (this.closing) return;
    // Standby teardown can outlast a normal control tick on a remote stream.
    // Its advisory deadline must never disconnect an unrelated foreground load.
    const cancellation = this._send('preloadCancel', {}, {
      timeoutMs: this.commandTimeoutMs, invalidateOnTimeout: false,
    }).catch(() => {});
    this._preloadCancellation = cancellation;
    await cancellation;
    if (this._preloadCancellation === cancellation) this._preloadCancellation = null;
  }

  async load({ resource, playInstanceId, startPositionMs = 0, version, signal, muted = null, autoplay = false, usePreload = false }) {
    if (this.closing) throw playbackError('playback_closed', 'Playback service is closing');
    if (!this._acceptVersion(version)) {
      throw playbackError('stale_version', 'Ignored a load for an older command version');
    }
    if (!resource || typeof resource.handle !== 'string' || !resource.handle) {
      throw playbackError('resource_missing', 'Playback needs a resolved resource handle');
    }
    const startMs = Number.isFinite(startPositionMs) && startPositionMs > 0 ? Math.round(startPositionMs) : 0;
    this._forgetPreload();
    this.active = null;
    this.lastForwardedMs = 0;
    const answer = await raceAbort(this._send('load', {
      resource: resource.handle,
      playInstanceId,
      startPositionMs: startMs,
      version,
      openTimeoutMs: this.openTimeoutMs,
      ...(muted === null ? {} : { muted: Boolean(muted) }),
      ...(autoplay ? { autoplay: true } : {}),
      ...(usePreload ? { usePreload: true } : {}),
    }, { timeoutMs: this.openTimeoutMs + this.commandTimeoutMs }), signal);
    if (signal?.aborted || version < this.acceptedVersion || this.closing) throw new MusicError('cancelled', 'Playback load was superseded');
    const positionMs = Number(answer.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw playbackError('invalid_playback_position', 'Audio host reported an invalid loaded position');
    }
    this.active = {
      playInstanceId,
      version,
      started: false,
      finished: false,
      positionMs: Math.round(positionMs),
    };
    this.lastForwardedMs = this.active.positionMs;
    this.lastProgressAt = 0;
    if (answer.seek === false) this.capabilities.seek = false;
    else if (startMs > 0) this.capabilities.seek = true;
    if (typeof answer.muted === 'boolean') this.muted = answer.muted;
    else if (muted !== null) this.muted = Boolean(muted);
    const playing = answer.playing === true;
    const preloaded = answer.preloaded === true;
    this.onLog({ type: 'loaded', at: Date.now(), playInstanceId, version, positionMs: this.active.positionMs, seek: answer.seek !== false, playing, preloaded });
    return { positionMs: this.active.positionMs, playing, preloaded };
  }

  async play({ playInstanceId, version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    const active = this.active;
    if (!active || active.finished) return;
    if (playInstanceId && playInstanceId !== active.playInstanceId) return;
    const pendingSeek = this.seeking;
    const commandVersion = version ?? this.acceptedVersion;
    const answer = await this._send('play', { playInstanceId: active.playInstanceId, version: commandVersion });
    if (pendingSeek?.active === active && pendingSeek.version < commandVersion) {
      this._position(active, answer.positionMs ?? answer.state?.positionMs, commandVersion);
      if (answer.state) this._adoptState(answer.state);
    }
    this.lastEffectiveAt = performance.now();
  }

  async pause({ version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    this._forgetPreload();
    const active = this.active;
    const pendingSeek = this.seeking;
    const commandVersion = version ?? this.acceptedVersion;
    const answer = await this._send('pause', { version: commandVersion });
    const positionMs = answer.positionMs ?? answer.state?.positionMs;
    // Resume can briefly expose 0 on WPF. Only a real pending seek permits
    // adopting a position behind the last confirmed audio timeline.
    if (active && (positionMs >= active.positionMs || pendingSeek?.active === active)) this._position(active, positionMs, commandVersion);
  }

  async stop({ version } = {}) {
    this.active = null;
    this.lastForwardedMs = 0;
    if (this.closing) return;
    if (version !== undefined && !this._acceptVersion(version)) return;
    this._forgetPreload();
    await this._send('stop', { version: version ?? this.acceptedVersion });
  }

  async setMuted({ muted, version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    const active = this.active;
    const pendingSeek = this.seeking;
    const commandVersion = version ?? this.acceptedVersion;
    this.muted = Boolean(muted);
    const answer = await this._send('setMuted', { muted: this.muted, version: commandVersion });
    if (active && pendingSeek?.active === active && pendingSeek.version < commandVersion) {
      this._position(active, answer.positionMs ?? answer.state?.positionMs, commandVersion);
      if (answer.state) this._adoptState(answer.state);
    }
  }

  /**
   * Snapshot of the host, used by reconnection and by verification scripts.
   * This sits on the recovery critical path, and a busy machine can take far
   * longer to answer than an ordinary control command, so it gets its own
   * budget instead of the control timeout.
   */
  async hostSnapshot({ timeoutMs = this.recoveryTimeoutMs } = {}) {
    const answer = await this._send('snapshot', {}, { timeoutMs });
    return answer.state ?? null;
  }

  async close(options = {}) {
    this.closing = true;
    this._forgetPreload();
    this.active = null;
    await this.supervisor.dispose(options);
  }

  async _send(type, payload = {}, { timeoutMs = this.commandTimeoutMs, invalidateOnTimeout = true } = {}) {
    const started = performance.now();
    let answer;
    try {
      answer = await this.supervisor.request({ type, ...payload }, { timeoutMs, invalidateOnTimeout });
      // Every host result carries a fresh state snapshot. Keeping it here is
      // what lets a pause be recognised as directly resumable: the host only
      // pushes state on connect, so the greeting state would stay stale.
      if (answer?.state && typeof answer.state === 'object'
        && (!Number.isFinite(answer.state.version) || answer.state.version >= this.acceptedVersion)) {
        this.supervisor.hostState = { type: 'state', ...answer.state };
      }
      return answer;
    } finally {
      // Host-internal time vs pipe/queue time is the difference between "the
      // audio host is slow" and "the command waited"; diagnostics only.
      try {
        this.onLog({ type: 'host-command', name: type, at: Date.now(), version: payload.version, playInstanceId: payload.playInstanceId,
          durationMs: Math.round(performance.now() - started),
          ...(type === 'load' ? { preloaded: answer?.preloaded === true } : {}),
          ...(Number.isFinite(answer?.hostStartedAt) ? { hostStartedAt: answer.hostStartedAt } : {}),
          ...(Number.isFinite(answer?.hostMs) ? { hostMs: Math.round(answer.hostMs) } : {}) });
      } catch { /* a logger fault is not a playback fault */ }
    }
  }

  _acceptVersion(version) {
    if (!Number.isFinite(version)) return true;
    if (version < this.acceptedVersion) return false;
    this.acceptedVersion = version;
    if (this.active) this.active.version = version;
    return true;
  }

  _emit(event) {
    try {
      this.sink?.(event);
    } catch { /* Core faults are its own concern. */ }
    this.onLog({ type: 'event', event: event.type, playInstanceId: event.playInstanceId, positionMs: event.positionMs });
  }

  _failActive(code, message) {
    const active = this.active;
    if (!active || active.finished) return;
    active.finished = true;
    this.active = null;
    this._emit({ type: 'error', playInstanceId: active.playInstanceId, version: active.version, code, message });
  }

  _onHostMessage(message) {
    if (message.type === 'state') {
      this._adoptState(message);
      return;
    }
    if (message.type !== 'event') return;
    const type = message.event;
    if (type === 'exiting') {
      this.hostExiting = true;
      return;
    }
    const active = this.active;
    if (!active || active.finished) return;
    if (message.playInstanceId && message.playInstanceId !== active.playInstanceId) return;
    if (Number.isFinite(message.version) && message.version < active.version) return;
    if (this.seeking?.active === active && this.seeking.version === active.version && ['progress', 'ended'].includes(type)) return;

    if (type === 'started') {
      if (active.started) return;
      active.started = true;
      try { this.onLog({ type: 'host-event', event: 'started', playInstanceId: active.playInstanceId,
        version: active.version, ...(Number.isFinite(message.hostEventAt) ? { hostEventAt: message.hostEventAt } : {}) }); }
      catch { /* Diagnostics cannot interrupt playback. */ }
      this._emit({ type: 'started', playInstanceId: active.playInstanceId, version: active.version });
      return;
    }

    if (type === 'progress') {
      this._acceptProgress(active, message);
      return;
    }

    if (type === 'ended' || type === 'error') {
      if (type === 'ended') this._acceptProgress(active, { positionMs: message.positionMs, force: true });
      active.finished = true;
      this.active = null;
      if (type === 'ended') {
        this._emit({
          type: 'ended',
          playInstanceId: active.playInstanceId,
          version: active.version,
          positionMs: active.positionMs,
        });
      } else {
        this._emit({
          type: 'error',
          playInstanceId: active.playInstanceId,
          version: active.version,
          code: typeof message.code === 'string' && message.code ? message.code : 'playback_error',
          message: typeof message.message === 'string' && message.message ? message.message : 'Playback failed',
          retryable: message.retryable === true,
        });
      }
    }
  }

  /**
   * Audio-timeline progress is only ever reported forward. A player that
   * momentarily reports 0 ms after a resume (observed in P0-04) must not reset
   * Core progress or invent listening time.
   */
  _acceptProgress(active, message) {
    const positionMs = Number(message.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) return;
    if (positionMs > active.positionMs) active.positionMs = positionMs;
    if (positionMs <= this.lastForwardedMs) return;
    const at = Date.now();
    if (message.force !== true && at - this.lastProgressAt < this.progressIntervalMs) return;
    this.lastProgressAt = at;
    const monotonicAt = performance.now();
    const elapsed = Math.max(0, monotonicAt - (this.lastEffectiveAt ?? monotonicAt));
    const advance = positionMs - this.lastForwardedMs;
    const effectiveDeltaMs = elapsed > 5000 || advance > elapsed + 1000 ? 0 : Math.min(advance, Math.round(elapsed));
    this.lastEffectiveAt = monotonicAt;
    this.lastForwardedMs = positionMs;
    this._emit({
      type: 'progress',
      playInstanceId: active.playInstanceId,
      version: active.version,
      positionMs,
      effectiveDeltaMs,
      progressSource: message.progressSource === 'logical' ? 'logical' : 'audio',
    });
  }

  /**
   * A host state message is the only thing that can prove playback survived a
   * dropped client connection. Matching instance: adopt. Missing media: the
   * instance is genuinely gone and Core must hear about it.
   */
  _adoptState(state) {
    const active = this.active;
    if (!active || active.finished) return;
    if (Number.isFinite(state.version) && state.version < active.version) return;
    if (state.playInstanceId && state.playInstanceId === active.playInstanceId) {
      const positionMs = Number(state.positionMs);
      this.lastEffectiveAt = performance.now();
      if (Number.isFinite(positionMs) && positionMs > active.positionMs) {
        active.positionMs = positionMs;
        if (positionMs > this.lastForwardedMs) this.lastForwardedMs = positionMs;
      }
      if (state.status === 'playing' && !active.started) {
        active.started = true;
        this._emit({ type: 'started', playInstanceId: active.playInstanceId, version: active.version });
      }
      if (state.status === 'ended' || state.status === 'error') {
        // The terminal event may have happened while the pipe was disconnected.
        // Adopt the host fact once, without crediting the unobserved interval.
        this._onHostMessage({ type: 'event', event: state.status, playInstanceId: active.playInstanceId,
          version: active.version, positionMs: active.positionMs,
          code: state.errorCode, message: state.errorMessage, retryable: state.retryable });
      }
      return;
    }
    if (state.status === 'idle' && !state.playInstanceId && !state.resource) {
      this._failActive('playback_host_lost', 'The audio host no longer holds the current track');
    }
  }

  _onHostClose(error) {
    this._forgetPreload();
    if (this.closing) return;
    const active = this.active;
    // No active instance means there is nothing to recover — either the service
    // is idle, or a load is in flight (`load()` clears `active` before awaiting)
    // and that load rejects on its own. `recoveries` deliberately does not count
    // these: it budgets the reconnect of a *playing* track, and spending it on a
    // failed load would leave a later, recoverable drop with no retries left.
    if (!active || active.finished) return;
    const previous = this._recoveryContext;
    if (previous?.active === active && previous.version === active.version) return;
    const context = { active, version: active.version };
    this._recoveryContext = context;
    this._recovery = this._recover(error).catch(() => {}).finally(() => {
      if (this._recoveryContext === context) {
        this._recovery = null;
        this._recoveryContext = null;
      }
    });
  }

  async _recover(error) {
    const active = this.active;
    if (!active) return;
    const version = active.version;
    const stillCurrent = () => !this.closing && this.active === active && active.version === version;
    let failure = error;
    for (let attempt = 0; attempt < this.maxRecoveries && stillCurrent(); attempt += 1) {
      this.recoveries = attempt + 1;
      try {
        await this.supervisor.ensureHost();
        if (!stillCurrent()) return;
        // Cached greeting state cannot prove the track survived the disconnect.
        const state = await this.hostSnapshot();
        if (!stillCurrent()) return;
        if (!state) throw playbackError('playback_host_lost', 'Audio host did not answer a state request');
        this._adoptState(state);
        this.recoveries = 0;
        if (stillCurrent()) this.onLog({ type: 'reconnected', playInstanceId: active.playInstanceId, positionMs: active.positionMs });
        return;
      } catch (caught) {
        failure = caught;
      }
    }
    if (stillCurrent()) this._failActive('playback_host_lost',
      `Audio host connection kept failing: ${failure?.message ?? 'unknown error'}`);
  }
}
