import { randomUUID } from 'node:crypto';
import { assertCommand, MusicError, normalizeTrack, trackId } from './contracts.mjs';
import {setTrackFeedback,resetRecommendationTaste,undoRecommendationReset} from './feedback.mjs';
import {modelRecommendations} from './model-recommendations.mjs';

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
  constructor({ store, provider, playback, selector = null, onListened = null, onLog = () => {}, clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } }) {
    if (!store || !provider || !playback) throw new Error('store, provider and playback are required');
    this.store = store;
    this.provider = provider;
    this.playback = playback;
    // Optional local selector. It is only consulted for autonomous playback;
    // explicit user commands never go through it.
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
    this.store.setCoreState(this.state);
  }

  snapshot() { return structuredClone({ ...this.state, ...(this.provider.discoveryStatus ? { discovery: this.provider.discoveryStatus() } : {}) }); }

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
      this.onLog({ type: 'playback-error', code: error.code ?? 'internal', playInstanceId: failed?.playInstanceId });
      const candidateFailure = ['media_unavailable', 'resource_unavailable', 'media_open_timeout', 'media_failed'].includes(error.code);
      if (failed && candidateFailure) this.store.markUnavailable(failed.track, error.code, this.clock.now()
        + (['media_open_timeout','media_failed'].includes(error.code) ? 5 : 30) * 60_000);
      if (this.state.current && !this.state.current.finished) {
        this.state.current.finished = true;
        this.state.current = null;
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

  _select(track, selectedBy, keepPaused) {
    const stored=this.store.getTrack(track);
    const enriched=stored ? this.store.getNormalizedTrack(track) : null;
    this._finishCurrent('skipped');
    this._invalidate();
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
    this.store.upsertTrack(this.state.current.track, this.clock.now());
    const rngState = this.selector?.randomState?.();
    if (Number.isSafeInteger(rngState)) this.state.selectionRngState = rngState;
    this.state.paused = keepPaused;
    this.state.status = keepPaused ? 'paused' : 'resolving';
    this.state.lastError = null;
    this._commit();
    this.onLog({ type: 'selected', playInstanceId: this.state.current.playInstanceId, trackKey: trackId(track), selectedBy, decisionId: this.state.current.decisionId, pool: selectedBy === 'agent' ? this.state.lastSelection?.pool : 'user' });
    if (keepPaused) this._control('stop', { version });
    else this._launch(() => this._resolveAndPlay(version), version);
  }

  async _resolveAndPlay(version) {
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
    await stage('stop', () => this.playback.stop({ version }));
    if (!this._isCurrent(version, controller.signal)) return;
    let resource;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        resource = await stage('resolve', () => resolveWithTimeout(this.provider, current.track, controller.signal, version, 5000));
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
    const loaded = await stage('load', () => this.playback.load({ resource, playInstanceId: current.playInstanceId,
      startPositionMs: current.positionMs, version, signal: controller.signal }));
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
    await stage('mute', () => this.playback.setMuted({ muted: !this.state.settings.humanPlayback, version }));
    if (!this._isCurrent(version, controller.signal)) return;
    await stage('play', () => this.playback.play({ playInstanceId: current.playInstanceId, version }));
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
        this._control('pause', { version: this.state.commandVersion }, true);
        break;
      case 'resume':
        if (this.state.paused || this.state.status !== 'playing') {
          this.state.paused = false;
          if (this.state.current) this._restartCurrent();
        }
        break;
      case 'next': {
        const queued = this._takeNext();
        const exclude = this.state.current ? [trackId(this.state.current.track)] : [];
        const rate = this.state.settings.discovery ? this.state.settings.discoveryRate : 0;
        let decision = queued ? {track:queued,pool:'queue',attemptedDiscovery:false} : this.selector?.next({
          discoveryRate: rate,
          at: now,
          excludeTrackKeys: exclude,
        });
        // 用户明确要求换曲：模型歌单没有可播曲目（未核对/冷却/不可用）时
        // 回退到输入曲库，而不是报错收场；自主续播不受此影响。
        if (!queued && !decision?.track) {
          decision = this.selector?.next({
            discoveryRate: rate,
            at: now,
            excludeTrackKeys: exclude,
            libraryFallback: true,
          });
          if (decision?.track) {
            decision = { ...decision, fellBack: true,
              fallbackReason: '模型歌单暂时没有可播的曲目，已回退你的输入曲库' };
          }
        }
        if (!decision?.track) {
          throw new MusicError('no_candidates', this._noCandidatesReason(true));
        }
        this._applyRecommendation(decision,{trigger:'user-next',keepPaused:this.state.paused});
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
        throw new MusicError('no_candidates', this._noCandidatesReason());
      }
    }
    return this.snapshot();
  }

  /** 为什么现在没有可自动播放的歌曲，按推荐来源给出可操作的原因。 */
  _noCandidatesReason(fallbackAttempted = false) {
    if (this.store.getSetting('recommendation_mode_v1') === 'llm') {
      const playlist = modelRecommendations(this.store);
      if (!playlist) return '还没有模型歌单，请先根据歌曲推荐一批。';
      if (!playlist.verified.length) return '推荐歌单还没有确认可播放的歌曲，请查看各首状态后重新确认。';
      return fallbackAttempted
        ? '模型歌单和输入曲库都没有可播的歌曲：候选是正在播的这首、刚播过（30 分钟内不重复）或被播放规则排除了，请稍后再试或更新歌单。'
        : '模型歌曲都是正在播的这首、刚播过（30 分钟内不重复）或被播放规则排除了，请稍后再试或更新歌单。';
    }
    return '现在没有可自动播放的歌曲：曲库为空或候选刚播过、被规则排除。';
  }

  selectAutonomously() {
    if (!this.state.settings.listening || this.state.paused || this._blockedUntil() || this.state.current) return false;

    // With a selector, the local decision layer picks from the user's
    // environment and platform candidates; otherwise the fixed debug queue is
    // used. Either way, no user command is involved and nothing is retried
    // when there is nothing to play.
    const decision = this.selector ? this.selector.next({
        discoveryRate: this.state.settings.discovery ? this.state.settings.discoveryRate : 0,
        at: this.clock.now(),
      }) : {track:this._takeNext(),pool:'queue',attemptedDiscovery:false};
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
      if(next)this._select(next,'agent',keepPaused);else this._commit();
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
      this._commit();
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
      current.effectiveMs = (current.effectiveMs ?? 0) + delta;
      if (current.selectedBy === 'agent' && this.state.settings.listening) current.agentEffectiveMs = (current.agentEffectiveMs ?? 0) + delta;
      if (event.progressSource !== 'logical' && this.state.settings.humanPlayback) current.audibleMs = (current.audibleMs ?? 0) + delta;
      if (current.effectiveMs >= 30_000) this.autoFailures = 0;
      current.positionMs = nextPosition;
      current.progressSource = event.progressSource === 'logical' ? 'logical' : 'audio';
      current.agentListening ||= current.selectedBy === 'agent' && this.state.settings.listening;
      current.audible ||= current.progressSource === 'audio' && this.state.settings.humanPlayback;
      this._commit();
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
        if (expiry && !expiry.reResolved && (knownAndPassed || platformSaysGone)) {
          expiry.reResolved = true;
          this.state.status = 'resolving';
          this.state.lastError = {
            code: 'resource_expired',
            message: 'the platform handle expired, so it is being resolved again',
          };
          this._commit();
          const version = this.state.commandVersion;
          this._launch(() => this._resolveAndPlay(version), version);
          return true;
        }
      }
      this._finishCurrent(event.type === 'ended' ? 'ended' : 'error');
      this.state.status = event.type === 'ended' ? 'idle' : 'error';
      if (event.type === 'error') this.state.lastError = { code: event.code ?? 'playback_error', message: event.message ?? 'Playback failed' };
      this.state.current = null;
      this._commit();
      if (event.type === 'ended') this.selectAutonomously();
      else if (current.selectedBy === 'agent' && ['media_unavailable','media_failed','media_open_timeout'].includes(event.code)) {
        this.store.markUnavailable(current.track, event.code, this.clock.now() + (event.code === 'media_unavailable' ? 30 : 5) * 60_000);
        if (this.autoFailures < 2) { this.autoFailures++; this.selectAutonomously(); }
      }
      return true;
    }
    return false;
  }
}
