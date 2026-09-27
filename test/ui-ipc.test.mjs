// The UI IPC channel, verified over real loopback sockets.
//
// ARCHITECTURE line 115 requires a loopback-only listener, caller identity
// validation, and an exit notification. Each is asserted here against a real
// socket rather than a stand-in, because "it only binds loopback" is exactly the
// kind of claim a fake transport would happily confirm without being true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import {
  startUiServer, createIpcClient, ensureUiToken, readUiToken, forgetUiToken,
  tokenPath, IPC_TRANSPORT_VERSION, MAX_LINE_BYTES,
} from '../src/ui/ipc.mjs';
import { createUiBridge, UI_BRIDGE_PROTOCOL } from '../src/ui/bridge.mjs';

const TOKEN = 'test-token-that-is-long-enough-abcdef';

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-ipc-'));
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/** A raw client that speaks the framing directly, for the refusal cases. */
function rawClient(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => resolve({
      socket,
      write: (line) => socket.write(`${line}\n`),
      lines: [],
      collect() {
        return new Promise((done) => {
          socket.on('data', (chunk) => {
            for (const line of String(chunk).split('\n')) if (line.trim()) this.lines.push(JSON.parse(line));
          });
          socket.on('close', () => done(this.lines));
          setTimeout(() => done(this.lines), 400);
        });
      },
    }));
    socket.once('error', reject);
  });
}

test('the listener binds loopback only, and refuses to bind anything else', async () => {
  const server = await startUiServer({ token: TOKEN });
  try {
    assert.equal(server.host, '127.0.0.1', 'it bound loopback explicitly');
    assert.notEqual(server.host, '0.0.0.0', 'a listener on 0.0.0.0 would expose the service to the network');
    assert.ok(server.port > 0, 'the OS chose a port');

    // It is reachable over loopback, which is the only place it should be.
    const client = createIpcClient({ token: TOKEN, port: server.port });
    await client.connect();
    assert.equal(client.authenticated, true);
    client.close();
  } finally {
    await server.close();
  }

  // Asking for anything but loopback is refused rather than quietly accepted.
  for (const host of ['0.0.0.0', '192.168.1.10', 'localhost']) {
    await assert.rejects(
      () => startUiServer({ token: TOKEN, host }),
      /only bind loopback/,
      `${host} must be refused`,
    );
  }
});

test('a connection without the token is refused and told nothing useful', async () => {
  const server = await startUiServer({ token: TOKEN });
  try {
    const client = await rawClient(server.port);
    client.write(JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'auth', token: 'wrong-but-same-length-xxxxxxxxxxxxxxx' }));
    const lines = await client.collect();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'error');
    assert.equal(lines[0].error.code, 'unauthorized');
    // The refusal must not hint at how close the token was.
    assert.equal(JSON.stringify(lines[0]).includes(TOKEN.slice(0, 6)), false);
    assert.equal(server.clientCount(), 0, 'the socket was dropped');
  } finally {
    await server.close();
  }
});

test('a malformed or missing handshake is refused', async () => {
  const server = await startUiServer({ token: TOKEN });
  try {
    const garbage = await rawClient(server.port);
    garbage.write('not json at all');
    await garbage.collect();
    assert.equal(server.clientCount(), 0, 'a non-handshake line closes the socket');

    const silent = await rawClient(server.port);
    // Say nothing at all: the auth timeout must reclaim the slot.
    await new Promise((resolve) => setTimeout(resolve, 300));
    silent.socket.destroy();
    assert.ok(server.clientCount() <= 1);
  } finally {
    await server.close();
  }
});

