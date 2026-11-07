import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicStore } from '../src/storage.mjs';
import { DEFAULT_NETWORK_PROXY, validateNetworkProxy, networkProxyView, saveNetworkProxy, createNetworkClient } from '../src/network.mjs';

// Test-only localhost certificate and key. The certificate is explicitly trusted
// for this test process, so HTTPS target and proxy verification stay enabled.
const certificate = "-----BEGIN CERTIFICATE-----\r\nMIIDKTCCAhGgAwIBAgIUY/6WGy5dKTpcqegyaVojGZswjkYwDQYJKoZIhvcNAQEL\r\nBQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTEwNzE1MDYwM1oXDTM2MTEw\r\nNDE1MDYwM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF\r\nAAOCAQ8AMIIBCgKCAQEAuY1wsu6szpfQFN+jBRH4h0pZXZFQ7q/oLHO8HahfDWMM\r\nOvWCyImC4SNPQNPYNOiPHDPMXCAviAXlF7mAg9vAPeHzg9hKLF+KT13l4otjJxQq\r\n3AtUCeb/9UYsqPrjQXiTkcFW418nQE7NRPhPqlN7zKmX3osORBnyjX2wizTMk4A5\r\n4tJEb1d2gu1Axoa3X9PsL1WBui9jfKHC5uJqVyTtvWJU/NVBlX86XZm4EIl0HK0n\r\nBzRcvu9QmV/1Ya0o4gDiCKTExl3PmHfoH5prCLdW6wDaOHhWYfUlO2H7CAai5/aq\r\nNYIAprx/A5JpeKhjp7lVMORo+I7nLFtLzilSM/fGswIDAQABo3MwcTAPBgNVHRMB\r\nAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAOBgNVHQ8BAf8E\r\nBAMCAqQwEwYDVR0lBAwwCgYIKwYBBQUHAwEwHQYDVR0OBBYEFGG0qlpuZkNKM+35\r\nOnSasFLcGstQMA0GCSqGSIb3DQEBCwUAA4IBAQA1yEMV1iTHeji3Z/2DC+ZqkPBp\r\ndqEE22RRUwbM8cqwJvUr1SX1mih5Bsatfdsjr1CTvu4AY/SBu9HUPO/jljplYTMj\r\nVDq3D/XuDbgxDM0w7sgEk8Sj54kiCF1xv2zGAyJiS7ANj0g9sRdq6o3QgbE28TGt\r\nQKRFLiDYnnZrUuRmmVbVthTqc6hdlB/BV5UF8QG6FBbueMNHlevkik24Nof0veUs\r\nJRupJLrXr2B0Ind8qsl9/YC2nLAjD698lxQ/TO7UeqtkTLbXYH7eKHMG04qDhYmv\r\n754OvNRZan/Psg29xQpIxqHmkWUZjWFG/Wn6CJ0P51FPp/teTr4N5aD5O1OW\r\n-----END CERTIFICATE-----\r\n";
const privateKey = "-----BEGIN PRIVATE KEY-----\r\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5jXCy7qzOl9AU\r\n36MFEfiHSlldkVDur+gsc7wdqF8NYww69YLIiYLhI09A09g06I8cM8xcIC+IBeUX\r\nuYCD28A94fOD2EosX4pPXeXii2MnFCrcC1QJ5v/1Riyo+uNBeJORwVbjXydATs1E\r\n+E+qU3vMqZfeiw5EGfKNfbCLNMyTgDni0kRvV3aC7UDGhrdf0+wvVYG6L2N8ocLm\r\n4mpXJO29YlT81UGVfzpdmbgQiXQcrScHNFy+71CZX/VhrSjiAOIIpMTGXc+Yd+gf\r\nmmsIt1brANo4eFZh9SU7YfsIBqLn9qo1ggCmvH8Dkml4qGOnuVUw5Gj4jucsW0vO\r\nKVIz98azAgMBAAECggEAVNTr+fpxyhARQ4HNK7PAHsZongUibcXBjZUqI5sHPf0T\r\nKd91+A4aZqj4gmh4GBRc3WV3IIVchcFAMH0QWvh8Zy5m4Vfg7XGOr+N7hvv4DHVF\r\ndQ2+0bopOm9nWqg9fwDL4t70RQaLUPTWFxq5fWMmnfbJZqbHkm4UfQjCTpqIj0RQ\r\np3ahZqf/M3gcDqDX1BpGIvnOyC9sZMVDNxFM+asRuNhkZlxH8Xk/9hGMJdNqKWaN\r\ngJ63mzuP1KdcdjjfWGc0RbmOBqGdq0xJ2TODKfYhoJnp2xWzT2KQS4DExpgR/coU\r\nLcwFHIGCQrq4r6OYCp+KU3pt7stuFGm+AdbRVkcq5QKBgQDbnu6cK9Uy+O+q4tql\r\n0dUqCW9WsvjWAiNauepMtsC3tdCvLJOPCqy+6xd5er19Yf83qoPofXeDkbpSoIyZ\r\nUveKSlPccec7aLodp5/cAvQoHT99zAID6zKeTPbI9aCpv+x7Gix5drV8/VRc2IjS\r\n7RZxwtydlUAFNtlSP8NqSckYnwKBgQDYSdVfcv0h2atcqe2j1TnIXJb9DqLWu7NK\r\nTHdxSRadgcBqYRJkEma2fgR5iSAcD0E54JByQcHM0H5nqc2u6sx8jCAu45qnRBkM\r\nWgU1vw/+JMI3PpJixhEE9qeVEXj907A7n/PbpAP+bfmzw8DzoOAZH9809/mixeow\r\n7M6ADqTVbQKBgQCzGXATEbfiwpmIrUmLsov4pQsUFA3TUJkOUtEc0GhnKLFPObX4\r\nD8eCRmu1WIARMQqVlcvOnAsL05qz6VPfcYaHU0gCXS0qCKTGrD00iYAc+oUdjHIU\r\nSgjUiYUzqwPjiq1KUrT0NPeaP2k98iPahxgnm7aYF+/GkM03QuKU2ilRlwKBgCs/\r\n8GPqyYVoUmTwMe3t6GURZrvpnlRUKlD0I3pKxDPwyzo6eQP7zgA2CM0Ix5v0zPU2\r\n24uNbKR5GJ3ADboph4RsPM9DghxqeJvIsHwD3b3TOeb0Iy+PLb4RWIdtfAU9vGLf\r\n5FKKZKYO9bylq0LMa6N6hRbBc3DCJMdtwwlGZF2tAoGBANTt3tYgrjm8DZBMlFk7\r\nXqv379UlgWQjrNbyWxRTusiYe7/bvN0IIk2+9vn/ks6pA19GVenzafFUMyxMX5Kc\r\nd30sI1XpaDjgSCxGkDk/vOz0zWlCeHuxO9sYVcjLbT3mInjLL5TVIa5BKQozipDH\r\npp8gaKLkzsjMoOY4KQ9OtTx8\r\n-----END PRIVATE KEY-----\r\n";

