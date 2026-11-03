import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicCore } from '../src/core.mjs';
import { MusicStore } from '../src/storage.mjs';
import { FakePlayback, FakeProvider } from '../src/fakes.mjs';
import { MusicError, trackId } from '../src/contracts.mjs';
import { createSelector } from '../src/selection.mjs';

const tracks = ['A', 'B', 'C', 'D', 'E'].map(title => ({ provider: 'netease', providerTrackId: title, title, durationMs: 180000 }));
const [a, b, c, d] = tracks;
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const store = new MusicStore(), provider = new FakeProvider(), playback = new FakePlayback(), logs = [];
  playback.preloadSupported = true;
  playback.reuseSwitchSupported = true;
  playback.autoplaySupported = true;
  const core = new MusicCore({ store, provider, playback, onLog: entry => logs.push(entry), prefetchDelayMs: 60000, ...options });
  playback.onEvent(event => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ type, commandId: `navigation-${++id}`, ...extra });
  const play = async track => { send('requestTrack', { track }); await core.waitForIdle(); };
  const close = async () => { core._invalidate(); await core.waitForIdle(); store.close(); };
  return { store, provider, playback, logs, core, send, play, close };
}

test('fixed history supports repeated backwards/forwards, paused traversal and live boundaries without feedback', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) await h.play(track);
    h.core.setQueue([d]);
    const sequence = [];
    for (const command of ['previous', 'previous', 'next', 'next', 'previous', 'next', 'next']) {
      h.send(command); await h.core.waitForIdle();
      sequence.push(h.core.snapshot().current.track.title);
    }
    assert.deepEqual(sequence, ['B', 'A', 'B', 'C', 'B', 'C', 'D']);
    assert.equal(h.store.getPreference('track', trackId(b)), null);
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM listen_history WHERE effective_ms > 0').get().n, 0,
      'navigation alone earns no effective listening');
    h.send('pause'); await h.core.waitForIdle();
    const starts = h.playback.calls.filter(call => call.type === 'load').length;
    h.send('previous'); h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'D');
    assert.equal(h.core.snapshot().status, 'paused');
    assert.equal(h.playback.playing, false);
    assert.equal(h.playback.calls.filter(call => call.type === 'load').length, starts);
  } finally { await h.close(); }
});

test('forward history skips banned/unavailable entries, keeps its cursor on a blocked boundary and bypasses repeat window', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c, d]) await h.play(track);
    h.send('previous'); h.send('previous'); h.send('previous'); await h.core.waitForIdle();
    h.store.markUnavailable(b, 'media_failed', Date.now() + 60000);
    h.send('banTrack', { track: c });
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'D');
    h.send('previous'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'A');
    h.send('banTrack', { track: d });
    const cursor = structuredClone(h.core.navigation);
    assert.throws(() => h.send('next'), { code: 'no_next_history' });
    assert.deepEqual(h.core.navigation, cursor);
    assert.equal(h.core.snapshot().current.track.title, 'A');
    assert.throws(() => h.send('previous'), { code: 'no_previous' });
  } finally { await h.close(); }
});

test('failed history media reports an error and subsequent traversal retains its original direction', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) await h.play(track);
    h.send('previous'); await h.core.waitForIdle();
    h.playback.failNextLoad(new MusicError('media_failed', 'bad history media'));
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().lastError.code, 'media_failed');
    h.send('previous'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B');
    h.core.setQueue([d]);
    assert.throws(() => h.send('next'), { code: 'no_next_history' });
    await h.play(d);
    h.send('previous'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B', 'point request anchors on actual starts');
  } finally { await h.close(); }
});

test('cached URL still preloads media once, and history forward is the prefetch target', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) await h.play(track);
    h.core.setQueue([d]);
    h.send('previous'); await h.core.waitForIdle();
    const before = h.provider.calls.length;
    await h.core._prefetchNext();
    await h.core._prefetchNext();
    assert.equal(h.provider.calls.length, before, 'C already has a URL');
    assert.equal(h.playback.preloaded.resource.handle, `fake:${trackId(c)}`);
    assert.equal(h.playback.calls.filter(call => call.type === 'preload').length, 1);
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.playback.calls.filter(call => call.type === 'load').at(-1).usePreload, true);
  } finally { await h.close(); }
});

