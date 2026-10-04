import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLibrary, playbackPresentation, popupPlacement, discoveryPresentation } from '../src/ui/client/presentation.mjs';

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
