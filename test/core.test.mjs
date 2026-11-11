import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicCore } from '../src/core.mjs';
import { trackId } from '../src/contracts.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';
import { MusicStore } from '../src/storage.mjs';
import { createSelector } from '../src/selection.mjs';
import {applyListenGrowth} from '../src/growth.mjs';

const a = { provider: 'netease', providerTrackId: '1', title: 'A', durationMs: 180000 };
const b = { provider: 'qq', providerTrackId: '1', title: 'B', durationMs: 170000 };
const c = { provider: 'netease', providerTrackId: '2', title: 'C', durationMs: 160000 };

function harness(store = new MusicStore()) {
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const clock = new FakeClock(new Date('2026-09-27T12:00:00+08:00').getTime());
  const core = new MusicCore({ store, provider, playback, clock });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `cmd-${++id}`, type, ...extra });
  return { store, provider, playback, clock, core, send };
}

test('volume validates input, remembers the last audible level and restores it after restart', async () => {
  const h = harness();
  try {
    assert.equal(h.core.snapshot().settings.volume, 0.35);
    for (const value of [NaN, Infinity, -0.1, 1.1, '0.5', null]) {
      assert.throws(() => h.send('setVolume', { value }), { code: 'invalid_command' });
    }
    for (const previousVolume of [NaN, Infinity, 0, -0.1, 1.1, '0.5', null]) {
      assert.throws(() => h.send('setVolume', { value: 0, previousVolume }), { code: 'invalid_command' });
    }
    h.send('setVolume', { value: 0.62 });
    await h.core.waitForIdle();
    h.send('setVolume', { value: 0 });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().settings.volume, 0.62);
    assert.equal(h.core.snapshot().settings.humanPlayback, false);
    const restored = harness(h.store);
    assert.equal(restored.core.snapshot().settings.volume, 0.62);
    assert.equal(restored.core.snapshot().settings.humanPlayback, false);
    restored.send('setHumanPlayback', { value: true, commandId: 'restore-sound' });
    await restored.core.waitForIdle();
    restored.send('requestTrack', { track: a, commandId: 'restored-play' });
    await restored.core.waitForIdle();
    assert.equal(restored.playback.volume, 0.62);
    assert.equal(restored.playback.muted, false);
  } finally { h.store.close(); }
});

test('a coalesced zero volume atomically remembers the latest unconfirmed nonzero level', async () => {
  const h = harness();
  try {
    h.send('setVolume', { value: 0.2 });
    h.send('setVolume', { value: 0, previousVolume: 0.87 });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().settings.volume, 0.87);
    assert.equal(h.core.snapshot().settings.humanPlayback, false);
    assert.equal(h.playback.volume, 0.87);
    assert.equal(h.playback.muted, true);
    assert.equal(h.playback.calls.filter(call => call.type === 'setVolume').length, 1);
  } finally { h.store.close(); }
});

test('legacy settings gain the existing 35 percent default without changing mute', () => {
  const store = new MusicStore();
  const h = harness(store);
  const saved = h.core.snapshot();
  delete saved.settings.volume;
  saved.settings.humanPlayback = false;
  store.setCoreState(saved);
  try {
    const restored = harness(store);
    assert.equal(restored.core.snapshot().settings.volume, 0.35);
    assert.equal(restored.core.snapshot().settings.humanPlayback, false);
  } finally { store.close(); }
});