test('foreground next takes ownership of in-flight prefetch and survives background cancellation', async () => {
  const h = harness();
  try {
    await h.play(a); h.core.setQueue([b]); h.provider.defer(b);
    const preparation = h.core._prefetchNext(); await turn();
    const request = h.provider.calls.at(-1);
    h.send('next'); await turn();
    h.core._cancelPrefetch();
    assert.equal(request.signal.aborted, false);
    h.provider.release(b);
    await preparation; await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B');
    assert.equal(h.core.snapshot().status, 'playing');
    assert.equal(h.provider.calls.filter(call => call.key === trackId(b)).length, 1);
    assert.equal(h.playback.calls.filter(call => call.type === 'preload').length, 0, 'cancelled background cannot claim standby');
  } finally { await h.close(); }
});

test('obsolete prefetch is aborted, late completion cannot poison cache or the new standby', async () => {
  const h = harness();
  try {
    await h.play(a); h.core.setQueue([b]); h.provider.defer(b);
    const old = h.core._prefetchNext(); await turn();
    const request = h.provider.calls.at(-1);
    await h.play(c);
    assert.equal(request.signal.aborted, true);
    h.core.setQueue([d]); await h.core._prefetchNext();
    h.provider.release(b); await old; await turn();
    assert.equal(h.core.resourceCache.has(trackId(b)), false);
    assert.equal(h.playback.preloaded.resource.handle, `fake:${trackId(d)}`);
  } finally { await h.close(); }
});

test('joining an existing resolve still loads standby, and a preload failure falls back to demand load', async () => {
  const h = harness();
  try {
    await h.play(a); h.core.setQueue([b]); h.provider.defer(b);
    const foreground = h.core._resolveResource(b, new AbortController().signal, h.core.state.commandVersion);
    const preparation = h.core._prefetchNext(); await turn();
    h.provider.release(b); await foreground; await preparation;
    assert.equal(h.playback.preloaded.resource.handle, `fake:${trackId(b)}`);
    h.core.preloadedTrackKey = null;
    h.playback.preload = async () => { throw new MusicError('media_failed', 'standby failed'); };
    await h.core._prefetchNext();
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().status, 'playing');
    assert.equal(h.playback.calls.filter(call => call.type === 'load').at(-1).usePreload, false);
  } finally { await h.close(); }
});

test('direct resume schedules fresh preparation even without a second started event', async () => {
  const h = harness({ prefetchDelayMs: 10 });
  try {
    await h.play(a); h.core.setQueue([b]); await delay(40);
    assert.equal(h.core.preloadedTrackKey, trackId(b));
    const requests = h.provider.calls.length;
    h.send('pause'); await h.core.waitForIdle(); await delay(30);
    assert.equal(h.core.preloadedTrackKey, null);
    const opens = h.playback.calls.filter(call => call.type === 'preload').length;
    h.playback.play = async ({ version }) => { h.playback.version = version; h.playback.playing = true; };
    h.send('resume'); await h.core.waitForIdle(); await delay(40);
    assert.equal(h.core.snapshot().status, 'playing');
    assert.equal(h.provider.calls.length, requests, 'resume reuses fresh URLs');
    assert.equal(h.playback.calls.filter(call => call.type === 'preload').length, opens + 1);
    h.send('pause'); await h.core.waitForIdle(); await delay(40);
    assert.equal(h.playback.playing, false);
    assert.equal(h.core.prefetchAbort, null);
  } finally { await h.close(); }
});

