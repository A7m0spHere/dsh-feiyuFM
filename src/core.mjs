import { randomUUID } from 'node:crypto';
import { assertCommand, MusicError, normalizeTrack, trackId } from './contracts.mjs';

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

const DEFAULT_SETTINGS = Object.freeze({
  listening: true,
  humanPlayback: true,
  discovery: true,
  discoveryRate: 0.2,
  strategy: 'normal',
});

export class MusicCore {
  constructor({ store, provider, playback, clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } }) {
    if (!store || !provider || !playback) throw new Error('store, provider and playback are required');
    this.store = store;
    this.provider = provider;
    this.playback = playback;
    this.clock = clock;
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
    this.abortController = null;
    this.tasks = new Set();
    this.store.setCoreState(this.state);
  }

  snapshot() { return structuredClone(this.state); }

  setQueue(tracks) {
    this.state.queue = tracks.map(normalizeTrack);
    this._commit();
    return this.snapshot();
  }

  _commit() {
    this.state.revision += 1;
    this.store.setCoreState(this.state);
  }

  _invalidate() {
    this.state.commandVersion += 1;
    this.abortController?.abort();
    this.abortController = null;
  }

  _isCurrent(version, signal) {
    return this.state.commandVersion === version && !signal.aborted;
  }

  _launch(work, version) {
    const task = Promise.resolve().then(work).catch((error) => {
      if (version !== this.state.commandVersion) return;
      this.state.lastError = { code: error.code ?? 'internal', message: error.message };
      this.state.status = this.state.current ? 'error' : 'idle';
      this._commit();
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  async waitForIdle() {
    while (this.tasks.size) await Promise.all([...this.tasks]);
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
    this.store.recordHistory({
      playInstanceId: current.playInstanceId,
      track: current.track,
      selectedBy: current.selectedBy,
      progressSource: current.progressSource,
      effectiveMs: current.positionMs,
      agentListening: current.agentListening,
      audible: current.audible,
      endReason: reason,
      endedAt: this.clock.now(),
    });
    current.finished = true;
  }

  _select(track, selectedBy, keepPaused) {
    this._finishCurrent('skipped');
    this._invalidate();
    const version = this.state.commandVersion;
    this.playback.stop({ version });
    this.state.current = {
      track: normalizeTrack(track), playInstanceId: randomUUID(), selectedBy,
      positionMs: 0, progressSource: 'audio', agentListening: false, audible: false, finished: false,
    };
    this.state.paused = keepPaused;
    this.state.status = keepPaused ? 'paused' : 'resolving';
    this.state.lastError = null;
    this._commit();
    if (!keepPaused) this._launch(() => this._resolveAndPlay(version), version);
  }

  async _resolveAndPlay(version) {
    const current = this.state.current;
    if (!current) return;
    const controller = new AbortController();
    this.abortController = controller;
    let resource;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        resource = await resolveWithTimeout(this.provider, current.track, controller.signal, version, 5000);
        break;
      } catch (error) {
        if (!this._isCurrent(version, controller.signal)) return;
        if (!error.retryable || attempt === 2) throw error;
        await this.clock.sleep(100 * (attempt + 1), controller.signal);
        if (!this._isCurrent(version, controller.signal)) return;
      }
    }
    if (!this._isCurrent(version, controller.signal)) return;
    if (!resource || typeof resource.handle !== 'string' || !resource.handle) {
      throw new MusicError('resource_unavailable', 'Provider returned no playable resource');
    }
    const loaded = await this.playback.load({ resource, playInstanceId: current.playInstanceId,
      startPositionMs: current.positionMs, version, signal: controller.signal });
    if (!this._isCurrent(version, controller.signal)) return;
    const actualPositionMs = loaded?.positionMs ?? 0;
    if (!Number.isFinite(actualPositionMs) || actualPositionMs < 0) {
      throw new MusicError('invalid_playback_position', 'Playback reported invalid loaded position');
    }
    if (actualPositionMs !== current.positionMs) {
      current.positionMs = actualPositionMs;
      current.progressSource = 'audio';
      this._commit();
    }
    await this.playback.setMuted({ muted: !this.state.settings.humanPlayback, version });
    if (!this._isCurrent(version, controller.signal)) return;
    await this.playback.play({ playInstanceId: current.playInstanceId, version });
  }

  _takeNext() {
    while (this.state.queue.length) {
      const next = this.state.queue.shift();
      if (!this._blockedTrack(next)) return next;
    }
    return null;
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
        this.state.paused = true;
        this.state.status = this.state.current ? 'paused' : 'idle';
        this.playback.pause({ version: this.state.commandVersion });
        break;
      case 'resume':
        this.state.paused = false;
        if (this.state.current) {
          this._invalidate();
          this.state.status = 'resolving';
          this._launch(() => this._resolveAndPlay(this.state.commandVersion), this.state.commandVersion);
        }
        break;
      case 'next': {
        const next = this._takeNext();
        if (!next) throw new MusicError('no_candidates', 'No queued track is available');
        this._select(next, 'user', this.state.paused);
        break;
      }
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
          this.playback.pause({ version: this.state.commandVersion });
        }
        break;
      case 'setHumanPlayback':
        this.state.settings.humanPlayback = command.value;
        this.playback.setMuted({ muted: !command.value, version: this.state.commandVersion });
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
          this.playback.pause({ version: this.state.commandVersion });
          this.playback.setMuted({ muted: true, version: this.state.commandVersion });
        } else {
          this.state.settings.listening = true;
          if (command.value === 'silent') {
            this.state.settings.humanPlayback = false;
            this.playback.setMuted({ muted: true, version: this.state.commandVersion });
          } else {
            this.state.settings.strategy = command.value;
          }
          this.state.paused = false;
          if (this.state.current) {
            this._invalidate();
            this.state.status = 'resolving';
            this._launch(() => this._resolveAndPlay(this.state.commandVersion), this.state.commandVersion);
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
        this.playback.pause({ version: this.state.commandVersion });
        break;
      }
      case 'chooseSelf':
        this.store.removeConstraint('stop-today');
        this.state.blockUntil = null;
        this.state.settings.listening = true;
        this.state.paused = false;
        if (this.state.current) {
          this._invalidate();
          this.state.status = 'resolving';
          this._launch(() => this._resolveAndPlay(this.state.commandVersion), this.state.commandVersion);
        }
        break;
      case 'banTrack':
        this.store.addConstraint({ id: `ban:${trackId(command.track)}`, kind: 'ban_track',
          track: command.track, createdAt: now, summary: command.summary ?? '' });
        break;
      case 'unbanTrack': this.store.removeConstraint(`ban:${trackId(command.track)}`); break;
    }
    this.state.decisionVersion += 1;
    this.store.recordCommand(command.commandId, now);
    this._commit();
    if ((command.type === 'resume' || command.type === 'chooseSelf' ||
      (command.type === 'setMode' && command.value !== 'off')) && !this.state.current) {
      this.selectAutonomously();
    }
    return this.snapshot();
  }

  selectAutonomously() {
    if (!this.state.settings.listening || this.state.paused || this._blockedUntil() || this.state.current) return false;
    const next = this._takeNext();
    if (!next) return false;
    this._select(next, 'agent', false);
    return true;
  }

  onPlaybackEvent(event) {
    const current = this.state.current;
    if (!current || event.playInstanceId !== current.playInstanceId || current.finished) return false;
    if (event.version !== undefined && event.version !== this.state.commandVersion) return false;
    if (event.type === 'started') {
      if (this.state.paused) return false;
      this.state.status = 'playing';
      this._commit();
      return true;
    }
    if (event.type === 'progress') {
      if (this.state.paused || !Number.isFinite(event.positionMs)) return false;
      if (event.progressSource === 'logical' && !current.track.durationMs) return false;
      const nextPosition = current.track.durationMs ? Math.min(event.positionMs, current.track.durationMs) : event.positionMs;
      if (nextPosition <= current.positionMs) return false;
      current.positionMs = nextPosition;
      current.progressSource = event.progressSource === 'logical' ? 'logical' : 'audio';
      current.agentListening ||= current.selectedBy === 'agent' && this.state.settings.listening;
      current.audible ||= current.progressSource === 'audio' && this.state.settings.humanPlayback;
      this._commit();
      return true;
    }
    if ((event.type === 'ended' || event.type === 'error') && this.state.paused) return false;
    if (event.type === 'ended' || event.type === 'error') {
      this._finishCurrent(event.type === 'ended' ? 'ended' : 'error');
      this.state.status = event.type === 'ended' ? 'idle' : 'error';
      if (event.type === 'error') this.state.lastError = { code: event.code ?? 'playback_error', message: event.message ?? 'Playback failed' };
      this.state.current = null;
      this._commit();
      if (event.type === 'ended') this.selectAutonomously();
      return true;
    }
    return false;
  }
}
