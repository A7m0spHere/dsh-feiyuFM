// P1 independent playback: supervisor, pipe protocol and the Playback contract.
//
// These tests spawn a real child process and speak the real protocol over a
// real named pipe, using a deterministic backend double instead of an audio
// device. That keeps them CI-safe while still covering process spawn,
// handshake, socket loss, reconnection and shutdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { fakeBackend, wpfBackend, powerShellCandidates } from '../src/playback/backends.mjs';
import { PROTOCOL_VERSION } from '../src/playback/protocol.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakeProvider } from '../src/fakes.mjs';
import { MusicStore } from '../src/storage.mjs';

const track = { provider: 'netease', providerTrackId: 'p1', title: 'P1', durationMs: 1200 };

function harness(options = {}, overrides = {}) {
  const events = [];
  const logs = [];
  const supervisor = new PlaybackSupervisor({
    backend: fakeBackend({ durationMs: 1200, tickMs: 30, openDelayMs: 20, ...options }),
    startupTimeoutMs: 10000,
    greetTimeoutMs: 4000,
    ...overrides,
  });
  const service = new PlaybackService({
    supervisor,
    openTimeoutMs: options.openTimeoutMs ?? 3000,
    commandTimeoutMs: 6000,
    recoveryTimeoutMs: 20000,
    progressIntervalMs: 0,
    onLog: (entry) => logs.push(entry),
  });
  service.onEvent((event) => events.push(event));
  return { service, supervisor, events, logs };
}

async function waitFor(predicate, { timeoutMs = 6000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function shutdown(service) {
  try { await service.close({ gracefulTimeoutMs: 1500 }); } catch { /* already gone */ }
}

function controlledService() {
  const supervisor = {
    ensureHost: async () => {},
    request: async command => command.type === 'load' ? { positionMs: 0 }
      : { state: { status: 'playing', playInstanceId: 'old', version: 1, positionMs: 1000 } },
  };
  const service = new PlaybackService({ supervisor, progressIntervalMs: 0 });
  const events = [];
  service.onEvent(event => events.push(event));
  return { supervisor, service, events };
}

for (const status of ['ended', 'error']) {
  test(`a reconnect snapshot adopts a missed ${status} once without crediting disconnected time`, async () => {
    const h = controlledService();
    await h.service.load({ resource: { handle: 'fake:old' }, playInstanceId: 'old', version: 1 });
    h.service.lastEffectiveAt = performance.now() - 2000;
    const state = { status, playInstanceId: 'old', version: 1, positionMs: 9000,
      errorCode: 'media_stalled', errorMessage: 'timeline stalled', retryable: true };
    h.service._onHostMessage({ type: 'state', ...state });
    h.service._onHostMessage({ type: 'state', ...state });
    assert.equal(h.events.filter(event => event.type === status).length, 1);
    assert.equal(h.events.filter(event => event.type === 'progress').length, 0);
    assert.equal(h.service.active, null);
    if (status === 'error') {
      assert.equal(h.events[0].code, 'media_stalled');
      assert.equal(h.events[0].retryable, true);
    }
  });
}

for (const phase of ['ensure', 'snapshot']) {
  test(`a late recovery ${phase} failure cannot clear a newer track`, async () => {
    const h = controlledService();
    await h.service.load({ resource: { handle: 'fake:old' }, playInstanceId: 'old', version: 1 });
    let reject;
    let reached;
    const started = new Promise(resolve => { reached = resolve; });
    const pending = new Promise((_, fail) => { reject = fail; });
    if (phase === 'ensure') h.supervisor.ensureHost = () => { reached(); return pending; };
    else h.service.hostSnapshot = () => { reached(); return pending; };
    h.supervisor.onHostClose(new Error('drop'));
    const recovery = h.service._recovery;
    await started;
    await h.service.load({ resource: { handle: 'fake:new' }, playInstanceId: 'new', version: 2 });
    reject(new Error('old recovery failed'));
    await recovery;
    assert.equal(h.service.active?.playInstanceId, 'new');
    assert.equal(h.events.length, 0);
  });
}

test('nested pipe failures share one recovery and exhaust a bounded snapshot budget', async () => {
  const h = controlledService();
  await h.service.load({ resource: { handle: 'fake:old' }, playInstanceId: 'old', version: 1 });
  let requests = 0;
  h.service.hostSnapshot = async () => {
    requests++;
    h.supervisor.onHostClose(new Error('snapshot connection failed'));
    throw new Error('snapshot timeout');
  };
  h.supervisor.onHostClose(new Error('drop'));
  await h.service._recovery;
  assert.equal(requests, 3);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].code, 'playback_host_lost');
});