test('resolve timeout retries a new provider request and discards a late expired attempt', async () => {
  const h = harness();
  let releaseOld;
  try {
    let attempts = 0;
    h.provider.resolve = async (_track, { signal }) => {
      attempts++;
      if (attempts === 1) return new Promise(resolve => { releaseOld = () => resolve({ handle: 'fake:old' }); });
      assert.equal(signal.aborted, false);
      return { handle: 'fake:fresh' };
    };
    await h.play(a);
    assert.equal(attempts, 2, 'a timeout must not merely wait on the same Promise again');
    assert.equal(h.core.snapshot().status, 'playing');
    releaseOld(); await turn();
    assert.equal(h.core.resourceCache.get(trackId(a)).handle, 'fake:fresh');
    assert.equal(h.core.resolveInflight.size, 0);
  } finally { releaseOld?.(); await h.close(); }
});

test('natural continuation inherits a pending URL resolve and rapid next leaves only the latest target active', async () => {
  const h = harness();
  try {
    await h.play(a); h.core.setQueue([b, c, d]); h.provider.defer(b);
    const preparation = h.core._prefetchNext(); await turn();
    const request = h.provider.calls.at(-1);
    h.playback.emit({ type: 'ended', playInstanceId: h.core.snapshot().current.playInstanceId });
    await turn();
    assert.equal(request.signal.aborted, false, 'natural next keeps the selected background request');
    h.provider.release(b); await preparation; await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B');
    assert.equal(h.provider.calls.filter(call => call.key === trackId(b)).length, 1);
    h.provider.defer(c);
    h.send('next'); await turn();
    const stale = h.provider.calls.at(-1);
    h.send('next'); await h.core.waitForIdle();
    assert.equal(stale.signal.aborted, true);
    h.provider.release(c); await turn();
    assert.equal(h.core.snapshot().current.track.title, 'D');
    assert.equal(h.core.snapshot().status, 'playing');
    assert.equal(h.core.resourceCache.has(trackId(c)), false);
  } finally { await h.close(); }
});

test('expired cached resource is resolved again and stale standby identity is not reused', async () => {
  const h = harness();
  try {
    await h.play(a); h.core.setQueue([b]);
    h.core._rememberResource(b, { handle: 'fake:expired', expiresAt: Date.now() - 1 });
    h.core.preloadedTrackKey = trackId(b);
    h.playback.isPreloaded = resource => resource.handle === 'fake:expired';
    h.send('next'); await h.core.waitForIdle();
    assert.ok(h.provider.calls.some(call => call.key === trackId(b)));
    assert.equal(h.playback.calls.filter(call => call.type === 'load').at(-1).usePreload, false);
    assert.equal(h.core.snapshot().status, 'playing');
  } finally { await h.close(); }
});

test('history anchor survives natural end without an automatic candidate', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) await h.play(track);
    h.send('previous'); await h.core.waitForIdle();
    const instance = h.core.snapshot().current.playInstanceId;
    h.playback.emit({ type: 'ended', playInstanceId: instance });
    assert.equal(h.core.snapshot().current, null);
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'C');
    h.send('previous'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B');
    h.playback.emit({ type: 'ended', playInstanceId: h.core.snapshot().current.playInstanceId });
    h.send('previous'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'A');
  } finally { await h.close(); }
});

test('preparation covers manual library fallback without allowing automatic fallback or consuming random state', async () => {
  const h = harness();
  try {
    h.core.selector = createSelector({ store: h.store, listFamiliar: options => options.libraryFallback ? [b] : [] });
    await h.play(a);
    const randomState = h.core.selector.randomState();
    await h.core._prefetchNext();
    assert.equal(h.core.selector.randomState(), randomState);
    assert.equal(h.playback.preloaded.resource.handle, `fake:${trackId(b)}`);
    h.playback.emit({ type: 'ended', playInstanceId: h.core.snapshot().current.playInstanceId });
    assert.equal(h.core.snapshot().current, null, 'automatic continuation must still wait for approved candidates');
    h.send('next'); await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.title, 'B');
    assert.equal(h.playback.calls.filter(call => call.type === 'load').at(-1).usePreload, true);
    assert.equal(h.provider.calls.filter(call => call.key === trackId(b)).length, 1);
  } finally { await h.close(); }
});
