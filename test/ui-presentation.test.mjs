import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLibrary, playbackPresentation, playbackControls, popupPlacement, discoveryPresentation, playbackNotice } from '../src/ui/client/presentation.mjs';

test('media open and download failures have specific playback notices', () => {
  assert.match(playbackNotice({ lastError: { code: 'media_failed' } }), /本机播放器/);
  assert.match(playbackNotice({ lastError: { code: 'media_download_failed' } }), /音频下载/);
  assert.equal(playbackNotice({ lastError: null }), null);
});
import {interpolatedPosition,recommendationActionState,recommendationFeedback} from '../src/ui/client/presentation.mjs';

test('a model gate expires at the server deadline while constraints remain separate from actual failures',()=>{
 const gate={reason:'summary_cooldown',retryAt:901000};
 assert.equal(recommendationActionState(gate,62000).label,'稍后再试','legacy hosts never show a countdown');
 assert.equal(recommendationActionState({reason:null,retryAt:null},62000).disabled,false,'manual picking has no waiting period');
 assert.equal(recommendationActionState(gate,900999).disabled,true);
 assert.equal(recommendationActionState(gate,901000).disabled,false);
 assert.equal(recommendationFeedback({code:'summary_cooldown'}).expected,true);
 assert.equal(recommendationFeedback({code:'provider_failure',message:'服务暂不可用'}).expected,false);
 assert.equal(recommendationFeedback({code:'provider_failure',message:'服务暂不可用'}).message,'服务暂不可用');
});

test('playback preparation, mute, pause and disconnection have distinct visual states', () => {
  const snapshot = { status: 'playing', paused: false, settings: { humanPlayback: true } };
  assert.equal(playbackPresentation(snapshot, true).label, '正在播放');
  assert.equal(playbackPresentation({ ...snapshot, settings: { humanPlayback: false } }, true).label, '静音播放');
  assert.equal(playbackPresentation({ ...snapshot, paused: true }, true).active, false);
  assert.equal(playbackPresentation({ ...snapshot, status: 'resolving' }, true).art, 'whale-dj');
  assert.equal(playbackPresentation(snapshot, false).active, false);
});

test('discovery display distinguishes target settings from available candidates and honest fallback', () => {
  const snapshot = { settings: { discovery: true, discoveryRate: 1 }, discovery: { state: 'empty', count: 0 } };
  assert.match(discoveryPresentation(snapshot), /先播常听的歌曲/);
  assert.match(discoveryPresentation({ ...snapshot, discovery: { state: 'ready', count: 34, sources: ['netease_daily'] } }), /34 首新歌/);
  assert.match(discoveryPresentation({ ...snapshot, discovery: { state: 'ready', count: 30, picked: 12, filtering: true } }), /正在试听挑选/);
  assert.match(discoveryPresentation({ ...snapshot, discovery: { state: 'ready', count: 30, picked: 12 } }), /挑了 12 首合口味/);
  assert.match(discoveryPresentation({ ...snapshot, discovery: { state: 'refreshing', refreshing: true, count: 3 } }), /正在找新歌/);
  assert.match(discoveryPresentation({ ...snapshot, discovery: { state: 'login_required', reason: 'login-required', count: 0 } }), /需要先登录网易云/);
  assert.match(discoveryPresentation({ ...snapshot, settings: { discovery: true, discoveryRate: 0 } }), /探索已关闭/);
});

test('library search handles title, artist and platform id without changing input order', () => {
  const tracks = [{ providerTrackId: '42', title: 'Rain', artist: '夜航' }, { providerTrackId: '43', title: 'Morning', artist: '沿途' }];
  assert.deepEqual(filterLibrary(tracks, ' RAIN '), [tracks[0]]);
  assert.deepEqual(filterLibrary(tracks, '夜航'), [tracks[0]]);
  assert.deepEqual(filterLibrary(tracks, '43'), [tracks[1]]);
  assert.deepEqual(filterLibrary(tracks, 'nothing'), []);
  assert.deepEqual(filterLibrary(tracks, ''), tracks);
  assert.deepEqual(filterLibrary([{ providerTrackId: '44' }], 'undefined'), []);
});

test('popovers flip below a top-docked bar and constrain their height to available space', () => {
  const frame = { top: 60, bottom: 760 };
  assert.deepEqual(popupPlacement(frame, { top: 64, bottom: 138 }, 440), { side: 'below', maxHeight: 440 });
  assert.deepEqual(popupPlacement(frame, { top: 670, bottom: 744 }, 440), { side: 'above', maxHeight: 440 });
  assert.deepEqual(popupPlacement({ top: 0, bottom: 200 }, { top: 60, bottom: 135 }, 440), { side: 'below', maxHeight: 53 });
});

test('progress interpolates from the last server anchor while playing and never overruns the track', () => {
  const anchor = { id: 'inst-1', at: 1_000_000, ms: 40_000 };
  const base = { anchor, playInstanceId: 'inst-1', positionMs: 40_000, durationMs: 200_000, now: 1_003_000, active: true };
  assert.equal(interpolatedPosition(base), 43_000, '播放中按本地时钟推进，界面不再每 2.2 秒跳格');
  assert.equal(interpolatedPosition({ ...base, active: false }), 40_000, '暂停时回到服务端锚点，不虚增进度');
  assert.equal(interpolatedPosition({ ...base, playInstanceId: 'inst-2' }), 40_000, '切歌后不沿用上一首的锚点');
  assert.equal(interpolatedPosition({ ...base, now: 1_900_000 }), 200_000, '插值不会超过曲目时长');
  assert.equal(interpolatedPosition({ ...base, anchor: null }), 40_000, '没有锚点时返回服务端原值');
  assert.equal(interpolatedPosition({ ...base, durationMs: null, now: 1_005_000 }), 45_000, '时长未知时按本地时钟推进且不设上限');
});

test('previous control is enabled only when Core reports earlier playable history', () => {
  const base = {
    connected: true, busy: false, transportPending: null,
    snapshot: { paused: false, status: 'playing', current: { playInstanceId: 'i2', track: { title: 'B' } }, navigation: { previous: true } },
  };
  assert.equal(playbackControls(base).previousDisabled, false);
  assert.equal(playbackControls({ ...base, snapshot: { ...base.snapshot, navigation: { previous: false } } }).previousDisabled, true,
    '没有更早的可播歌曲时禁用，而不是让用户点了才报错');
  assert.equal(playbackControls({ ...base, snapshot: { ...base.snapshot, navigation: undefined } }).previousDisabled, true,
    '旧版 Core 没有导航信息时保守禁用');
  assert.equal(playbackControls({ ...base, connected: false }).previousDisabled, true);
  assert.equal(playbackControls({ ...base, busy: true }).previousDisabled, true);
  const pending = playbackControls({ ...base, transportPending: 'previous' });
  assert.equal(pending.previousDisabled, true);
  assert.equal(pending.previousLabel, '返回中…');
  assert.equal(pending.message, '正在返回上一首…');
  assert.equal(playbackControls(base).previousLabel, '上一首');
  assert.equal(playbackControls({ ...base, snapshot: { ...base.snapshot, navigation: { previous: true } }, transportPending: 'next' }).message, '正在切换下一首…',
    '上一首与下一首共用同一套 pending 文案');
});
