// Wire protocol between the music core and an out-of-process audio host.
// One JSON object per LF-terminated UTF-8 line over same-user local IPC.
import { MusicError } from '../contracts.mjs';

/** Bump when any message shape below changes in a way an older peer cannot read. */
export const PROTOCOL_VERSION = 1;

export const HOST_COMMANDS = Object.freeze(['load', 'play', 'pause', 'stop', 'setMuted', 'snapshot', 'ping', 'shutdown']);

export const HOST_EVENTS = Object.freeze(['started', 'progress', 'ended', 'error', 'exiting']);

export const HOST_STATUSES = Object.freeze(['idle', 'loading', 'ready', 'playing', 'paused', 'ended', 'error']);

export function playbackError(code, message, { retryable = false } = {}) {
  return new MusicError(code, message, { retryable });
}

export function encodeMessage(value) {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Incremental LF decoder. A malformed line is a protocol violation, not a
 * recoverable condition: silently skipping it would hide a desynchronized host.
 */
export function createLineDecoder() {
  let buffer = '';
  let malformed = 0;
  return {
    push(chunk) {
      buffer += chunk;
      const messages = [];
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          malformed += 1;
          throw playbackError('protocol_error', 'Audio host sent a line that is not JSON');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          malformed += 1;
          throw playbackError('protocol_error', 'Audio host sent a message that is not an object');
        }
        messages.push(parsed);
      }
      return messages;
    },
    stats() { return { buffered: buffer.length, malformed }; },
  };
}

export function assertHello(hello, expected = PROTOCOL_VERSION) {
  if (!hello || hello.type !== 'hello') {
    throw playbackError('protocol_error', 'Audio host did not greet the client');
  }
  if (hello.protocol !== expected) {
    throw playbackError('protocol_mismatch',
      `Audio host speaks protocol ${String(hello.protocol)}, this build expects ${expected}`);
  }
  return hello;
}

export function resultError(message) {
  const error = message?.error ?? {};
  const code = typeof error.code === 'string' && error.code ? error.code : 'playback_error';
  const text = typeof error.message === 'string' && error.message ? error.message : 'Audio host rejected the command';
  return playbackError(code, text, { retryable: error.retryable === true });
}
