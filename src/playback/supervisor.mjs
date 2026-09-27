// Owns the audio host process: spawn, greeting handshake, reconnect and shutdown.
// The supervisor never interprets playback semantics; it only guarantees that a
// protocol-compatible host is reachable and that it dies when this process does.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PROTOCOL_VERSION, assertHello, playbackError } from './protocol.mjs';
import { PipeTransport } from './transport.mjs';
import { candidateCommandLine, requireWindows, wpfBackend } from './backends.mjs';

const MARKER_PREFIX = 'FISHFM_PLAYBACK_';
const DIAGNOSTIC_LIMIT = 40;

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    child.once('exit', onExit);
  });
}

export class PlaybackSupervisor {
  constructor({
    backend = wpfBackend(),
    pipeName = `fishfm-playback-${randomUUID()}`,
    ownerPid = process.pid,
    protocol = PROTOCOL_VERSION,
    startupTimeoutMs = 20000,
    greetTimeoutMs = 5000,
    connectTimeoutMs = 5000,
    reconnectDelayMs = 120,
    onMessage = () => {},
    onHostClose = () => {},
    onLog = () => {},
    platform = process.platform,
  } = {}) {
    this.backend = backend;
    this.pipeName = pipeName;
    this.ownerPid = ownerPid;
    this.protocol = protocol;
    this.startupTimeoutMs = startupTimeoutMs;
    this.greetTimeoutMs = greetTimeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.onMessage = onMessage;
    this.onHostClose = onHostClose;
    this.onLog = onLog;
    this.platform = platform;

    this.child = null;
    this.transport = null;
    this.hello = null;
    this.hostState = null;
    this.candidateIndex = 0;
    this.spawnCount = 0;
    this.disposed = false;
    this.generation = 0;
    this.diagnostics = [];
    this.markers = [];
    this._greeting = false;
    this._buffer = [];
    this._helloWaiter = null;
    this._expectingClose = false;
    this._ensuring = null;
  }

  get pid() { return this.child?.pid ?? null; }

  get alive() { return Boolean(this.child) && this.child.exitCode === null; }

  get connected() { return Boolean(this.transport?.connected) && Boolean(this.hello); }

  diagnosticText() {
    return this.diagnostics.length ? this.diagnostics.join(' | ') : 'no audio host output captured';
  }

  /**
   * Starts or reuses a host and returns its greeting payload.
   *
   * Concurrent callers share one attempt: without that, two commands issued
   * back to back can both decide the host is missing, spawn two processes and
   * tear down each other's socket. A live process whose socket is not up yet
   * (normal during startup) is retried to a deadline instead of failing once.
   */
  async ensureHost() {
    if (this.disposed) throw playbackError('host_unavailable', 'Playback supervisor was disposed');
    requireWindows(this.platform);
    if (this.alive && this.connected) return this.hello;
    if (this._ensuring) return this._ensuring;
    this._ensuring = this._ensureHostOnce().finally(() => { this._ensuring = null; });
    return this._ensuring;
  }

  async _ensureHostOnce() {
    if (this.alive) {
      const deadline = Date.now() + this.startupTimeoutMs;
      let lastError = null;
      while (Date.now() < deadline) {
        if (this.disposed) throw playbackError('host_unavailable', 'Playback supervisor was disposed');
        if (!this.alive) break;
        try {
          await this._connectAndGreet();
          return this.hello;
        } catch (error) {
          if (error.code === 'protocol_mismatch') throw error;
          lastError = error;
          this._teardownConnection(playbackError('pipe_closed', 'Retrying the audio host connection', { retryable: true }));
          await delay(this.reconnectDelayMs);
        }
      }
      if (this.alive) {
        throw playbackError('host_unavailable',
          `Audio host did not answer on pipe ${this.pipeName} within ${this.startupTimeoutMs} ms: ${lastError?.message ?? 'no response'}`,
          { retryable: true });
      }
    }
    this._teardownConnection(playbackError('pipe_closed', 'Audio host was replaced', { retryable: true }));
    this.child = null;
    this.hello = null;
    await this._spawnHost();
    return this.hello;
  }