test('volume changes preserve an in-flight resolve and cannot undo pause or replace the play instance', async () => {
  const h = harness();
  try {
    h.provider.defer(a);
    h.send('requestTrack', { track: a });
    await new Promise(resolve => setImmediate(resolve));
    const before = h.core.snapshot();
    h.send('setVolume', { value: 0.7 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.core.snapshot().commandVersion, before.commandVersion);
    assert.equal(h.provider.calls.length, 1);
    assert.equal(h.provider.calls[0].signal.aborted, false);
    h.provider.release(a);
    await h.core.waitForIdle();
    assert.equal(h.playback.volume, 0.7);
    h.send('pause');
    h.send('setVolume', { value: 0.2 });
    await h.core.waitForIdle();
    assert.equal(h.playback.playing, false);
    assert.equal(h.core.snapshot().paused, true);
    assert.equal(h.core.snapshot().current.playInstanceId, before.current.playInstanceId);
    assert.equal(h.playback.volume, 0.2);
  } finally { h.store.close(); }
});

test('a failed volume update preserves the current track and a later retry clears its error', async () => {
  const h = harness();
  try {
    h.send('requestTrack', { track: a });
    await h.core.waitForIdle();
    const current = h.core.snapshot().current.playInstanceId;
    h.playback.failNextControl('setVolume');
    h.send('setVolume', { value: 0.8 });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().status, 'playing');
    assert.equal(h.core.snapshot().current.playInstanceId, current);
    assert.equal(h.core.snapshot().volumeError.code, 'playback_control_failure');
    h.send('setVolume', { value: 0.8 });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().volumeError, null);
    assert.equal(h.playback.volume, 0.8);
  } finally { h.store.close(); }
});

test('next uses the imported library with an empty queue, excludes the current song and preserves pause', async () => {
  const h = harness();
  h.core.selector = createSelector({ store: h.store, listFamiliar: () => [a, b], now: () => h.clock.now() });
  try {
    h.send('requestTrack', { track: a });
    await h.core.waitForIdle();
    h.send('pause');
    h.send('setListening', { value: false });
    h.send('next');
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().current.track.provider, 'qq');
    assert.equal(h.core.snapshot().current.selectedBy, 'agent');
    assert.equal(h.core.snapshot().current.selectionTrigger, 'user-next');
    assert.equal(h.core.snapshot().lastSelection.trackKey,'qq:1');
    assert.equal(h.core.snapshot().lastSelection.decisionId,h.core.snapshot().current.decisionId);
    assert.equal(h.store.getSetting('decision_history_v1').at(-1).playInstanceId,h.core.snapshot().current.playInstanceId);
    assert.equal(h.core.snapshot().paused, true);
    assert.equal(h.playback.playing, false);
    h.send('banTrack', { track: a });
    assert.throws(() => h.send('next'), { code: 'no_candidates' });
    assert.equal(h.core.snapshot().current.track.provider, 'qq');
  } finally { h.store.close(); }
});

test('user-next retains recommendation origin and only subsequent valid listening earns growth',async()=>{
 const h=harness(),recommended={...a,discovery:{source:'netease_daily'}};
 h.core.selector=createSelector({store:h.store,listDiscovery:()=>[recommended],now:()=>h.clock.now()});
 h.core.onListened=entry=>applyListenGrowth({store:h.store,entry,durationMs:entry.durationMs,now:h.clock.now()});
 try{
  h.send('setDiscoveryRate',{value:1});h.send('next');await h.core.waitForIdle();
  const current=h.core.snapshot().current;
  assert.equal(current.selectedBy,'agent');assert.equal(current.selectionTrigger,'user-next');
  assert.equal(current.origin.source,'netease_daily');assert.equal(current.selectionPool,'discovery');
  assert.equal(h.store.getPreference('track','netease:1'),null,'selecting while paused cannot manufacture growth');
  h.send('resume');await h.core.waitForIdle();
  h.playback.emit({type:'progress',playInstanceId:current.playInstanceId,positionMs:60000});
  h.send('pause');h.core._finishCurrent('ended');
  assert.equal(h.store.getHistory(current.playInstanceId).selected_by,'agent');assert.ok(h.store.getPreference('track','netease:1').affinity>.5);
  h.send('requestTrack',{track:b});await h.core.waitForIdle();assert.equal(h.core.snapshot().current.selectedBy,'user');
 }finally{await h.core.waitForIdle();h.store.close();}
});

test('late resolve cannot replace a newer user track or undo pause', async () => {
  const h = harness();
  h.provider.defer(a);
  h.send('requestTrack', { track: a });
  await new Promise((resolve) => setImmediate(resolve));
  h.send('requestTrack', { track: b });
  assert.equal(h.provider.calls[0].signal.aborted, true);
  h.provider.release(a);
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  assert.equal(h.playback.loaded.playInstanceId, h.core.snapshot().current.playInstanceId);
  h.send('pause');
  await h.core.waitForIdle();
  assert.equal(h.playback.playing, false);
  const old = h.core.snapshot().current.playInstanceId;
  assert.equal(h.core.onPlaybackEvent({ type: 'ended', playInstanceId: old }), false);
  assert.equal(h.core.snapshot().paused, true);
  h.store.close();
});

