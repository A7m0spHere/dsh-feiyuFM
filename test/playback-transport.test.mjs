import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { PipeTransport, pipePath } from '../src/playback/transport.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';

async function unresponsiveHost(t) {
  const name = `fishfm-transport-test-${randomUUID()}`;
  const peers = new Set();
  const server = net.createServer(socket => {
    peers.add(socket);
    socket.on('data', () => {});
    socket.on('close', () => peers.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath(name), resolve);
  });
  const transport = new PipeTransport({ name });
  t.after(async () => {
    transport.close();
    for (const socket of peers) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await transport.connect();
  return transport;
}

test('a timed-out audio request rejects itself and every other waiter', {
  skip: process.platform !== 'win32', timeout: 5000,
}, async t => {
  const transport = await unresponsiveHost(t);
  const other = assert.rejects(transport.request({ type: 'snapshot' }, { timeoutMs: 4000 }), { code: 'command_timeout' });
  await assert.rejects(transport.request({ type: 'ping' }, { timeoutMs: 30 }), { code: 'command_timeout' });
  await other;
  assert.equal(transport.pending.size, 0);
  assert.equal(transport.closed, true);
});

test('a synchronous audio pipe write failure rejects the request and clears its timeout', {
  skip: process.platform !== 'win32', timeout: 5000,
}, async t => {
  const transport = await unresponsiveHost(t);
  transport.socket.write = () => { throw new Error('simulated write failure'); };
  await assert.rejects(transport.request({ type: 'ping' }, { timeoutMs: 4000 }), { code: 'pipe_closed' });
  assert.equal(transport.pending.size, 0);
  assert.equal(transport.closed, true);
});

test('an advisory timeout rejects only its request and leaves other pipe waiters connected', {
  skip: process.platform !== 'win32', timeout: 5000,
}, async t => {
  const transport = await unresponsiveHost(t);
  const foreground = transport.request({ type: 'load' }, { timeoutMs: 4000 });
  const foregroundId = [...transport.pending.keys()][0];
  await assert.rejects(transport.request({ type: 'preloadCancel' }, { timeoutMs: 30, invalidateOnTimeout: false }),
    { code: 'command_timeout' });
  assert.equal(transport.pending.size, 1);
  assert.equal(transport.connected, true);
  assert.equal(transport.closed, false);
  transport._receive(`${JSON.stringify({ type: 'result', id: foregroundId, ok: true, positionMs: 0 })}\n`);
  assert.equal((await foreground).positionMs, 0);
});

test('late standby cancellation cannot abort a concurrent foreground load through the real pipe', {
  skip: process.platform !== 'win32', timeout: 5000,
}, async t => {
  const name = `fishfm-advisory-test-${randomUUID()}`;
  const peers = new Set(), timers = new Set(), unexpected = [];
  const server = net.createServer(socket => {
    peers.add(socket); socket.setEncoding('utf8'); let buffer = '';
    socket.on('close', () => peers.delete(socket));
    socket.on('data', chunk => {
      buffer += chunk;
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const command = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!socket.destroyed) socket.write(`${JSON.stringify({ type: 'result', id: command.id, ok: true,
            ...(command.type === 'load' ? { positionMs: 0, playing: true } : { preloaded: false }) })}\n`);
        }, command.type === 'preloadCancel' ? 100 : 180);
        timers.add(timer);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipePath(name), resolve); });
  const transport = new PipeTransport({ name, onMessage: message => unexpected.push(message) });
  t.after(async () => {
    transport.close(); for (const timer of timers) clearTimeout(timer);
    for (const peer of peers) peer.destroy(); await new Promise(resolve => server.close(resolve));
  });
  await transport.connect();
  const supervisor = new PlaybackSupervisor();
  supervisor.hello = { pid: 1 }; supervisor.transport = transport;
  supervisor.ensureHost = async () => supervisor.hello;
  const service = new PlaybackService({ supervisor, commandTimeoutMs: 30, openTimeoutMs: 1000 });
  const cancellation = service.cancelPreload();
  const foreground = service.load({ resource: { handle: 'fake:foreground' }, playInstanceId: 'foreground', version: 2 });
  await cancellation;
  assert.equal(transport.connected, true);
  assert.equal(transport.pending.size, 1, 'only the foreground load should remain pending');
  assert.equal((await foreground).playing, true);
  assert.equal(service.active.playInstanceId, 'foreground');
  assert.equal(transport.pending.size, 0);
  assert.equal(transport.closed, false);
  assert.deepEqual(unexpected, [], 'late advisory result must be ignored');
});