test('an authenticated client exchanges lines, and the token is required first', async () => {
  const received = [];
  const server = await startUiServer({ token: TOKEN, onLine: (line, client) => {
    received.push(line);
    client.send(JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'result', id: 'x', ok: true }));
  } });
  try {
    const lines = [];
    const client = createIpcClient({
      token: TOKEN, port: server.port,
      onMessage: (line) => lines.push(JSON.parse(line)),
    });
    await client.connect();
    client.send(JSON.stringify({ v: UI_BRIDGE_PROTOCOL, type: 'snapshot', id: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(received, [JSON.stringify({ v: UI_BRIDGE_PROTOCOL, type: 'snapshot', id: 'x' })]);
    assert.equal(lines.at(-1).ok, true, 'the answer came back');
    client.close();
  } finally {
    await server.close();
  }
});

test('a client with the wrong token cannot connect at all', async () => {
  const server = await startUiServer({ token: TOKEN });
  try {
    const client = createIpcClient({ token: 'a-completely-different-token-value', port: server.port });
    await assert.rejects(() => client.connect(), /authentication required/);
  } finally {
    await server.close();
  }
});

test('an oversized line is dropped instead of buffered', async () => {
  const logs = [];
  const server = await startUiServer({ token: TOKEN, onLog: (entry) => logs.push(entry), maxLineBytes: 512 });
  try {
    const client = await rawClient(server.port);
    client.write(JSON.stringify({ v: IPC_TRANSPORT_VERSION, type: 'auth', token: TOKEN }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    client.write(`{"type":"state","padding":"${'x'.repeat(2000)}"}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(logs.some((entry) => entry.event === 'line-too-long'), 'the limit was enforced and reported');
    assert.equal(server.clientCount(), 0, 'and the peer was dropped');
  } finally {
    await server.close();
  }
});

test('shutdown notifies the panel before the channel disappears', async () => {
  const server = await startUiServer({ token: TOKEN });
  const lines = [];
  const client = createIpcClient({ token: TOKEN, port: server.port, onMessage: (line) => lines.push(JSON.parse(line)) });
  await client.connect();
  await server.close();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(lines.at(-1)?.type, 'exiting', 'the panel is told the service is going away');

  // And that notification is what stops a reconnect, per the bridge.
  const bridge = createUiBridge({
    transport: { connect: async () => {}, send: () => {}, close: () => {} },
  });
  await bridge.connect();
  bridge.handleMessage({ type: 'ready', protocol: UI_BRIDGE_PROTOCOL, snapshot: { revision: 1 } });
  assert.equal(bridge.handleMessage(lines.at(-1)).kind, 'exiting');
  assert.equal(bridge.status, 'closed');
});

test('the token is created once, kept private, and can be rotated', () => {
  const { directory, cleanup } = scratch();
  try {
    const first = ensureUiToken(directory);
    assert.equal(first.created, true);
    assert.ok(first.token.length >= 32, 'a real token, not a placeholder');
    assert.equal(readUiToken(directory), first.token);
    assert.equal(tokenPath(directory).endsWith('ui-token'), true);

    // Reusing the state directory keeps the same token, so a restarting panel
    // does not lose access.
    const again = ensureUiToken(directory);
    assert.equal(again.created, false);
    assert.equal(again.token, first.token);

    // Rotation is explicit.
    const rotated = ensureUiToken(directory, { rotate: true });
    assert.equal(rotated.created, true);
    assert.notEqual(rotated.token, first.token);
    assert.equal(readUiToken(directory), rotated.token);

    // The file holds only the token, and the mode is owner-only where the
    // platform honours it.
    const raw = readFileSync(join(directory, 'ui-token'), 'utf8').trim();
    assert.equal(raw, rotated.token);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(directory, 'ui-token')).mode & 0o077, 0, 'no group or other access');
    }

    assert.equal(forgetUiToken(directory), true);
    assert.equal(readUiToken(directory), null);
  } finally {
    cleanup();
  }
});

test('a short token is refused, because a guessable one is not authentication', async () => {
  await assert.rejects(() => startUiServer({ token: 'short' }), /at least 16 characters/);
  await assert.rejects(() => startUiServer({}), /at least 16 characters/);
});

test('the bridge runs over the real channel end to end', async () => {
  // The whole point: a real socket, the real bridge, real envelopes.
  const server = await startUiServer({ token: TOKEN, onLine: (line, client) => {
    const envelope = JSON.parse(line);
    if (envelope.type === 'snapshot') {
      client.send(JSON.stringify({ v: UI_BRIDGE_PROTOCOL, type: 'state', reason: 'snapshot', snapshot: { revision: 3, status: 'playing' } }));
    }
  } });
  try {
    let clientTransport = null;
    const bridge = createUiBridge({
      transport: {
        connect: () => clientTransport.connect(),
        send: (line) => clientTransport.send(line),
        close: () => clientTransport.close(),
      },
    });
    clientTransport = createIpcClient({ token: TOKEN, port: server.port, onMessage: (line) => bridge.handleMessage(line) });
    await bridge.connect();
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(bridge.status, 'connected', 'the greeting was accepted over the wire');
    assert.equal(bridge.snapshot.status, 'playing');
    assert.equal(bridge.revision, 3);
    bridge.close();
  } finally {
    await server.close();
  }
});