test('pause cancels a slow resolve before playback begins', async () => {
  const h = harness();
  h.provider.defer(a);
  h.send('requestTrack', { track: a });
  await new Promise((resolve) => setImmediate(resolve));
  h.send('pause');
  assert.equal(h.provider.calls[0].signal.aborted, true);
  h.provider.release(a);
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().paused, true);
  assert.equal(h.playback.calls.some((call) => call.type === 'load'), false);
  h.store.close();
});

test('next while paused changes track but does not start playback', async () => {
  const h = harness();
  h.core.setQueue([a, b]);
  h.send('next');
  assert.equal(h.core.snapshot().current.track.provider, 'netease');
  assert.equal(h.core.snapshot().paused, true);
  assert.equal(h.playback.playing, false);
  h.send('resume');
  await h.core.waitForIdle();
  assert.equal(h.playback.playing, true);
  h.send('pause');
  h.send('next');
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  assert.equal(h.playback.playing, false);
  h.store.close();
});

test('duplicate ending and backward progress only count once', async () => {
  const h = harness();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  assert.equal(h.core.onPlaybackEvent({ type: 'progress', playInstanceId, positionMs: 12000 }), true);
  assert.equal(h.core.onPlaybackEvent({ type: 'progress', playInstanceId, positionMs: 5000 }), false);
  h.playback.emit({ type: 'ended', playInstanceId }, 2);
  assert.equal(h.store.getHistory(playInstanceId).effective_ms, 12000);
  assert.equal(h.store.getTrackStats(a).play_count, 1);
  h.store.close();
});

test('restart restores the selected track paused without inventing progress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-'));
  const path = join(directory, 'test.sqlite');
  try {
    const first = harness(new MusicStore(path));
    first.send('requestTrack', { track: a });
    await first.core.waitForIdle();
    const id = first.core.snapshot().current.playInstanceId;
    first.core.onPlaybackEvent({ type: 'progress', playInstanceId: id, positionMs: 3000 });
    first.store.setCredentialReference({ provider: 'netease', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: first.clock.now() });
    first.store.close();
    const second = harness(new MusicStore(path));
    assert.equal(second.core.snapshot().paused, true);
    assert.equal(second.core.snapshot().current.positionMs, 3000);
    assert.equal(second.playback.playing, false);
    assert.equal(second.store.getTrackStats(a), null);
    assert.equal(second.store.getCredentialReference('netease').credential_ref, 'fishfm/netease');
    second.store.removeCredentialReference('netease');
    assert.equal(second.store.getCredentialReference('netease'), null);
    second.store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('commands are deduplicated and stale UI revisions are rejected', () => {
  const h = harness();
  const first = h.core.dispatch({ commandId: 'fixed', type: 'setHumanPlayback', value: false });
  h.core.dispatch({ commandId: 'fixed', type: 'setHumanPlayback', value: true });
  assert.equal(h.core.snapshot().settings.humanPlayback, false);
  assert.equal(h.core.snapshot().revision, first.revision);
  assert.throws(() => h.core.dispatch({ commandId: 'stale', type: 'pause', expectedRevision: 0 }), { code: 'stale_revision' });
  h.store.close();
});

test('today restriction does not auto resume at expiry; explicit choice does', async () => {
  const h = harness();
  h.core.setQueue([a]);
  h.send('stopForToday');
  assert.equal(h.core.selectAutonomously(), false);
  h.clock.advance(24 * 60 * 60 * 1000);
  assert.equal(h.core.selectAutonomously(), false);
  h.send('chooseSelf');
  assert.equal(h.core.snapshot().settings.listening, true);
  assert.equal(h.core.snapshot().paused, false);
  await h.core.waitForIdle();
  h.store.close();
});

test('ban constraint blocks point play and filters queued candidate', () => {
  const h = harness();
  h.send('banTrack', { track: a });
  assert.throws(() => h.send('requestTrack', { track: a }), { code: 'constraint_conflict' });
  h.core.setQueue([a, b]);
  h.send('next');
  assert.equal(h.core.snapshot().current.track.provider, 'qq');
  h.store.close();
});

test('nonretryable provider failure is bounded and does not count as listening', async () => {
  const h = harness();
  h.provider.failNext(a, 1, false);
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.provider.calls.length, 1);
  assert.equal(h.core.snapshot().status, 'error');
  assert.equal(h.store.getTrackStats(a), null);
  h.store.close();
});

