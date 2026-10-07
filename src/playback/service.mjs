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
    };
  }

  async load({ resource, playInstanceId, startPositionMs = 0, version, signal }) {
    if (this.closing) throw playbackError('playback_closed', 'Playback service is closing');
    if (!this._acceptVersion(version)) {
      throw playbackError('stale_version', 'Ignored a load for an older command version');
    }
    if (!resource || typeof resource.handle !== 'string' || !resource.handle) {
      throw playbackError('resource_missing', 'Playback needs a resolved resource handle');
    }
    const startMs = Number.isFinite(startPositionMs) && startPositionMs > 0 ? Math.round(startPositionMs) : 0;
    this.active = null;
    this.lastForwardedMs = 0;
    const answer = await raceAbort(this._send('load', {
      resource: resource.handle,
      playInstanceId,
      startPositionMs: startMs,
      version,
      openTimeoutMs: this.openTimeoutMs,
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
    this.onLog({ type: 'loaded', playInstanceId, positionMs: this.active.positionMs, seek: answer.seek !== false });
    return { positionMs: this.active.positionMs };
  }

  async play({ playInstanceId, version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    const active = this.active;
    if (!active || active.finished) return;
    if (playInstanceId && playInstanceId !== active.playInstanceId) return;
    await this._send('play', { playInstanceId: active.playInstanceId, version });
    this.lastEffectiveAt = performance.now();
  }

  async pause({ version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    await this._send('pause', { version: version ?? this.acceptedVersion });
  }

  async stop({ version } = {}) {
    this.active = null;
    this.lastForwardedMs = 0;
    if (this.closing) return;
    if (version !== undefined && !this._acceptVersion(version)) return;
    await this._send('stop', { version: version ?? this.acceptedVersion });
  }

  async setMuted({ muted, version } = {}) {
    if (this.closing) return;
    if (!this._acceptVersion(version)) return;
    this.muted = Boolean(muted);
    await this._send('setMuted', { muted: this.muted, version: version ?? this.acceptedVersion });
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
    this.active = null;
    await this.supervisor.dispose(options);
  }

  _send(type, payload = {}, { timeoutMs = this.commandTimeoutMs } = {}) {
    return this.supervisor.request({ type, ...payload }, { timeoutMs });
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

    if (type === 'started') {
      if (active.started) return;
      active.started = true;
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