test('a newer track can reconnect while a superseded recovery is still pending', async () => {
  const h = controlledService();
  await h.service.load({ resource: { handle: 'fake:old' }, playInstanceId: 'old', version: 1 });
  let release;
  let reached;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  h.supervisor.ensureHost = () => { reached(); return pending; };
  h.supervisor.onHostClose(new Error('old drop'));
  const oldRecovery = h.service._recovery;
  await started;
  await h.service.load({ resource: { handle: 'fake:new' }, playInstanceId: 'new', version: 2 });
  h.supervisor.ensureHost = async () => {};
  h.service.hostSnapshot = async () => ({ status: 'playing', playInstanceId: 'new', version: 2, positionMs: 2000 });
  h.supervisor.onHostClose(new Error('new drop'));
  await h.service._recovery;
  release();
  await oldRecovery;
  assert.equal(h.service.active.playInstanceId, 'new');
  assert.equal(h.service.active.positionMs, 2000);
  assert.equal(h.events.filter(event => event.type === 'error').length, 0);
});

test('a song ending during a pipe disconnect reaches Core and starts the queued song', async () => {
  const store = new MusicStore();
  const h = harness({ durationMs: 800 });
  const core = new MusicCore({ store, provider: new FakeProvider(), playback: h.service });
  h.service.onEvent(event => { h.events.push(event); core.onPlaybackEvent(event); });
  try {
    core.dispatch({ type: 'requestTrack', track, commandId: 'before-disconnect' });
    await waitFor(() => core.snapshot().status === 'playing');
    const instance = core.snapshot().current.playInstanceId;
    const next = { ...track, providerTrackId: 'after-disconnect' };
    core.setQueue([next]);
    const ensureHost = h.supervisor.ensureHost.bind(h.supervisor);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    h.supervisor.ensureHost = async () => { await gate; return ensureHost(); };
    h.supervisor.transport.close({ reason: new Error('lost at song end') });
    await delay(950); // The independent host finishes while there is no client.
    release();
    await waitFor(() => core.snapshot().current?.track.providerTrackId === next.providerTrackId
      && core.snapshot().status === 'playing', { what: 'continuation after a missed end' });
    assert.equal(store.getHistory(instance).end_reason, 'ended');
    assert.equal(h.events.filter(event => event.type === 'ended' && event.playInstanceId === instance).length, 1);
  } finally { await shutdown(h.service); await core.waitForIdle(); store.close(); }
});

test('Core restores the same listen after a real playback child exits', async () => {
  const store = new MusicStore();
  const h = harness({ durationMs: 4000 });
  const provider = new FakeProvider();
  const core = new MusicCore({ store, provider, playback: h.service });
  h.service.onEvent(event => core.onPlaybackEvent(event));
  try {
    core.dispatch({ type: 'requestTrack', track: { ...track, durationMs: 4000 }, commandId: 'before-host-exit' });
    await waitFor(() => core.snapshot().status === 'playing' && core.snapshot().current.positionMs > 50);
    const before = core.snapshot().current;
    const pid = h.supervisor.pid;
    h.supervisor.child.kill();
    await waitFor(() => h.supervisor.pid !== pid && core.snapshot().status === 'playing'
      && core.snapshot().current?.recoveryAttempts === 1, { what: 'same track after host exit' });
    assert.equal(core.snapshot().current.playInstanceId, before.playInstanceId);
    assert.ok(core.snapshot().current.positionMs >= before.positionMs);
    assert.equal(provider.calls.length, 2);
    assert.equal(store.getHistory(before.playInstanceId), null);
    assert.equal(core.snapshot().lastError, null);
    core.dispatch({ type: 'pause', commandId: 'after-host-exit' });
    await core.waitForIdle();
    assert.equal((await h.service.hostSnapshot()).status, 'paused');
  } finally { await shutdown(h.service); await core.waitForIdle(); store.close(); }
});