test('retryable resolution stops after two attempts', async () => {
  const store = new MusicStore();
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const core = new MusicCore({ store, provider, playback,
    clock: { now: () => 1, sleep: async () => {} } });
  provider.failNext(a, 5, true);
  core.dispatch({ commandId: 'retry', type: 'requestTrack', track: a });
  await core.waitForIdle();
  // Two attempts: a third 4 s wait only delays the error the user sees.
  assert.equal(provider.calls.length, 2);
  assert.equal(core.snapshot().lastError.code, 'provider_failure');
  assert.equal(playback.playing, false);
  store.close();
});

test('playback load failure is visible without a fabricated listen', async () => {
  const h = harness();
  h.playback.failNextLoad();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().lastError.code, 'playback_failure');
  assert.equal(h.store.getTrackStats(a), null);
  h.store.close();
});

test('download failures persist only the known download stage for the playback notice', async () => {
  const h = harness();
  try {
    h.playback.load = async () => { throw Object.assign(new Error('Media preparation timed out'), {
      code: 'media_open_timeout', retryable: true,
      details: { stage: 'download', url: 'https://private.example/?token=secret', bytes: 123 },
    }); };
    h.send('requestTrack', { track: a });
    await h.core.waitForIdle();
    assert.deepEqual(h.core.snapshot().lastError.details, { stage: 'download' });
    assert.deepEqual(h.store.getCoreState().lastError.details, { stage: 'download' });
    assert.equal(JSON.stringify(h.store.getCoreState()).includes('secret'), false);

    h.playback.load = async () => { throw Object.assign(new Error('Playback failed'), {
      code: 'media_failed', details: { stage: 'private-token' },
    }); };
    h.send('requestTrack', { track: c });
    await h.core.waitForIdle();
    assert.equal(h.core.snapshot().lastError.details, undefined);
  } finally { h.store.close(); }
});

test('mode and switch combinations preserve explicit mute and pause', async () => {
  const h = harness();
  h.send('setMode', { value: 'off' });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [false, false]);
  h.send('setListening', { value: true });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [true, false]);
  assert.equal(h.core.snapshot().paused, true);
  // 模式按钮是开始听歌的快捷操作：日常/专注必须恢复声音；
  // 空曲库时启动失败也要报 no_candidates，而不是静默无操作。
  assert.throws(() => h.send('setMode', { value: 'focus' }), { code: 'no_candidates' });
  assert.equal(h.core.snapshot().settings.strategy, 'focus');
  assert.equal(h.core.snapshot().settings.humanPlayback, true);
  assert.equal(h.core.snapshot().paused, false);
  h.send('setHumanPlayback', { value: true });
  h.send('setListening', { value: false });
  assert.deepEqual([h.core.snapshot().settings.listening, h.core.snapshot().settings.humanPlayback], [false, true]);
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  assert.equal(h.playback.playing, true);
  h.store.close();
});

test('audible modes restore sound output after silent or off', async () => {
  const h = harness();
  h.core.setQueue([a, b]);
  h.send('setMode', { value: 'silent' });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().settings.humanPlayback, false);
  assert.equal(h.playback.muted, true);
  h.send('setMode', { value: 'normal' });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().settings.humanPlayback, true, '日常必须恢复声音设置');
  assert.equal(h.playback.muted, false, '播放中的静音必须被解除');
  h.send('setMode', { value: 'off' });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().paused, true);
  h.send('setMode', { value: 'focus' });
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().settings.humanPlayback, true, '从关闭切回专注同样恢复声音');
  assert.equal(h.core.snapshot().paused, false);
  assert.equal(h.playback.playing, true);
  assert.equal(h.playback.muted, false);
  h.store.close();
});

