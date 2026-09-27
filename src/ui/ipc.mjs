// The UI bridge's real transport: a loopback IPC channel between the desktop
// panel and the core host.
//
// ARCHITECTURE line 115 sets the rules this implements:
//   - "若使用本地端口，只绑定回环" — the listener binds 127.0.0.1 explicitly, never
//     0.0.0.0, so nothing off this machine can reach it;
//   - "校验调用身份" — a shared token, written to a file only this user can read,
//     must be presented before any line is accepted. A connection without it is
//     closed, and the refusal says nothing about whether the token was close;
//   - "都需要协议版本、断线快照和退出通知" — the version handshake and disconnect
//     snapshot live in the bridge (bridge.mjs); the greeting and the exit
//     notification are sent here.
//
// Line length is bounded, so a peer cannot make the host buffer without limit.
import { createServer, connect as connectSocket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Bumped when the IPC framing changes; the bridge owns the envelope version. */
export const IPC_TRANSPORT_VERSION = 1;

/** A single line may not exceed this, in bytes. */
export const MAX_LINE_BYTES = 256 * 1024;

/** The token file name inside the state directory. */
export const TOKEN_FILE = 'ui-token';

/**
 * Creates (or reuses) the shared token the panel must present.
 *
 * Written with owner-only permissions. On Windows those mode bits are advisory,
 * so the file also lives under the user's own state directory rather than a
 * shared one — a real limitation, stated rather than papered over.
 */
export function ensureUiToken(directory, { rotate = false } = {}) {
  const path = tokenPath(directory);
  mkdirSync(directory, { recursive: true });
  if (!rotate) {
    try {
      const existing = readFileSync(path, 'utf8').trim();
      if (existing.length >= 32) return { token: existing, path, created: false };
    } catch { /* fall through and create one */ }
  }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch { /* best effort; Windows mode bits are advisory */ }
  return { token, path, created: true };
}

export function readUiToken(directory) {
  try {
    return readFileSync(tokenPath(directory), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function forgetUiToken(directory) {
  try {
    rmSync(tokenPath(directory), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function tokenPath(directory) {
  return join(directory, TOKEN_FILE);
}

/** Constant-time comparison that never throws on a length mismatch. */
function tokenMatches(expected, received) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) {
    // Compare something of the right shape first, so a wrong length does not
    // return measurably faster and reveal the token's length.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Starts the host side of the channel.
 *
 * @param {object} options
 * @param {string} options.token        The shared token clients must present.
 * @param {number} [options.port]       0 lets the OS choose.
 * @param {string} [options.host]       Fixed to loopback; not configurable on purpose.
 * @param {number} [options.greetingProtocol] Protocol version announced in `ready`.
 */
export async function startUiServer({
  token,
  port = 0,
  host = '127.0.0.1',
  greetingProtocol = 1,
  onLine = () => {},
  onLog = () => {},
  maxLineBytes = MAX_LINE_BYTES,
} = {}) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('A token of at least 16 characters is required');
  }
  if (host !== '127.0.0.1' && host !== '::1') {
    // Refusing anything else is the point: a listener on 0.0.0.0 would expose the
    // music service to the local network.
    throw new Error('The UI channel may only bind loopback');
  }

  const clients = new Set();
  let closing = false;

  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let authenticated = false;
    let buffer = '';
    let authTimer = setTimeout(() => {
      // A peer that connects and says nothing must not hold a slot forever.
      onLog({ type: 'ipc', event: 'auth-timeout' });
      socket.destroy();
    }, 5000);

    const client = { socket, authenticated: false, send: (line) => socket.write(`${line}\n`) };
    clients.add(socket);

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > maxLineBytes) {
        onLog({ type: 'ipc', event: 'line-too-long', bytes: buffer.length });
        socket.destroy();
        return;
      }
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        if (!authenticated) {
          let hello = null;
          try {
            hello = JSON.parse(line);
          } catch {
            onLog({ type: 'ipc', event: 'auth-malformed' });
            socket.destroy();
            return;
          }
          if (hello?.type !== 'auth' || !tokenMatches(token, hello.token)) {
            // Say nothing beyond the refusal: whether the token was close is not
            // information a peer should get.
            onLog({ type: 'ipc', event: 'auth-refused' });
            socket.write(`${JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'error', error: { code: 'unauthorized', message: 'authentication required' } })}\n`);
            socket.destroy();
            return;
          }
          authenticated = true;
          client.authenticated = true;
          clearTimeout(authTimer);
          authTimer = null;
          socket.write(`${JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'authenticated' })}\n`);
          // Greet with the panel protocol so a freshly attached panel learns the
          // version before it consumes anything.
          socket.write(`${JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'ready', protocol: greetingProtocol })}\n`);
          onLog({ type: 'ipc', event: 'authenticated' });
          continue;
        }
        onLine(line, client);
      }
    });

    socket.on('error', () => { /* a broken peer is not the host's problem */ });
    socket.on('close', () => {
      clients.delete(socket);
      if (authTimer) clearTimeout(authTimer);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    port: address.port,
    host: address.address,
    /** Sends a line to every connected client. */
    broadcast(line) {
      const text = `${line}\n`;
      let sent = 0;
      for (const socket of clients) {
        if (!socket.destroyed) { socket.write(text); sent += 1; }
      }
      return sent;
    },
    clientCount: () => clients.size,
    /** Tells the panel the music service is going away, then stops listening. */
    async close({ notify = true } = {}) {
      if (closing) return;
      closing = true;
      if (notify) {
        const line = `${JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'exiting' })}\n`;
        for (const socket of clients) {
          try { socket.write(line); } catch { /* already gone */ }
        }
        // Give the notification a moment to leave before the sockets are cut.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      for (const socket of clients) socket.destroy();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * The panel side: connects, authenticates, and hands lines to `onMessage`.
 * Shaped to match what the UI bridge expects from a transport.
 */
export function createIpcClient({
  token = null,
  port,
  host = '127.0.0.1',
  onMessage = () => {},
  onClose = () => {},
  onLog = () => {},
  maxLineBytes = MAX_LINE_BYTES,
} = {}) {
  let socket = null;
  let buffer = '';
  let authenticated = false;
  let closedByUs = false;

  return {
    get authenticated() { return authenticated; },
    get connected() { return Boolean(socket) && !socket.destroyed; },

    connect() {
      return new Promise((resolve, reject) => {
        closedByUs = false;
        authenticated = false;
        buffer = '';
        const attempt = connectSocket({ port, host });
        const fail = (error) => { attempt.destroy(); reject(error); };
        attempt.once('error', fail);
        attempt.once('connect', () => {
          attempt.off('error', fail);
          socket = attempt;
          attempt.setEncoding('utf8');
          attempt.on('data', (chunk) => {
            buffer += chunk;
            if (buffer.length > maxLineBytes) {
              onLog({ type: 'ipc-client', event: 'line-too-long' });
              attempt.destroy();
              return;
            }
            for (let index; (index = buffer.indexOf('\n')) >= 0;) {
              const line = buffer.slice(0, index).trim();
              buffer = buffer.slice(index + 1);
              if (!line) continue;
              let envelope = null;
              try {
                envelope = JSON.parse(line);
              } catch {
                continue;
              }
              if (envelope?.type === 'authenticated') {
                authenticated = true;
                onLog({ type: 'ipc-client', event: 'authenticated' });
                resolve();
                continue;
              }
              if (envelope?.type === 'error' && envelope.error?.code === 'unauthorized') {
                onLog({ type: 'ipc-client', event: 'unauthorized' });
                attempt.destroy();
                reject(new Error('the host refused the connection: authentication required'));
                continue;
              }
              onMessage(line);
            }
          });
          attempt.on('error', () => { /* reported through close */ });
          attempt.on('close', () => {
            socket = null;
            authenticated = false;
            if (!closedByUs) onClose('ipc connection closed');
          });
          // Present the token first; nothing else is accepted before it.
          attempt.write(`${JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'auth', token })}\n`);
        });
      });
    },

    send(line) {
      if (!socket || socket.destroyed) throw new Error('the ipc channel is not connected');
      socket.write(`${line}\n`);
    },

    close() {
      closedByUs = true;
      try { socket?.destroy(); } catch { /* already gone */ }
      socket = null;
      authenticated = false;
    },
  };
}