async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

async function proxyFor(t, secure = false) {
  const calls = [];
  const handler = (request, response) => {
    calls.push({ type: 'http', target: request.url });
    const outbound = httpRequest(new URL(request.url), { method: request.method, headers: request.headers, agent: false }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    outbound.on('error', () => response.destroy());
    request.pipe(outbound);
  };
  const server = secure ? createHttpsServer({ key: privateKey, cert: certificate }, handler) : createServer(handler);
  server.on('connect', (request, socket, head) => {
    calls.push({ type: 'connect', target: request.url });
    const target = new URL('http://' + request.url);
    const upstream = connect(Number(target.port), target.hostname, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });
  const port = await listen(t, server);
  return { url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`, calls };
}

function trustCertificate(t) {
  const previous = getCACertificates('default');
  setDefaultCACertificates([...previous, certificate]);
  t.after(() => setDefaultCACertificates(previous));
}

test('network proxy settings default safely, validate addresses, and persist revision-protected changes', () => {
  assert.deepEqual(DEFAULT_NETWORK_PROXY, { mode: 'direct', url: '' });
  assert.deepEqual(networkProxyView(), { version: 1, revision: 0, mode: 'direct', url: '' });
  assert.deepEqual(networkProxyView({ getCredentialReference() {} }), { version: 1, revision: 0, mode: 'direct', url: '' });
  assert.deepEqual(validateNetworkProxy({ mode: 'proxy', url: ' http://localhost:7897/ ' }), { mode: 'proxy', url: 'http://localhost:7897' });
  for (const value of [null, [], {}, { mode: 'system', url: '' }, { mode: 'proxy', url: '' },
    { mode: 'proxy', url: 'socks5://localhost:7897' }, { mode: 'proxy', url: 'http://user:secret@localhost:7897' },
    { mode: 'proxy', url: 'http://localhost:7897/path' }, { mode: 'proxy', url: 'http://localhost:7897?token=secret' },
    { mode: 'proxy', url: 'http://@localhost' }, { mode: 'proxy', url: 'http://localhost?' },
    { mode: 'proxy', url: 'https://localhost/#' }, { mode: 'proxy', url: 'http://local\nhost:7897' },
    { mode: 'proxy', url: 'https://localhost/#secret' }, { mode: 'direct', url: 'invalid' }]) {
    assert.throws(() => validateNetworkProxy(value), { code: 'invalid_network_proxy' });
  }
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-network-test-'));
  const database = join(directory, 'music.sqlite');
  let store = new MusicStore(database);
  try {
    const saved = saveNetworkProxy(store, { mode: 'proxy', url: 'https://localhost:7897/' }, 0);
    assert.deepEqual(saved, { version: 1, revision: 1, mode: 'proxy', url: 'https://localhost:7897' });
    assert.throws(() => saveNetworkProxy(store, { mode: 'direct', url: '' }, 0), { code: 'network_proxy_conflict' });
    assert.throws(() => saveNetworkProxy(store, { mode: 'direct', url: '' }, '1'), { code: 'invalid_network_proxy' });
    assert.deepEqual(saveNetworkProxy(store, saved, 1), saved);
    store.close(); store = new MusicStore(database);
    assert.deepEqual(networkProxyView(store), saved);
    for (const invalid of [null, { version: 2, revision: 4, mode: 'proxy', url: 'http://localhost:7897' },
      { version: 1, revision: -1, mode: 'direct', url: '' }, { version: 1, revision: 3, mode: 'proxy', url: 'http://user:secret@localhost' }]) {
      store.setSetting('network_proxy_v1', invalid);
      assert.deepEqual(networkProxyView(store), { version: 1, revision: 0, mode: 'direct', url: '' });
    }
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('direct requests ignore inherited proxy variables while configured proxies receive HTTP and verified HTTPS', async t => {
  trustCertificate(t);
  const targetPort = await listen(t, createServer((request, response) => response.end('plain')));
  const securePort = await listen(t, createHttpsServer({ key: privateKey, cert: certificate }, (request, response) => response.end('secure')));
  const proxy = await proxyFor(t), secureProxy = await proxyFor(t, true);
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key.toLowerCase().includes('no_proxy') ? '' : proxy.url;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let settings = { mode: 'direct', url: '' };
  const client = createNetworkClient({ getSettings: () => settings });
  assert.equal(await (await client.fetch(`http://127.0.0.1:${targetPort}/`)).text(), 'plain');
  assert.equal(await (await client.fetch(`https://127.0.0.1:${securePort}/`)).text(), 'secure');
  assert.equal(proxy.calls.length, 0);
  process.env.NO_PROXY = '*'; process.env.no_proxy = '*';
  settings = { mode: 'proxy', url: proxy.url };
  assert.equal(await (await client.fetch(`http://127.0.0.1:${targetPort}/`)).text(), 'plain');
  assert.equal(await (await client.fetch(`https://127.0.0.1:${securePort}/`)).text(), 'secure');
  assert.deepEqual(proxy.calls.map(call => call.type), ['http', 'connect']);
  settings = { mode: 'proxy', url: secureProxy.url };
  assert.equal(await (await client.fetch(`http://127.0.0.1:${targetPort}/`)).text(), 'plain');
  assert.equal(await (await client.fetch(`https://127.0.0.1:${securePort}/`)).text(), 'secure');
  assert.deepEqual(secureProxy.calls.map(call => call.type), ['http', 'connect']);
  settings = { mode: 'direct', url: proxy.url };
  assert.equal(await (await client.fetch(`http://127.0.0.1:${targetPort}/`)).text(), 'plain');
  assert.equal(proxy.calls.length, 2);
});

test('network fetch keeps redirects manual, cookies separate, compressed bodies readable, and empty responses valid', async t => {
  const seen = [];
  const port = await listen(t, createServer(async (request, response) => {
    seen.push(request.url);
    if (request.url === '/redirect') { response.writeHead(302, { location: '/end' }); response.end(); }
    else if (request.url === '/cookies') { response.writeHead(200, { 'set-cookie': ['one=1; Path=/', 'two=2; Path=/'] }); response.end('cookies'); }
    else if (request.url === '/gzip') { response.writeHead(200, { 'content-encoding': 'gzip' }); response.end(gzipSync('decoded')); }
    else if (request.url === '/brotli') { response.writeHead(200, { 'content-encoding': 'br' }); response.end(brotliCompressSync('decoded')); }
    else if (request.url === '/empty') { response.writeHead(204); response.end(); }
    else if (request.url === '/unchanged') { response.writeHead(304); response.end(); }
    else { let body = ''; for await (const chunk of request) body += chunk; response.end(request.method === 'HEAD' ? '' : body); }
  }));
  const client = createNetworkClient(), origin = `http://127.0.0.1:${port}`;
  assert.equal((await client.fetch(origin + '/redirect', { redirect: 'manual' })).status, 302);
  assert.equal(seen.includes('/end'), false);
  const cookies = await client.fetch(origin + '/cookies');
  assert.deepEqual(cookies.headers.getSetCookie(), ['one=1; Path=/', 'two=2; Path=/']);
  await cookies.text();
  for (const path of ['/gzip', '/brotli']) assert.equal(await (await client.fetch(origin + path)).text(), 'decoded');
  for (const path of ['/empty', '/unchanged']) assert.equal(await (await client.fetch(origin + path)).text(), '');
  assert.equal(await (await client.fetch(origin + '/head', { method: 'HEAD' })).text(), '');
  assert.equal(await (await client.fetch(origin + '/echo', { method: 'POST', headers: new Headers({ 'content-type': 'text/plain' }), body: 'payload' })).text(), 'payload');
});

test('switching the saved route affects new requests while an existing response finishes on its original route', async t => {
  let finish;
  const port = await listen(t, createServer((request, response) => {
    if (request.url === '/held') {
      response.write('first'); finish = () => response.end('last');
    } else response.end('new');
  }));
  const proxy = await proxyFor(t);
  let settings = { mode: 'proxy', url: proxy.url };
  const client = createNetworkClient({ getSettings: () => settings });
  const original = await client.fetch(`http://127.0.0.1:${port}/held`);
  settings = { mode: 'direct', url: '' };
  assert.equal(await (await client.fetch(`http://127.0.0.1:${port}/new`)).text(), 'new');
  assert.equal(proxy.calls.length, 1);
  finish();
  assert.equal(await original.text(), 'firstlast');
});

test('network requests release their agents on completion, cancellation and response-body cancellation', async t => {
  let held;
  const port = await listen(t, createServer((request, response) => {
    if (request.url === '/headers') { held = response; return; }
    if (request.url === '/end') { response.end('complete'); return; }
    response.writeHead(200); response.write('first'); held = response;
  }));
  const client = createNetworkClient(), agents = [];
  const original = client.createAgent;
  client.createAgent = protocol => {
    const agent = original(protocol), destroy = agent.destroy.bind(agent);
    agent.destroy = () => { agent.released = true; destroy(); };
    agents.push(agent); return agent;
  };
  const origin = `http://127.0.0.1:${port}`;
  assert.equal(await (await client.fetch(origin + '/end')).text(), 'complete');
  const before = new AbortController(); before.abort();
  await assert.rejects(client.fetch(origin + '/headers', { signal: before.signal }), { name: 'AbortError' });
  const controller = new AbortController();
  const pending = client.fetch(origin + '/headers', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 25)); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const response = await client.fetch(origin + '/body');
  await response.body.cancel();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(agents.every(agent => agent.released));
  held?.destroy();
});
