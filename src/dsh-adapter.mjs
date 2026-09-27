// DSH adapter: the bridge between the real Harness and the music core process.
//
// Verified against the installed Harness (0.1.7-rc.2) in P0-01:
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

  request(message, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.reject(new Error('The music core is not running'));
    }
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The music core did not answer ${String(message.type)} in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async command(command, { timeoutMs } = {}) {
    const answer = await this.request({ type: 'command', command }, { timeoutMs });
    return { snapshot: answer.snapshot, accepted: answer.accepted };
  }

  async sessionEvent(name) {
    const translated = translateSessionEvent({ type: name });
    if (!translated) return { ignored: true, name };
    const answer = await this.request({ type: 'session-event', name });
    return { ignored: false, kind: answer.kind, selected: answer.selected, snapshot: answer.snapshot };
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
export function registerAdapter(ctx, { bridge, onLog = () => {} }) {
  const disposers = [];
  if (typeof ctx.effect === 'function') {
    disposers.push(ctx.effect(() => () => bridge.stop()));
  }

  if (typeof ctx.on === 'function') {
    disposers.push(ctx.on('session/event', (_session, event) => {
      const translated = translateSessionEvent(event);
      if (!translated) return;
      // Fire-and-forget: a music step must never block the host's event loop.
      bridge.sessionEvent(translated.name).catch((error) => onLog({ type: 'session-event-failed', message: error.message }));
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

  withService(['tools'], (toolCtx) => {
    disposers.push(toolCtx.tools.register({
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
      async execute() {
        const answer = await bridge.request({ type: 'snapshot' });
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

    disposers.push(toolCtx.tools.register({
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
      async execute(args) {
        const map = {
          pause: 'pause', resume: 'resume', next: 'next',
          stop_for_today: 'stopForToday', choose_self: 'chooseSelf',
        };
        const type = map[args?.action];
        if (!type) return { accepted: false, paused: false, status: 'unknown', error: 'unknown action' };
        try {
          const answer = await bridge.command({ type });
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

    disposers.push(toolCtx.tools.register({
      name: TOOL_NAMES.request,
      description: 'Ask FishFM to play one specific track by platform id. Fails with a named reason when that platform is not connected or the track is banned.',
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
      async execute(args) {
        try {
          const answer = await bridge.command({
            type: 'requestTrack',
            track: { provider: args?.provider, providerTrackId: args?.providerTrackId },
          });
          return { accepted: true, status: String(answer.snapshot?.status ?? 'unknown'), error: '' };
        } catch (error) {
          // Never pretend a different track played: report the real reason.
          return { accepted: false, status: 'error', error: String(error.code ?? error.message) };
        }
      },
    }));
  });

  withService(['commands'], (commandCtx) => {
    disposers.push(commandCtx.commands.register({
      name: COMMAND_NAMES[0],
      description: 'Show FishFM music state.',
      handler: async () => {
        const answer = await bridge.request({ type: 'snapshot' });
        const current = answer.snapshot?.current;
        const label = current ? `${current.track.title || current.track.providerTrackId}` : 'nothing is playing';
        return { kind: 'success', text: `FishFM: ${label} (${answer.snapshot?.status ?? 'unknown'})` };
      },
    }));
    disposers.push(commandCtx.commands.register({
      name: COMMAND_NAMES[1],
      description: 'Pause FishFM playback. Autonomous events cannot undo this.',
      handler: async () => {
        await bridge.command({ type: 'pause' });
        return { kind: 'success', text: 'FishFM paused.' };
      },
    }));
    disposers.push(commandCtx.commands.register({
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