test('blocked autonomy start reports autonomy_blocked and chooseSelf restores it', async () => {
  const h = harness();
  h.send('stopForToday');
  await h.core.waitForIdle();
  assert.throws(() => h.send('resume'), { code: 'autonomy_blocked' });
  assert.throws(() => h.send('setMode', { value: 'normal' }), { code: 'autonomy_blocked' });
  h.core.setQueue([a]);
  h.send('chooseSelf');
  assert.equal(h.core.snapshot().blockUntil, null);
  assert.equal(h.store.activeConstraints(h.clock.now()).some((row) => row.id === 'stop-today'), false);
  await h.core.waitForIdle();
  assert.equal(h.core.snapshot().current.track.provider, 'netease', '恢复后立即从队列开始自主播放');
  h.store.close();
});

test('logical progress records agent activity without claiming audible playback', async () => {
  const h = harness();
  h.core.setQueue([a]);
  h.send('setMode', { value: 'silent' });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  h.playback.emit({ type: 'progress', playInstanceId, progressSource: 'logical', positionMs: 5000 });
  h.playback.emit({ type: 'ended', playInstanceId }, 2);
  const history = h.store.getHistory(playInstanceId);
  assert.equal(history.selected_by, 'agent');
  assert.equal(history.agent_listening, 1);
  assert.equal(history.audible, 0);
  assert.equal(history.progress_source, 'logical');
  h.store.close();
});

test('resume reuses the paused player, keeps its position, and rejects old events', async () => {
  const h = harness();
  h.send('requestTrack', { track: a });
  await h.core.waitForIdle();
  const playInstanceId = h.core.snapshot().current.playInstanceId;
  const oldVersion = h.core.snapshot().commandVersion;
  h.playback.emit({ type: 'progress', playInstanceId, positionMs: 5000 });
  h.send('pause');
  h.playback.supportsSeek = false;
  h.send('resume');
  await h.core.waitForIdle();
  // The paused player still holds the media, so resuming is a plain play: no
  // reload and no seek, hence the position is preserved even without seek.
  assert.equal(h.core.snapshot().current.positionMs, 5000);
  assert.equal(h.core.snapshot().status, 'playing');
  assert.equal(h.core.onPlaybackEvent({ type: 'ended', playInstanceId, version: oldVersion }), false);
  assert.equal(h.core.snapshot().current.playInstanceId, playInstanceId);
  h.store.close();
});

test('previous without any playback history reports no_previous instead of an internal error', () => {
  const h = harness();
  try {
    assert.equal(h.core.snapshot().navigation.previous, false);
    assert.throws(() => h.send('previous'), { code: 'no_previous' });
    assert.equal(h.core.snapshot().current, null);
  } finally { h.store.close(); }
});

test('previous walks the real playback history backwards and stops at the oldest', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) { h.send('requestTrack', { track }); await h.core.waitForIdle(); }
    assert.equal(h.core.snapshot().navigation.previous, true);
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'qq:1');
    assert.equal(h.core.snapshot().current.selectedBy, 'user');
    // 第二首 B 的播放记录已经追加，但游标固定在原快照上：再按上一首回到 A，
    // 不会因为新记录把 B 又算成「更早」而回到 C。
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:1');
    assert.equal(h.core.snapshot().navigation.previous, false);
    assert.throws(() => h.send('previous'), { code: 'no_previous' });
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:1');
  } finally { await h.core.waitForIdle(); h.store.close(); }
});

test('previous bypasses the automatic repeat window but still honors bans and availability', async () => {
  const h = harness();
  h.core.selector = createSelector({ store: h.store, listFamiliar: () => [a, b, c], now: () => h.clock.now() });
  try {
    for (const track of [a, b, c]) { h.send('requestTrack', { track }); await h.core.waitForIdle(); }
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'qq:1', '最近播放过的 B 仍可被用户显式返回');
    h.send('banTrack', { track: a });
    // 游标固定在原快照上：B 之前只有 A，A 被禁播后没有更早的可播歌曲。
    assert.throws(() => h.send('previous'), { code: 'no_previous' });
    assert.equal(trackId(h.core.snapshot().current.track), 'qq:1');
  } finally { await h.core.waitForIdle(); h.store.close(); }
});

