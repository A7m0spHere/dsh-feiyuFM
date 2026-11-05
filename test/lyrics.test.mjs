import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNetEaseLyrics, createLyricsService } from '../src/lyrics.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';

const track = { provider: 'netease', providerTrackId: '1', durationMs: 20_000 };
test('lyrics sort multiple time tags and align translation by time, preserving instrumental gaps', () => {
  const value = normalizeNetEaseLyrics({ lrc: { lyric: '[offset:100]\n[00:03.000]third\n[00:01.000][00:05.000]first\n[00:02.000]\n[00:03.000]other' },
    tlyric: { lyric: '[00:03.000]三\n[00:01.000]一' }, romalrc: { lyric: '[00:01.050]one' } }, track);
  assert.equal(value.status, 'synced');
  assert.deepEqual(value.lines.map(row => row.startMs), [900, 1900, 2900, 4900]);
  assert.equal(value.lines[0].translation, '一');
  assert.equal(value.lines[0].romanization, 'one');
  assert.equal(value.lines[1].text, '');
  assert.equal(value.lines[1].translation, '');
  assert.equal(value.lines[2].text, 'third\nother');
  assert.equal(value.lines[3].endMs, 20_000);
});
test('lyrics distinguish missing, instrumental and unsynced data without inventing timestamps', () => {
  assert.equal(normalizeNetEaseLyrics({}, track).status, 'unavailable');
  assert.equal(normalizeNetEaseLyrics({ nolyric: true }, track).status, 'instrumental');
  const plain = normalizeNetEaseLyrics({ lrc: { lyric: '[ar:sample]\nuntimed original' } }, track);
  assert.equal(plain.status, 'unsynced');
  assert.equal(plain.text, 'untimed original');
  assert.deepEqual(plain.lines, []);
  assert.throws(() => normalizeNetEaseLyrics({ lrc: { lyric: 'x'.repeat(256_001) } }, track), { code: 'lyrics_too_large' });
});
test('lyrics cache coalesces requests, isolates returned objects and never caches failures', async () => {
  let calls = 0;
  const adapter = { lyrics: async () => { calls++; if (calls === 1) throw new Error('network'); return normalizeNetEaseLyrics({ lrc: { lyric: '[00:01]one' } }, track); } };
  const service = createLyricsService({ providerFor: () => adapter });
  await assert.rejects(service.get(track));
  const [a, b] = await Promise.all([service.get(track), service.get(track)]);
  assert.equal(calls, 2); a.lines[0].text = 'changed';
  assert.equal(b.lines[0].text, 'one');
  assert.equal((await service.get(track)).lines[0].text, 'one');
  service.close();
});
test('account changes reject late lyrics and invalidate old cache; close cancels ignored requests', async () => {
  let context = 'a', release;
  const adapter = { lyricsContext: () => context, lyrics: () => new Promise(resolve => { release = resolve; }) };
  const service = createLyricsService({ providerFor: () => adapter });
  const late = service.get(track); await Promise.resolve(); context = 'b'; release({ status: 'unavailable' });
  await assert.rejects(late, { code: 'cancelled' });
  const next = service.get(track); await Promise.resolve(); service.close();
  await assert.rejects(next, { code: 'cancelled' });
});
test('lyrics deadline bounds providers that ignore cancellation', async () => {
  const service = createLyricsService({ providerFor: () => ({ lyrics: () => new Promise(() => {}) }), timeoutMs: 15 });
  await assert.rejects(service.get(track), { code: 'lyrics_timeout' });
  service.close();
});
test('NetEase lyrics use the existing pinned community module anonymously without reading credentials', async () => {
  let queries = [];
  const provider = createNetEaseProvider({ transport: { request: () => { throw new Error('wrong transport'); } },
    communityApi: { lyric: async query => { queries.push(query); return { status: 200, cookie: ['NMTID=guest; Path=/'], body: { code: 200, lrc: { lyric: '[00:01]one' } } }; } },
    credentials: { read: () => { throw new Error('lyrics must not read credentials'); }, write: () => { throw new Error('lyrics must not overwrite credentials'); } } });
  const value = await provider.lyrics(track);
  assert.equal(value.status, 'synced');
  assert.deepEqual(queries[0].cookie, {});
  assert.equal(queries[0].id, '1');
});

test('an anonymous lyric permission failure cannot expire the saved playback account', async () => {
  const provider = createNetEaseProvider({ transport: { request() {} },
    communityApi: { lyric: async () => ({ status: 200, body: { code: 301 } }) },
    credentials: { read: () => 'MUSIC_U=fixture', write: () => assert.fail('no guest session writes') },
    store: { getCredentialReference: () => ({ state: 'authorized', account_id: 'fixture' }),
      setCredentialReference: () => assert.fail('lyrics cannot expire an authenticated playback session') } });
  await assert.rejects(provider.lyrics(track), { code: 'lyrics_unavailable' });
  assert.equal(provider.getAccount().status, 'authorized');
});
