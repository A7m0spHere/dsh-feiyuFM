import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { createCoreHost, ProviderRegistry } from '../src/core-host.mjs';
import { FakeProvider } from '../src/fakes.mjs';
import { createSettingsHandler } from '../src/ui/dsh-settings.mjs';
const track = { provider: 'netease', providerTrackId: '1', durationMs: 30_000 };
test('lyrics RPC is read-only and a slow lookup does not queue pause or expose raw platform data', async () => {
  const store = new MusicStore(), messages = [];
  let release;
  const registry = new ProviderRegistry({ providers: { netease: {
    lyrics: () => new Promise(resolve => { release = resolve; }),
  } } });
  const host = createCoreHost({ store, provider: new FakeProvider(), providerRegistry: registry, playbackMode: 'fake',
    output: { write: line => { for (const row of line.trim().split('\n')) messages.push(JSON.parse(row)); } } });
  try {
    await host.start();
    await host.handle({ type: 'command', command: { type: 'requestTrack', track } });
    await host.core.waitForIdle();
    const reading = host.handle({ id: 'lyrics', type: 'lyrics', track }); await Promise.resolve();
    await host.handle({ id: 'pause', type: 'command', command: { type: 'pause' } });
    assert.ok(messages.some(row => row.id === 'pause' && row.snapshot.paused));
    const revision = host.snapshot().revision;
    release({ track, status: 'synced', lines: [{ id: 'line', startMs: 1000, text: 'example' }] }); await reading;
    const result = messages.find(row => row.id === 'lyrics');
    assert.equal(result.lyrics.status, 'synced');
    assert.equal(result.snapshot, undefined);
    assert.equal(host.snapshot().revision, revision);
    await host.handle({ id: 'stale', type: 'lyrics', track: { ...track, providerTrackId: '2' } });
    assert.equal(messages.find(row => row.id === 'stale').error.code, 'stale_track');
  } finally { await host.close(); store.close(); }
});
test('settings endpoints pass only lyric identity and validated seek fields to Core', async () => {
  const sent = [];
  const handler = createSettingsHandler({ start: async () => {},
    request: async message => { sent.push(message); return { lyrics: { status: 'unavailable' } }; },
    command: async message => { sent.push(message); return { snapshot: { paused: true } }; } });
  const lyric = await handler('fishfm/lyrics', { track: { ...track, cookie: 'must-not-pass' } });
  assert.equal(lyric.ok, true); assert.equal(sent[0].type, 'lyrics');
  assert.equal(sent[0].track.cookie, undefined);
  const seek = await handler('fishfm/command', { type: 'seek', playInstanceId: 'i', positionMs: 0 });
  assert.equal(seek.ok, true); assert.equal(sent[1].playInstanceId, 'i'); assert.equal(sent[1].positionMs, 0);
  assert.equal((await handler('fishfm/command', { type: 'seek', playInstanceId: 'i', positionMs: NaN })).ok, false);
});
