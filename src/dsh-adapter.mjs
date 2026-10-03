// DSH adapter: the bridge between the real Harness and the music core process.
//
// Full tool/command/teardown integration was verified against Harness
// 0.1.7-rc.2. Bundle activation and Core startup were then verified in the
// PHL-managed 0.2.0-rc.1 Web profile on 2026-09-28; actual tool calls and
// teardown on that version remain unverified.
//   - plugins export `apply(ctx, config)`, may declare `inject`, and register
//     everything inside `ctx.effect` / `ctx.on` so unload removes it;
//   - `ctx.on('session/event', (session, event))` delivers an envelope
//     `{ type, seq: number, time, data }`; the payload is under `data`;
//   - tools are `ctx.tools.register({ name, description, parameters, output })`
//     and commands are `ctx.commands.register({ name, description, handler })`.
//
// The adapter adds no model requests and injects no per-turn music context: it
// only maps a small allowlist of events and forwards explicit user intent.
import { mapSessionEvent } from './core-host.mjs';

/** Tool names the adapter owns. Kept small: each name is static prompt surface. */
export const TOOL_NAMES = Object.freeze({
  status: 'fishfm_status',
  control: 'fishfm_control',
  request: 'fishfm_request_track',
});

/** Slash commands the adapter owns. */
export const COMMAND_NAMES = Object.freeze(['fishfm', 'fishfm-pause', 'fishfm-next']);

function toolAbortError(signal) {
  const error = new Error('FishFM tool call was cancelled', { cause: signal?.reason });
  error.name = 'AbortError';
  error.code = 'cancelled';
  return error;
}

/**
 * Maps one real session event to what the core should be told. Only events in
 * the allowlist reach the core; everything else is dropped rather than guessed,
 * because the plan forbids inventing work context and DSH has no `idle` event.
 */
export function translateSessionEvent(event) {
  const type = typeof event?.type === 'string' ? event.type : '';
  const mapped = mapSessionEvent(type);
  if (mapped.kind === 'unknown') return null;
  return { name: type, kind: mapped.kind, allowsAutonomy: mapped.allowsAutonomy };
}

/**
 * Owns the core process and the protocol conversation with it. Exported so the
 * spawn/forwarding behaviour is testable without a Harness.
 */
export class CoreBridge {
  constructor({ spawnCore, onLog = () => {}, requestTimeoutMs = 15000 } = {}) {
    if (typeof spawnCore !== 'function') throw new Error('spawnCore is required');
    this.spawnCore = spawnCore;
    this.onLog = onLog;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.stateListeners = new Set();
    this.ready = null;
    this.lastSnapshot = null;
    this.exitInfo = null;
  }

  get snapshot() { return this.lastSnapshot; }