  async _spawnHost() {
    const candidates = this.backend.candidates ?? [];
    if (!candidates.length) throw playbackError('host_unavailable', 'No audio host candidate is configured');
    const failures = [];
    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const candidate = candidates[this.candidateIndex % candidates.length];
      this.candidateIndex += 1;
      try {
        await this._spawnCandidate(candidate);
        this.markers.push(`shell:${candidate.label}`);
        return;
      } catch (error) {
        failures.push(`${candidate.label}: ${error.message}`);
        this.diagnostics.push(`${candidate.label} failed: ${error.message}`);
        this._killChild();
      }
    }
    throw playbackError('host_unavailable',
      `Could not start an audio host (${failures.join('; ')}). ${this.diagnosticText()}`, { retryable: true });
  }

  async _spawnCandidate(candidate) {
    const context = { pipeName: this.pipeName, ownerPid: this.ownerPid, protocol: this.protocol };
    const { command, args, env } = candidateCommandLine(this.backend, candidate, context);
    const child = spawn(command, args, {
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    this.child = child;
    this.spawnCount += 1;
    this.generation += 1;
    this._attachOutput(child);

    let spawnFailure = null;
    child.once('error', (error) => { spawnFailure = error; });
    child.once('exit', (code) => {
      this.diagnostics.push(`host exited with code ${String(code)}`);
      if (this.child === child) {
        this.child = null;
        this.hello = null;
        this._teardownConnection(playbackError('playback_host_lost', `Audio host exited with code ${String(code)}`, { retryable: true }));
      }
    });

    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      if (spawnFailure) throw playbackError('host_unavailable', `Could not spawn ${candidate.label}: ${spawnFailure.message}`, { retryable: true });
      if (child.exitCode !== null) {
        throw playbackError('host_unavailable', `Audio host exited during startup with code ${String(child.exitCode)}`, { retryable: true });
      }
      try {
        await this._connectAndGreet();
        return;
      } catch (error) {
        lastError = error;
        if (error.code === 'protocol_mismatch') throw error;
      }
      await delay(this.reconnectDelayMs);
    }
    throw playbackError('host_unavailable',
      `Audio host did not answer on pipe ${this.pipeName} within ${this.startupTimeoutMs} ms: ${lastError?.message ?? 'no response'}`,
      { retryable: true });
  }

  async _connectAndGreet() {
    this._teardownConnection(playbackError('pipe_closed', 'Superseded by a new connection', { retryable: true }));
    const transport = new PipeTransport({
      name: this.pipeName,
      onMessage: (message) => this._handleMessage(message),
      onClose: (error) => this._handleClose(error),
    });
    await transport.connect({ timeoutMs: this.connectTimeoutMs }).catch((error) => {
      // Startup ENOENT is expected until the host creates its pipe; report it as
      // retryable so callers keep waiting instead of surfacing a hard failure.
      throw playbackError('host_unavailable', error.message, { retryable: true });
    });
    this.transport = transport;
    this._greeting = true;
    this._buffer = [];
    try {
      const hello = await this._waitForHello();
      assertHello(hello, this.protocol);
      this.hello = hello;
      this._greeting = false;
      const buffered = this._buffer;
      this._buffer = [];
      for (const message of buffered) this._deliver(message);
    } catch (error) {
      this._greeting = false;
      this._buffer = [];
      transport.fail(error.code === 'protocol_mismatch'
        ? error
        : playbackError('host_unavailable', 'Audio host did not greet this client', { retryable: true }));
      this.transport = null;
      throw error.code === 'protocol_mismatch'
        ? error
        : playbackError('host_unavailable', `Audio host greeting failed: ${error.message}`, { retryable: true });
    }
    return this.hello;
  }

  _waitForHello() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._helloWaiter = null;
        reject(playbackError('host_unavailable', 'Audio host did not greet this client in time', { retryable: true }));
      }, this.greetTimeoutMs);
      this._helloWaiter = (hello) => {
        clearTimeout(timer);
        this._helloWaiter = null;
        resolve(hello);
      };
    });
  }

  _handleMessage(message) {
    if (this._greeting) {
      if (message.type === 'hello') this._helloWaiter?.(message);
      else this._buffer.push(message);
      return;
    }
    if (message.type === 'hello') return;
    this._deliver(message);
  }

  _deliver(message) {
    if (message.type === 'state') this.hostState = message;
    try {
      this.onMessage(message);
    } catch { /* Listener faults must not break the supervisor. */ }
  }

  _handleClose(error) {
    if (this._expectingClose || this.disposed) return;
    this.onHostClose(error);
  }

  _teardownConnection(reason) {
    if (!this.transport) return;
    this._expectingClose = true;
    try {
      this.transport.close({ reason });
    } finally {
      this._expectingClose = false;
      this.transport = null;
      this.hello = null;
    }
  }

  _attachOutput(child) {
    for (const [stream, name] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
      if (!stream) continue;
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buffer += chunk;
        for (let index; (index = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          this.diagnostics.push(`${name}: ${line}`);
          if (this.diagnostics.length > DIAGNOSTIC_LIMIT) this.diagnostics.shift();
          if (line.includes(MARKER_PREFIX)) this.markers.push(line);
          try { this.onLog({ stream: name, line }); } catch { /* Diagnostics only. */ }
        }
      });
      stream.on('error', () => { /* The exit handler reports the real failure. */ });
    }
  }

  request(command, options = {}) {
    if (this.disposed) {
      return Promise.reject(playbackError('host_unavailable', 'Playback supervisor was disposed'));
    }
    return this.ensureHost().then((hello) => {
      if (!this.transport?.connected) {
        throw playbackError('pipe_closed', 'Audio host pipe is not connected', { retryable: true });
      }
      return this.transport.request({ ...command, host: hello.pid }, options);
    });
  }

  _killChild() {
    const child = this.child;
    this.child = null;
    this.hello = null;
    this._teardownConnection(playbackError('pipe_closed', 'Audio host was stopped', { retryable: true }));
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* Already gone. */ }
    }
  }

  /** Stops the host. Used by plugin teardown and by tests. */
  async dispose({ gracefulTimeoutMs = 2000 } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    if (this.transport?.connected) {
      try {
        await this.transport.request({ type: 'shutdown' }, { timeoutMs: 1000 });
      } catch { /* Fall back to killing the process below. */ }
    }
    this._teardownConnection(playbackError('pipe_closed', 'Supervisor disposed', { retryable: true }));
    this.child = null;
    this.hello = null;
    if (!child) return;
    if (!await waitForExit(child, gracefulTimeoutMs)) {
      this.diagnostics.push('host ignored shutdown; killing it');
      try { child.kill(); } catch { /* Already gone. */ }
      await waitForExit(child, 2000);
    }
  }
}