test('previous skips a banned or unavailable track and reports no_previous when every earlier song is blocked', async () => {
  const h = harness();
  try {
    for (const track of [a, b, c]) { h.send('requestTrack', { track }); await h.core.waitForIdle(); }
    h.store.markUnavailable(b, 'media_failed', h.clock.now() + 60_000);
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:1');
  } finally { await h.core.waitForIdle(); h.store.close(); }
  const blocked = harness();
  try {
    for (const track of [a, b, c]) { blocked.send('requestTrack', { track }); await blocked.core.waitForIdle(); }
    blocked.send('banTrack', { track: a });
    blocked.send('banTrack', { track: b });
    assert.throws(() => blocked.send('previous'), { code: 'no_previous' });
    assert.equal(trackId(blocked.core.snapshot().current.track), 'netease:2');
  } finally { await blocked.core.waitForIdle(); blocked.store.close(); }
});

test('previous keeps playback paused when the user was paused', async () => {
  const h = harness();
  try {
    h.send('requestTrack', { track: a });
    await h.core.waitForIdle();
    h.send('requestTrack', { track: b });
    await h.core.waitForIdle();
    h.send('pause');
    await h.core.waitForIdle();
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:1');
    assert.equal(h.core.snapshot().paused, true);
    assert.equal(h.core.snapshot().status, 'paused');
    assert.equal(h.playback.playing, false);
  } finally { await h.core.waitForIdle(); h.store.close(); }
});

test('next walks forward to the latest history before selecting D; point requests re-anchor', async () => {
  const h = harness();
  const d = { provider: 'qq', providerTrackId: '2', title: 'D', durationMs: 150000 };
  try {
    for (const track of [a, b, c]) { h.send('requestTrack', { track }); await h.core.waitForIdle(); }
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'qq:1');
    h.core.setQueue([d]);
    h.send('next');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:2');
    assert.equal(h.core.snapshot().current.selectedBy, 'user');
    assert.equal(h.core.snapshot().navigation.previous, true);
    h.send('next');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'qq:2');
    // 新推荐 D 才重新锚定：上一首回到刚才真正播放过的 C。
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:2');
    // 显式点播 A 重建锚点，不保留原快照里 C 之后的 D。
    h.send('requestTrack', { track: a });
    await h.core.waitForIdle();
    h.send('previous');
    await h.core.waitForIdle();
    assert.equal(trackId(h.core.snapshot().current.track), 'netease:2');
  } finally { await h.core.waitForIdle(); h.store.close(); }
});

test('previous from idle returns the last played song and records a navigation evidence event', async () => {
  const store = new MusicStore();
  const provider = new FakeProvider();
  const playback = new FakePlayback();
  const clock = new FakeClock(new Date('2026-09-27T12:00:00+08:00').getTime());
  const logs = [];
  const core = new MusicCore({ store, provider, playback, clock, onLog: (entry) => logs.push(entry) });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  let id = 0;
  const send = (type, extra = {}) => core.dispatch({ commandId: `prev-${++id}`, type, ...extra });
  try {
    send('requestTrack', { track: a });
    await core.waitForIdle();
    send('requestTrack', { track: b });
    await core.waitForIdle();
    const ended = core.snapshot().current.playInstanceId;
    playback.emit({ type: 'ended', playInstanceId: ended });
    assert.equal(core.snapshot().current, null);
    send('previous');
    await core.waitForIdle();
    assert.equal(trackId(core.snapshot().current.track), 'qq:1');
    const navigation = logs.find((entry) => entry.type === 'navigation');
    assert.equal(navigation.event, 'previous');
    assert.equal(navigation.direction, 'previous');
    assert.equal(navigation.trackKey, 'qq:1');
    assert.equal(store.getPreference('track', 'qq:1'), null, '返回上一首本身不制造成长');
  } finally { await core.waitForIdle(); store.close(); }
});