  onState(listener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = this.spawnCore();
      this.child = child;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('The music core did not report ready in time'));
      }, this.requestTimeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => this._receive(chunk));
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk) => this.onLog({ type: 'core-stderr', text: String(chunk).trim().slice(0, 200) }));
      child.once('error', (error) => {
        this.onLog({ type: 'core-error', message: error.message });
        if (!settled) { settled = true; clearTimeout(timer); reject(error); }
        this._failAll(error);
      });
      child.once('exit', (code) => {
        this.exitInfo = { code };
        this.onLog({ type: 'core-exit', code });
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`The music core exited during startup with code ${String(code)}`));
        }
        this._failAll(new Error(`The music core exited with code ${String(code)}`));
      });

      this._onReady = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.lastSnapshot = message.snapshot ?? null;
        resolve(message);
      };
    });
    return this.ready;
  }

  _receive(chunk) {
    this.buffer += chunk;
    for (let index; (index = this.buffer.indexOf('\n')) >= 0;) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    if (message.type === 'ready') {
      this._onReady?.(message);
      return;
    }
    if (message.type === 'state') {
      this.lastSnapshot = message.snapshot;
      for (const listener of this.stateListeners) {
        try { listener(message.snapshot, message.reason); } catch { /* listener fault */ }
      }
      return;
    }
    const id = message.id;
    if (id === null || id === undefined) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (message.type === 'error') {
      const error = new Error(message.error?.message ?? 'The music core rejected the request');
      error.code = message.error?.code ?? 'core_error';
      error.retryable = Boolean(message.error?.retryable);
      if (message.error?.details && typeof message.error.details === 'object') error.details = message.error.details;
      if (message.snapshot) this.lastSnapshot = message.snapshot;
      entry.reject(error);
      return;
    }
    if (message.snapshot) this.lastSnapshot = message.snapshot;
    entry.resolve(message);
  }

  _failAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  request(message, { timeoutMs = this.requestTimeoutMs, signal = null, abortable = false } = {}) {
    if (signal?.aborted) return Promise.reject(toolAbortError(signal));
    if (!this.child || this.child.exitCode !== null) {
      return Promise.reject(new Error('The music core is not running'));
    }
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (fn) => (value) => { cleanup(); fn(value); };
      const onAbort = () => {
        if (!abortable || !this.pending.delete(id)) return;
        rejectRequest(toolAbortError(signal));
      };
      const rejectRequest = finish(reject);
      const resolveRequest = finish(resolve);
      timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`The music core did not answer ${String(message.type)} in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      if (abortable) {
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }
      if (!this.pending.has(id)) return;
      try {
        this.child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
      } catch (error) {
        this.pending.delete(id);
        rejectRequest(error);
      }
    });
  }

  async command(command, { timeoutMs, signal } = {}) {
    // Once written, a command is owned by Core. Drain its acknowledgement even
    // if DSH cancels the caller so an accepted side effect is never reported as
    // an unknown outcome that could be retried.
    const answer = await this.request({ type: 'command', command }, { timeoutMs, signal });
    return { snapshot: answer.snapshot, accepted: answer.accepted };
  }

  async sessionEvent(name, { sessionId = null } = {}) {
    const translated = translateSessionEvent({ type: name });
    if (!translated) return { ignored: true, name };
    // The session id is what lets the core tell which session is active, so
    // several open sessions cannot fight over playback (A08) and a transient
    // one cannot rewrite long-term preferences (A06).
    const answer = await this.request({ type: 'session-event', name, sessionId });
    return {
      ignored: false, kind: answer.kind, selected: answer.selected,
      autonomy: answer.autonomy, sessions: answer.sessions, snapshot: answer.snapshot,
    };
  }

  async setQueue(tracks) {
    const answer = await this.request({ type: 'setQueue', tracks });
    return answer.snapshot;
  }

  async stop({ gracefulTimeoutMs = 4000 } = {}) {
    const child = this.child;
    if (!child) return;
    try {
      await this.request({ type: 'shutdown' }, { timeoutMs: 2000 });
    } catch { /* fall through to killing it */ }
    if (child.exitCode === null) {
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(false); }, gracefulTimeoutMs);
        child.once('exit', () => { clearTimeout(timer); resolve(true); });
      });
      this.onLog({ type: 'core-stop', graceful: exited });
    }
    this.child = null;
    this.ready = null;
  }
}

/**
 * Registers the adapter on a Harness profile context. Returns a disposer so a
 * test (or an unload) can take everything back down.
 */
/**
 * Reads a stable identity for a session.
 *
 * The real session object's shape was not recorded by the P0-01 probe, and the
 * installed type declarations are not readable from this checkout, so rather
 * than assume one field this checks the plausible ones in order. `undefined` is
 * a real answer: the core then reports "the event carries no session id" instead
 * of guessing which session was active.
 */
export function sessionIdOf(session) {
  if (!session || typeof session !== 'object') return null;
  const candidates = [session.id, session.sessionId, session.key, session.identity];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    // Some shapes expose identity through a getter-style method.
    if (typeof candidate === 'function') {
      try {
        const value = candidate.call(session);
        if (typeof value === 'string' && value) return value;
      } catch { /* fall through to the next candidate */ }
    }
  }
  // A nested `meta`/`info` object is also plausible; one level is enough.
  for (const nested of [session.meta, session.info, session.state]) {
    const value = sessionIdOfShallow(nested);
    if (value) return value;
  }
  return null;
}

function sessionIdOfShallow(value) {
  if (!value || typeof value !== 'object') return null;
  for (const field of ['id', 'sessionId', 'key']) {
    if (typeof value[field] === 'string' && value[field]) return value[field];
  }
  return null;
}

export function registerAdapter(ctx, { bridge, onLog = () => {}, hostCollector = null }) {
  const disposers = [];
  if (typeof ctx.effect === 'function') {
    disposers.push(ctx.effect(() => () => bridge.stop()));
  }

  if (typeof ctx.on === 'function') {
    // A failure to identify the session must not lose the event entirely: the
    // bridge is told what it can, and the core reports "no session id" rather
    // than guessing which session was active.
    disposers.push(ctx.on('session/event', (session, event) => {
      try{hostCollector?.observeSession(sessionIdOf(session),event);}catch{onLog({type:'host-evidence-error',kind:'session'});}
      const translated = translateSessionEvent(event);
      if (!translated) return;
      const sessionId = sessionIdOf(session);
      if (!sessionId) {
        // Recorded once per event so the real shape can be identified from a
        // live run without guessing at it now.
        onLog({ type: 'session-id-missing', keys: Object.keys(session ?? {}).slice(0, 12) });
      }
      // Fire-and-forget: a music step must never block the host's event loop.
      bridge.sessionEvent(translated.name, { sessionId })
        .catch((error) => onLog({ type: 'session-event-failed', message: error.message }));
    }));
  }

  // Cordis throws when a non-injected service property is read, so every service
// this adapter touches is entered through ctx.inject(). A profile without the
// command service simply gets the tools without the slash commands.
  const withService = (names, register) => {
    if (typeof ctx.inject === 'function') {
      ctx.inject(names, (serviceCtx) => register(serviceCtx));
      return;
    }
    register(ctx);
  };

  if(hostCollector)withService(['llm'],llmCtx=>{
    disposers.push(llmCtx.on('llm/stream',(options,next)=>hostCollector.stream(options,next)));
    hostCollector.attach();
  });

  withService(['tools'], (toolCtx) => {
    const registerTool = spec => { const dispose = toolCtx.tools.register(spec); onLog({ type: 'prompt-register', kind: 'tool', name: spec.name }); return dispose; };
    disposers.push(registerTool({
      name: TOOL_NAMES.status,
      description: 'Report FishFM music state: current track, queue length, listening switches and the last error. No network access.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            track: { type: 'string' },
            paused: { type: 'boolean' },
            status: { type: 'string' },
            queueLength: { type: 'integer' },
          },
          required: ['track', 'paused', 'status', 'queueLength'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(_args, exec) {
        const answer = await bridge.request(
          { type: 'snapshot' }, { signal: exec?.signal, abortable: true },
        );
        const snapshot = answer.snapshot ?? {};
        const current = snapshot.current;
        return {
          track: current ? `${current.track.title || current.track.providerTrackId} (${current.track.provider})` : '',
          paused: snapshot.paused === true,
          status: String(snapshot.status ?? 'unknown'),
          queueLength: Array.isArray(snapshot.queue) ? snapshot.queue.length : 0,
        };
      },
    }));

    disposers.push(registerTool({
      name: TOOL_NAMES.control,
      description: 'Control FishFM playback: pause, resume, next, or stop autonomous listening for today. Local only; never contacts a music platform.',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['pause', 'resume', 'next', 'stop_for_today', 'choose_self'] } },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            paused: { type: 'boolean' },
            status: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['accepted', 'paused', 'status', 'error'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        const map = {
          pause: 'pause', resume: 'resume', next: 'next',
          stop_for_today: 'stopForToday', choose_self: 'chooseSelf',
        };
        const type = map[args?.action];
        if (!type) return { accepted: false, paused: false, status: 'unknown', error: 'unknown action' };
        try {
          const answer = await bridge.command({ type }, { signal: exec?.signal });
          return {
            accepted: true,
            paused: answer.snapshot?.paused === true,
            status: String(answer.snapshot?.status ?? 'unknown'),
            error: '',
          };
        } catch (error) {
          return { accepted: false, paused: false, status: 'error', error: String(error.code ?? error.message) };
        }
      },
    }));

    disposers.push(registerTool({
      name: TOOL_NAMES.request,
      description: 'Ask FishFM to play one specific track by platform id. Acceptance may report resolving; use fishfm_status to inspect later playback or platform failures. A banned track fails immediately with a named reason.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['netease', 'qq'] },
          providerTrackId: { type: 'string' },
        },
        required: ['provider', 'providerTrackId'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            status: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['accepted', 'status', 'error'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        try {
          const answer = await bridge.command({
            type: 'requestTrack',
            track: { provider: args?.provider, providerTrackId: args?.providerTrackId },
          }, { signal: exec?.signal });
          return { accepted: true, status: String(answer.snapshot?.status ?? 'unknown'), error: '' };
        } catch (error) {
          // Never pretend a different track played: report the real reason.
          return { accepted: false, status: 'error', error: String(error.code ?? error.message) };
        }
      },
    }));
  });

  withService(['commands'], (commandCtx) => {
    const registerCommand = spec => { const dispose = commandCtx.commands.register(spec); onLog({ type: 'prompt-register', kind: 'command', name: spec.name }); return dispose; };
    disposers.push(registerCommand({
      name: COMMAND_NAMES[0],
      description: 'Show FishFM music state.',
      handler: async () => {
        const answer = await bridge.request({ type: 'snapshot' });
        const current = answer.snapshot?.current;
        const label = current ? `${current.track.title || current.track.providerTrackId}` : 'nothing is playing';
        return { kind: 'success', text: `FishFM: ${label} (${answer.snapshot?.status ?? 'unknown'})` };
      },
    }));
    disposers.push(registerCommand({
      name: COMMAND_NAMES[1],
      description: 'Pause FishFM playback. Autonomous events cannot undo this.',
      handler: async () => {
        await bridge.command({ type: 'pause' });
        return { kind: 'success', text: 'FishFM paused.' };
      },
    }));
    disposers.push(registerCommand({
      name: COMMAND_NAMES[2],
      description: 'Play the next queued track in FishFM.',
      handler: async () => {
        try {
          await bridge.command({ type: 'next' });
          return { kind: 'success', text: 'FishFM: next track.' };
        } catch (error) {
          return { kind: 'error', text: `FishFM: ${String(error.code ?? error.message)}` };
        }
      },
    }));
  });

  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose(); } catch { /* already gone */ }
    }
  };
}
