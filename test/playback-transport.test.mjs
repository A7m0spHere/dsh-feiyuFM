import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { PipeTransport, pipePath } from '../src/playback/transport.mjs';

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
