import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, access } from 'node:fs/promises';
import { MediaDownloads } from '../src/playback/media-download.mjs';
import { PlaybackService } from '../src/playback/service.mjs';

const fixture = Buffer.from('synthetic fixture; no decoder or audio device');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function serverFor(t) {
  const requests = [], held = [];
  const server = createServer((request, response) => {
    const path = request.url.split('?')[0]; requests.push({ path, headers: request.headers });
    if (path === '/redirect') { response.writeHead(302, { location: '/ok.mp3', 'set-cookie': 'private-cookie=secret' }); response.end(); }
    else if (path === '/auth') { response.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"' }); response.end(); }
    else if (path === '/large') { response.writeHead(200, { 'content-length': 65 * 1024 * 1024 }); response.end(); }
    else if (path === '/empty') { response.writeHead(200, { 'content-length': 0 }); response.end(); }
    else if (path === '/bad-redirect') { response.writeHead(302, { location: 'file:///private-file.wav' }); response.end(); }
    else if (path === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); }
    else if (path === '/truncated') { response.writeHead(200, { 'content-length': fixture.length * 2 }); response.write(fixture); setTimeout(() => response.destroy(), 20); }
    else if (path === '/stall') { response.writeHead(200); response.write(fixture); held.push(response); }
    else if (path === '/headers') { held.push(response); }
    else if (path === '/chunked-large') {
      response.writeHead(200);
      const chunk = Buffer.alloc(1024 * 1024); let count = 0;
      const send = () => { while (count++ < 65) if (!response.write(chunk)) { response.once('drain', send); return; } response.end(); };
      send();
    } else { response.writeHead(200, { 'content-length': fixture.length }); response.end(fixture); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const response of held) response.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
const absent = async path => { await assert.rejects(access(path)); };
async function until(predicate) { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() > end) throw new Error('condition timed out'); await delay(10); } }

test('anonymous staging enforces HTTP, redirects, credentials, size and complete-body bounds', async t => {
  const s = await serverFor(t), media = new MediaDownloads(); t.after(() => media.close());
  const item = await media.stage(`${s.origin}/redirect?token=private-token`, { timeoutMs: 4000 });
  assert.deepEqual(await readFile(item.handle), fixture);
  await item.release(); await absent(item.handle);
  for (const path of ['auth', 'large', 'chunked-large', 'empty', 'bad-redirect', 'loop', 'truncated']) {
    await assert.rejects(media.stage(`${s.origin}/${path}`, { timeoutMs: 4000 }), error => {
      assert.equal(error.code, 'media_download_failed');
      assert.equal(error.message, 'Anonymous media download failed');
      return true;
    });
  }
  const before = s.requests.length;
  await assert.rejects(media.stage(`${s.origin.replace('http://', 'http://private-user:private-password@')}/ok`, { timeoutMs: 1000 }), { code: 'media_download_failed' });
  assert.equal(s.requests.length, before);
  assert.equal(s.requests.filter(r => r.path === '/loop').length, 6);
  assert.equal(s.requests.filter(r => r.path === '/auth').length, 1);
  for (const { headers } of s.requests) for (const key of ['cookie', 'authorization', 'proxy-authorization']) assert.equal(headers[key], undefined);
  assert.equal(media.entries.size, 0);
  const directory = await media.directory; await media.close(); await absent(directory);
});

test('HTTPS downgrade is rejected before a second request and errors contain no source details', async () => {
  const media = new MediaDownloads(); let calls = 0;
  media._request = async () => { calls++; const response = Readable.from([]); response.statusCode = 302; response.headers = { location: 'http://private.example/audio' }; return response; };
  try {
    await assert.rejects(media.stage('https://private.example/file?token=secret', { timeoutMs: 1000 }), error => {
      assert.equal(error.code, 'media_download_failed'); assert.equal(error.message.includes('private'), false); return true;
    }); assert.equal(calls, 1);
  } finally { await media.close(); }
});

test('body and header stalls can be cancelled, bounded or closed without leaving partial files', async t => {
  const s = await serverFor(t), media = new MediaDownloads(); t.after(() => media.close());
  for (const path of ['stall', 'headers']) {
    const controller = new AbortController(); const before = s.requests.length;
    const work = media.stage(`${s.origin}/${path}`, { signal: controller.signal, timeoutMs: 4000 });
    const cancelled = assert.rejects(work, { code: 'cancelled' });
    await until(() => s.requests.length > before); controller.abort(); await cancelled;
    assert.equal(media.entries.size, 0);
  }
  await assert.rejects(media.stage(`${s.origin}/stall`, { timeoutMs: 60 }), { code: 'media_open_timeout' });
  const work = media.stage(`${s.origin}/headers`, { timeoutMs: 4000 });
  const cancelled = assert.rejects(work, { code: 'cancelled' }); await media.close(); await cancelled;
  assert.equal(media.entries.size, 0); await absent(await media.directory);
});

function serviceFor(t, mediaDownloads = new MediaDownloads()) {
  const calls = [], logs = [];
  const supervisor = { connected: true, generation: 1,
    async request(command) {
      calls.push(command);
      if (['load', 'preload'].includes(command.type)) assert.deepEqual(await readFile(command.resource), fixture);
      return { positionMs: 0, preloaded: command.type === 'preload' || command.usePreload === true, playing: false };
    }, async dispose() {},
  };
  const service = new PlaybackService({ supervisor, mediaDownloads, onLog: e => logs.push(e) });
  t.after(() => service.close()); return { service, supervisor, calls, logs, mediaDownloads };
}

test('Playback retains local leases through preload swaps and cleans them on replacement/stop', async t => {
  const s = await serverFor(t), h = serviceFor(t);
  const a = { handle: `${s.origin}/a.mp3` }, b = { handle: `${s.origin}/b.mp3` };
  await h.service.load({ resource: a, playInstanceId: 'a', version: 1 });
  const old = h.calls.find(c => c.type === 'load').resource;
  await h.service.preload({ resource: b, version: 1 });
  const standby = h.calls.find(c => c.type === 'preload').resource;
  assert.equal(h.service.isPreloaded(b), true);
  await h.service.load({ resource: b, playInstanceId: 'b', version: 2, usePreload: true });
  assert.equal(h.calls.filter(c => c.type === 'load').at(-1).resource, standby);
  assert.equal(h.calls.filter(c => c.type === 'load').at(-1).usePreload, true);
  assert.equal(s.requests.length, 2, 'consuming a ready standby must not download again');
  await absent(old); await access(standby);
  await h.service.stop({ version: 3 }); await absent(standby);
  assert.equal(JSON.stringify(h.logs).includes('http://'), false);
  await h.service.load({ resource: a, playInstanceId: 'stop-error', version: 4 });
  const failedStopFile = h.service._mediaActive.handle;
  h.supervisor.request = async () => { throw new Error('synthetic host loss'); };
  await assert.rejects(h.service.stop({ version: 5 }), /synthetic host loss/);
  await absent(failedStopFile);
});

test('pause cancels a pending download before any load reaches the host', async t => {
  const s = await serverFor(t), h = serviceFor(t);
  const loading = h.service.load({ resource: { handle: `${s.origin}/headers` }, playInstanceId: 'a', version: 1 });
  const cancelled = assert.rejects(loading, { code: 'cancelled' });
  await until(() => s.requests.length > 0); await h.service.pause({ version: 2 }); await cancelled;
  assert.equal(h.calls.filter(c => c.type === 'load').length, 0);
  assert.equal(h.mediaDownloads.entries.size, 0);
});

test('a late staging result cannot replace or delete a newer load and open keeps the shared deadline', async t => {
  let releaseOld; const released = [], commands = [];
  const lease = handle => ({ handle, release: async () => released.push(handle) });
  const staging = { stage: async handle => handle.endsWith('/old') ? new Promise(resolve => { releaseOld = () => resolve(lease('old-local')); })
    : (await delay(25), lease('new-local')), cleanup: async () => {}, close: async () => {} };
  const supervisor = { async request(command) { commands.push(command); return { positionMs: 0 }; }, async dispose() {} };
  const service = new PlaybackService({ supervisor, mediaDownloads: staging, openTimeoutMs: 1000 }); t.after(() => service.close());
  const old = service.load({ resource: { handle: 'https://example.invalid/old' }, playInstanceId: 'old', version: 1 });
  const cancelled = assert.rejects(old, { code: 'cancelled' }); await until(() => releaseOld);
  await service.load({ resource: { handle: 'https://example.invalid/new' }, playInstanceId: 'new', version: 2 });
  releaseOld(); await cancelled;
  assert.equal(service.active.playInstanceId, 'new');
  assert.deepEqual(released, ['old-local']);
  const load = commands.find(c => c.type === 'load');
  assert.equal(load.resource, 'new-local');
  assert.ok(load.openTimeoutMs > 0 && load.openTimeoutMs < 1000, 'download and local open must not receive separate full budgets');
});

test('a mute command during staging is not undone by the captured load options', async t => {
  let finish, commandMuted;
  const staging = { stage: () => new Promise(resolve => { finish = () => resolve({ handle: 'local-media', release: async () => {} }); }), cleanup: async () => {}, close: async () => {} };
  const supervisor = { async request(command) {
    if (command.type === 'load') commandMuted = command.muted;
    return { positionMs: 0, muted: command.muted };
  }, async dispose() {} };
  const service = new PlaybackService({ supervisor, mediaDownloads: staging }); t.after(() => service.close());
  const loading = service.load({ resource: { handle: 'https://example.invalid/media' }, playInstanceId: 'muted', version: 1, muted: false });
  await until(() => finish);
  await service.setMuted({ muted: true, version: 1 });
  finish(); await loading;
  assert.equal(commandMuted, true);
  assert.equal(service.muted, true);
});