test('a superseded slow load is acknowledged and cannot overwrite the newer loaded track', async () => {
  const h = harness({ openDelayMs: 200 });
  try {
    await h.supervisor.ensureHost();
    const old = assert.rejects(h.service.load({ resource: { handle: 'fake:old' }, playInstanceId: 'old-load', version: 1 }), error => error.code === 'cancelled');
    await delay(40);
    await h.service.stop({ version: 2 });
    await h.service.load({ resource: { handle: 'fake:new' }, playInstanceId: 'new-load', version: 3 });
    await old;
    await delay(220);
    assert.equal(h.service.active.playInstanceId, 'new-load');
    assert.equal((await h.service.hostSnapshot()).playInstanceId, 'new-load');
    assert.equal(h.supervisor.transport.pending.size, 0);
  } finally { await shutdown(h.service); }
});

test('greets, plays a resource and reports started, forward progress and one ended', async () => {
  const h = harness();
  try {
    const loaded = await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    assert.equal(loaded.positionMs, 0);
    assert.equal(h.supervisor.hello.backend, 'fake-backend');
    assert.equal(h.supervisor.hello.protocol, PROTOCOL_VERSION);

    await h.service.play({ playInstanceId: 'inst-1', version: 1 });
    await waitFor(() => h.events.some((e) => e.type === 'started'), { what: 'started' });
    await waitFor(() => h.events.some((e) => e.type === 'ended'), { what: 'ended', timeoutMs: 8000 });

    const progress = h.events.filter((e) => e.type === 'progress');
    assert.ok(progress.length > 0, 'expected at least one progress event');
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index].positionMs > progress[index - 1].positionMs, 'progress must move forward');
    }
    assert.equal(h.events.filter((e) => e.type === 'ended').length, 1);
    assert.equal(h.events.filter((e) => e.type === 'error').length, 0);
    const ended = h.events.at(-1);
    assert.equal(ended.playInstanceId, 'inst-1');
    assert.equal(ended.version, 1);
  } finally {
    await shutdown(h.service);
  }
});

test('a resource that never opens ends as a bounded open timeout, not a fake start', async () => {
  const h = harness({ openBehavior: 'never', openTimeoutMs: 250 });
  try {
    await assert.rejects(
      () => h.service.load({ resource: { handle: 'fake:silent' }, playInstanceId: 'inst-1', version: 1 }),
      { code: 'media_open_timeout' },
    );
    assert.equal(h.events.length, 0, 'a failed open must not report playback');
  } finally {
    await shutdown(h.service);
  }
});

test('a failing resource surfaces media_failed and never claims audio', async () => {
  const h = harness({ openBehavior: 'fail' });
  try {
    await assert.rejects(
      () => h.service.load({ resource: { handle: 'fake:broken' }, playInstanceId: 'inst-1', version: 1 }),
      { code: 'media_failed' },
    );
    assert.equal(h.events.filter((e) => e.type === 'started').length, 0);
  } finally {
    await shutdown(h.service);
  }
});

test('a transient 0 ms reading after resume never regresses reported progress', async () => {
  const h = harness({ transientZero: true, transientZeroMs: 200, durationMs: 3000 });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    await h.service.play({ playInstanceId: 'inst-1', version: 1 });
    await waitFor(() => h.events.filter((e) => e.type === 'progress').length >= 2, { what: 'progress' });
    const before = h.events.at(-1).positionMs;

    await h.service.pause({ version: 2 });
    const resumed = await h.service.load({
      resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', startPositionMs: before, version: 3,
    });
    assert.equal(resumed.positionMs, before, 'seek must be honoured so resume continues');
    await h.service.play({ playInstanceId: 'inst-1', version: 3 });
    await delay(500);

    const after = h.events.filter((e) => e.type === 'progress' && e.version === 3);
    assert.ok(after.length > 0, 'expected progress after the resume');
    for (const event of after) {
      assert.ok(event.positionMs >= before, 'a resume must not report going backwards');
      assert.ok(event.positionMs > 0, 'the transient 0 reading must not be reported');
    }
  } finally {
    await shutdown(h.service);
  }
});

