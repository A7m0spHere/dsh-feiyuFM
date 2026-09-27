// Same-user local pipe transport. One transport instance serves one connection;
// the supervisor creates a fresh instance per (re)connect so a half-open socket
// can never be reused by accident.
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createLineDecoder, encodeMessage, playbackError, resultError } from './protocol.mjs';

export function pipePath(name) {
  if (process.platform !== 'win32') {
    throw playbackError('unsupported_platform', 'The local playback pipe currently requires Windows');
  }
  if (!name || /[\\/]/.test(name)) throw playbackError('invalid_pipe_name', 'Pipe name must be a plain name');
  return `\\\\.\\pipe\\${name}`;
}

export class PipeTransport {
  constructor({ name, onMessage = () => {}, onClose = () => {}, label = 'playback' }) {
    this.name = name;
    this.label = label;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.socket = null;
    this.pending = new Map();
    this.decoder = createLineDecoder();
    this.closeReason = null;
    this.closed = false;
  }

  get connected() {
    return Boolean(this.socket) && !this.socket.destroyed;
  }

  connect({ timeoutMs = 5000 } = {}) {
    if (this.connected) return Promise.resolve();
    if (this.closed) return Promise.reject(playbackError('pipe_closed', 'Transport was already closed', { retryable: true }));
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(pipePath(this.name));
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(playbackError('host_unavailable', 'Timed out connecting to the audio host pipe', { retryable: true }));
      }, timeoutMs);
      socket.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(playbackError('host_unavailable', `Audio host pipe failed: ${error.code ?? error.message}`, { retryable: true }));
      });
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = socket;
        socket.setEncoding('utf8');
        socket.setNoDelay(true);
        socket.on('data', (chunk) => this._receive(chunk));
        socket.on('error', () => { /* Reported through close. */ });
        socket.on('close', () => this._closed());
        resolve();
      });
    });
  }

  _receive(chunk) {
    let messages;
    try {
      messages = this.decoder.push(chunk);
    } catch (error) {
      this.fail(error);
      return;
    }
    for (const message of messages) {
      if (message.type === 'result' && typeof message.id === 'string') {
        const entry = this.pending.get(message.id);
        if (entry) {
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.ok === false) entry.reject(resultError(message));
          else entry.resolve(message);
          continue;
        }
      }
      try {
        this.onMessage(message);
      } catch { /* A listener fault must not desynchronize the stream. */ }
    }
  }

  request(command, { timeoutMs = 5000 } = {}) {
    if (!this.connected) {
      return Promise.reject(playbackError('pipe_closed', 'Audio host pipe is not connected', { retryable: true }));
    }
    const id = typeof command.id === 'string' && command.id ? command.id : randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.fail(playbackError('command_timeout', `Audio host did not answer ${String(command.type)} in time`, { retryable: true }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.write(encodeMessage({ ...command, id }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.fail(playbackError('pipe_closed', `Could not write to the audio host pipe: ${error.message}`, { retryable: true }));
      }
    });
  }

  /** Marks the connection unusable and settles everything waiting on it. */
  fail(error) {
    this.closeReason = this.closeReason ?? error;
    if (this.socket) this.socket.destroy();
    else this._closed();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.socket = null;
    const error = this.closeReason ?? playbackError('pipe_closed', 'Audio host pipe closed', { retryable: true });
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.onClose(error);
  }

  close({ reason = null } = {}) {
    this.closeReason = reason ?? playbackError('pipe_closed', 'Transport closed by this process', { retryable: true });
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
    }
    this._closed();
  }
}