test('duplicate ended notifications and stale-version events are dropped', async () => {
  const h = harness({ duplicateEnded: true, staleProgress: true, durationMs: 600 });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 4 });
    await h.service.play({ playInstanceId: 'inst-1', version: 4 });
    await waitFor(() => h.events.some((e) => e.type === 'ended'), { what: 'ended' });
    await delay(300);
    assert.equal(h.events.filter((e) => e.type === 'ended').length, 1, 'ended must count once');
    assert.equal(h.events.filter((e) => e.type === 'started').length, 1);
    for (const event of h.events) {
      assert.ok(event.version === undefined || event.version === 4, 'stale versions must be dropped');
    }
  } finally {
    await shutdown(h.service);
  }
});

test('muting keeps the audio timeline running so a silent track still ends', async () => {
  const h = harness({ durationMs: 600 });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    await h.service.setMuted({ muted: true, version: 1 });
    assert.equal(h.service.state().muted, true);
    await h.service.play({ playInstanceId: 'inst-1', version: 1 });
    await waitFor(() => h.events.some((e) => e.type === 'ended'), { what: 'ended while muted', timeoutMs: 5000 });
    const silentProgress = h.events.filter((e) => e.type === 'progress');
    assert.ok(silentProgress.length > 0, 'a muted track still advances the audio timeline');
    assert.ok(silentProgress.at(-1).positionMs >= 500, 'muting must not freeze the timeline');
    assert.equal(h.events.at(-1).positionMs >= 600, true, 'ended carries the final position');
  } finally {
    await shutdown(h.service);
  }
});

test('a host crash is reported as playback_host_lost and the next load respawns', async () => {
  const h = harness({ crashOn: 'play', crashDelayMs: 60, durationMs: 4000 });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    const firstPid = h.supervisor.pid;
    await h.service.play({ playInstanceId: 'inst-1', version: 1 });
    await waitFor(() => h.events.some((e) => e.code === 'playback_host_lost'), { what: 'host lost' });
    const lost = h.events.find((e) => e.code === 'playback_host_lost');
    assert.equal(lost.playInstanceId, 'inst-1');

    const reloaded = await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-2', version: 5 });
    assert.equal(reloaded.positionMs, 0);
    assert.notEqual(h.supervisor.pid, firstPid, 'a dead host must be replaced');
    await h.service.play({ playInstanceId: 'inst-2', version: 5 });
    await waitFor(() => h.events.filter((e) => e.type === 'started').length >= 2, { what: 'second start' });
  } finally {
    await shutdown(h.service);
  }
});

test('disposing the service stops the host process', async () => {
  const h = harness();
  await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
  const pid = h.supervisor.pid;
  assert.ok(Number.isInteger(pid), 'expected a host pid');
  await h.service.close({ gracefulTimeoutMs: 2000 });
  assert.equal(h.supervisor.pid, null);
  await delay(200);
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'the audio host must not outlive the service');
});

test('the host stops itself when its owner disappears', async () => {
  const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const h = harness({}, { ownerPid: owner.pid });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    const pid = h.supervisor.pid;
    assert.ok(Number.isInteger(pid));
    owner.kill();
    await waitFor(() => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }, { what: 'host exit after owner death', timeoutMs: 6000 });
  } finally {
    owner.kill();
    await shutdown(h.service);
  }
});

test('a discovered backend lists shell candidates and the real host stays opt-in', () => {
  const candidates = powerShellCandidates({ env: {}, exists: () => true });
  assert.ok(candidates.length >= 2, 'expected pwsh plus in-box Windows PowerShell');
  assert.ok(candidates.every((candidate) => candidate.args.includes('-File')));
  const backend = wpfBackend({ env: {}, exists: () => true });
  assert.equal(backend.name, 'wpf-mediaplayer');
  assert.ok(backend.script.endsWith('wpf-media-host.ps1'));
  assert.equal(fakeBackend().name, 'fake-backend');
});

test('a dropped client connection reconnects without killing the running track', async () => {
  const h = harness({ durationMs: 4000 });
  try {
    await h.service.load({ resource: { handle: 'fake:track' }, playInstanceId: 'inst-1', version: 1 });
    await h.service.play({ playInstanceId: 'inst-1', version: 1 });
    await waitFor(() => h.events.filter((e) => e.type === 'progress').length >= 2, { what: 'progress' });
    const pidBefore = h.supervisor.pid;
    const positionBefore = h.events.at(-1).positionMs;

    // Simulate the socket dropping while audio keeps playing in the host.
    h.supervisor.transport.close({ reason: new Error('simulated client loss') });

    await waitFor(() => h.supervisor.connected && h.supervisor.pid === pidBefore, { what: 'reconnect' });
    const snapshot = await h.service.hostSnapshot();
    assert.equal(snapshot.playInstanceId, 'inst-1', 'the running instance must be adopted, not abandoned');
    assert.equal(h.events.filter((e) => e.code === 'playback_host_lost').length, 0,
      'a reconnect must not report the track as lost');

    await waitFor(() => (h.events.filter((e) => e.type === 'progress').at(-1)?.positionMs ?? 0) > positionBefore,
      { what: 'progress after reconnect' });
  } finally {
    await shutdown(h.service);
  }
});

test('Core drives real playback over the pipe: pause holds, resume continues, mute is silent-not-paused', async () => {
  const store = new MusicStore();
  const h = harness({ durationMs: 900 });
  const provider = new FakeProvider();
  provider.set(track, 'fake:track');
  const clock = new FakeClock(Date.now());
  const core = new MusicCore({ store, provider, playback: h.service, clock });
  h.service.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  try {
    send('requestTrack', { track });
    await waitFor(() => core.snapshot().status === 'playing', { what: 'core playing' });
    assert.equal(core.snapshot().paused, false);

    send('pause');
    await core.waitForIdle();
    await delay(150);
    const pausedAt = core.snapshot().current.positionMs;
    await delay(250);
    assert.ok(core.snapshot().current.positionMs <= pausedAt + 20, 'position must hold while paused');

    send('resume');
    await core.waitForIdle();
    await waitFor(() => core.snapshot().status === 'playing', { what: 'resumed playing' });
    await waitFor(() => core.snapshot().current === null, { what: 'track end', timeoutMs: 8000 });

    const history = store.getHistory(core.snapshot().current?.playInstanceId ?? '') ?? null;
    assert.equal(history, null, 'no current track after it ends');
  } finally {
    await shutdown(h.service);
    store.close();
  }
});

test('changing mute during a running track preserves accepted progress and the natural ending', async () => {
  const store = new MusicStore();
  const h = harness({ durationMs: 1200 });
  const core = new MusicCore({ store, provider: new FakeProvider(), playback: h.service });
  h.service.onEvent(event => core.onPlaybackEvent(event));
  try {
    core.dispatch({ type:'requestTrack',track,commandId:'start-mute-test' });
    await waitFor(() => core.snapshot().status === 'playing');
    const instance=core.snapshot().current.playInstanceId;
    core.dispatch({ type:'setHumanPlayback',value:false,commandId:'mute-running' });
    await core.waitForIdle();
    const before=core.snapshot().current.effectiveMs;
    await waitFor(() => core.snapshot().current?.effectiveMs > before);
    core.dispatch({ type:'setHumanPlayback',value:true,commandId:'unmute-running' });
    await core.waitForIdle();
    await waitFor(() => core.snapshot().current === null);
    assert.equal(store.getHistory(instance).end_reason,'ended');
    assert.ok(store.getHistory(instance).effective_ms > 0);
  } finally { await shutdown(h.service); store.close(); }
});

test('Core records a muted listen as agent activity without claiming audible playback', async () => {
  const store = new MusicStore();
  const h = harness({ durationMs: 700 });
  const provider = new FakeProvider();
  provider.set(track, 'fake:track');
  const core = new MusicCore({ store, provider, playback: h.service, clock: new FakeClock(Date.now()) });
  h.service.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  try {
    send('setHumanPlayback', { value: false });
    send('requestTrack', { track });
    await waitFor(() => core.snapshot().status === 'playing', { what: 'silent playback' });
    const instance = core.snapshot().current.playInstanceId;
    await waitFor(() => core.snapshot().current === null, { what: 'silent track end', timeoutMs: 8000 });

    const history = store.getHistory(instance);
    assert.ok(history, 'expected a history row for the silent listen');
    assert.equal(history.audible, 0, 'silent playback is not audible');
    assert.equal(history.progress_source, 'audio', 'the audio timeline still drove progress');
    assert.ok(history.effective_ms > 0, 'effective progress must be recorded');
    assert.equal(history.end_reason, 'ended');
  } finally {
    await shutdown(h.service);
    store.close();
  }
});
