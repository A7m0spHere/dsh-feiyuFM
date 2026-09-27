// U2: the control panel's logic.
//
// The panel is pure: a snapshot goes in, a view model and a set of actions come
// out. The semantics under test are MVP section 3 — two independent switches with
// four combinations, mode shortcuts over them, a track bubble that appears and
// fades, and states that are actionable. "上一首" is not a deliverable, and its
// absence is asserted rather than assumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks } from '../src/environment.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakeClock, FakePlayback, FakeProvider } from '../src/fakes.mjs';
import {
  describePanel, describeNotice, describeSwitches, deriveMode, availableActions,
  updateBubble, BUBBLE_VISIBLE_MS, NOT_DELIVERED, SWITCH_COMBINATIONS,
} from '../src/ui/panel.mjs';

const track = { provider: 'netease', providerTrackId: 'p1', title: 'Track', artist: 'Artist', durationMs: 200_000 };

function snapshotWith(settings = {}, extra = {}) {
  return {
    revision: 1,
    settings: { listening: true, humanPlayback: true, discovery: true, discoveryRate: 0.2, strategy: 'normal', ...settings },
    current: extra.current === undefined
      ? { track, playInstanceId: 'i1', selectedBy: 'agent', positionMs: 1000, audible: true }
      : extra.current,
    paused: extra.paused ?? false,
    status: extra.status ?? 'playing',
    queue: [],
    lastError: extra.lastError ?? null,
  };
}

test('the four switch combinations are all named, and the mode is derived, not stored twice', () => {
  const cases = [
    [{ listening: true, humanPlayback: true }, 'on-on', 'audible'],
    [{ listening: true, humanPlayback: false }, 'on-off', 'silent'],
    [{ listening: false, humanPlayback: true }, 'off-on', 'manual-only'],
    [{ listening: false, humanPlayback: false }, 'off-off', 'idle'],
  ];
  for (const [settings, key, name] of cases) {
    const described = describeSwitches(settings);
    assert.equal(described.key, key, 'the pair itself');
    assert.equal(described.name, name, 'and what it means');
    assert.ok(described.label, `${key} needs a human label`);
  }
  assert.equal(Object.keys(SWITCH_COMBINATIONS).length, 4);

  // The shortcut a combination corresponds to comes from the settings, so the
  // panel never keeps a second copy of the mode.
  assert.equal(deriveMode({ listening: true, humanPlayback: true, strategy: 'normal' }), 'normal');
  assert.equal(deriveMode({ listening: true, humanPlayback: true, strategy: 'focus' }), 'focus');
  assert.equal(deriveMode({ listening: true, humanPlayback: false, strategy: 'normal' }), 'silent');
  assert.equal(deriveMode({ listening: false, humanPlayback: false, strategy: 'focus' }), 'off');
  assert.equal(deriveMode({ listening: false, humanPlayback: true, strategy: 'normal' }), 'manual');
});

test('the panel shows the track, the switches and the discovery rate as a person reads them', () => {
  const panel = describePanel({ snapshot: snapshotWith(), bridge: { status: 'connected', revision: 7 } });
  assert.equal(panel.track.title, 'Track');
  assert.equal(panel.track.artist, 'Artist');
  assert.equal(panel.track.isAgentChoice, true, 'an autonomous pick is distinguishable from the user\'s');
  assert.equal(panel.playback.discoveryRate, 0.2);
  assert.equal(panel.playback.discoveryPercent, 20, 'the panel shows a percentage, the core stores a fraction');
  assert.equal(panel.playback.switches.key, 'on-on');
  assert.equal(panel.playback.mode, 'normal');
  assert.equal(panel.connection.status, 'connected');
  assert.equal(panel.connection.revision, 7);
  assert.equal(panel.notice, null, 'nothing to report when all is well');
});

test('a user pick is not presented as the agent\'s choice', () => {
  const panel = describePanel({
    snapshot: snapshotWith({}, { current: { track, playInstanceId: 'i2', selectedBy: 'user', positionMs: 0, audible: false } }),
  });
  assert.equal(panel.track.isAgentChoice, false);
  assert.equal(panel.track.audible, false);
});

test('the track bubble appears on a change and fades on its own schedule', () => {
  const first = updateBubble({ previous: null, snapshot: snapshotWith(), now: 1000 });
  assert.equal(first.changed, true);
  assert.equal(first.bubble.trackKey, 'netease:p1');
  assert.equal(first.bubble.shownAt, 1000);

  // Polling the same track does not restart the bubble.
  const again = updateBubble({ previous: first.bubble, snapshot: snapshotWith(), now: 3000 });
  assert.equal(again.changed, false);
  assert.equal(again.bubble.shownAt, 1000, 'the original appearance time is kept');

  // The panel shows it, then fades, then hides it.
  const visible = describePanel({ snapshot: snapshotWith(), bubble: first.bubble, now: 2000 });
  assert.equal(visible.bubble.visible, true);
  assert.equal(visible.bubble.fading, false);
  const fading = describePanel({ snapshot: snapshotWith(), bubble: first.bubble, now: 1000 + BUBBLE_VISIBLE_MS * 0.8 });
  assert.equal(fading.bubble.fading, true, 'it fades before it disappears');
  const gone = describePanel({ snapshot: snapshotWith(), bubble: first.bubble, now: 1000 + BUBBLE_VISIBLE_MS + 1 });
  assert.equal(gone.bubble, null, 'and then it is gone');

  // A new track starts a fresh bubble even if the old one had not expired.
  const other = updateBubble({
    previous: first.bubble,
    snapshot: snapshotWith({}, { current: { track: { ...track, providerTrackId: 'p2' }, playInstanceId: 'i3', selectedBy: 'agent', positionMs: 0 } }),
    now: 2500,
  });
  assert.equal(other.changed, true);
  assert.equal(other.bubble.trackKey, 'netease:p2');
  assert.equal(other.bubble.shownAt, 2500);
});

test('the panel offers the controls that are delivered, and not the one that is not', () => {
  const actions = availableActions({ snapshot: snapshotWith() });
  const ids = actions.map((action) => action.id);
  for (const required of ['pause', 'next', 'toggle-listening', 'toggle-human-playback', 'toggle-discovery', 'mode-normal', 'mode-focus', 'mode-silent', 'mode-off', 'stop-for-today', 'import']) {
    assert.ok(ids.includes(required), `${required} should be offered`);
  }
  assert.equal(ids.includes('previous-track'), false, '"上一首" is not a deliverable');
  assert.deepEqual([...NOT_DELIVERED], ['previous-track']);

  // Every action that changes something carries the exact core command.
  for (const action of actions.filter((row) => row.command)) {
    assert.equal(typeof action.command.type, 'string', `${action.id} needs a command type`);
  }
  // Pause becomes resume when already paused.
  const paused = availableActions({ snapshot: snapshotWith({}, { paused: true }) }).find((row) => row.id === 'resume');
  assert.deepEqual(paused.command, { type: 'resume' });
  // Nothing to switch to when there is no track.
  const empty = availableActions({ snapshot: snapshotWith({}, { current: null }) });
  assert.equal(empty.find((row) => row.id === 'next').enabled, false);
});

test('a signed-out platform offers sign-in instead of a play button that cannot work', () => {
  const platform = { status: 'login_required', reason: '需要登录' };
  const actions = availableActions({ snapshot: snapshotWith(), platform });
  const ids = actions.map((action) => action.id);
  assert.ok(ids.includes('sign-in'));
  assert.equal(ids.includes('pause'), false, 'no playback control is offered while signed out');
  assert.equal(ids.includes('next'), false);
  assert.equal(ids.includes('import'), false, 'nor an import that would fail');

  // The switches remain available: they are local settings, not platform calls.
  assert.ok(ids.includes('toggle-listening'));

  const notice = describeNotice({ snapshot: snapshotWith(), platform });
  assert.equal(notice.kind, 'login-required');
  assert.equal(notice.actionId, 'sign-in', 'the notice says what to do about it');
});

test('each state the panel can show is actionable, and offline is not confused with signed out', () => {
  // A UI that cannot reach the core: music continues, and the wording says so.
  const disconnected = describePanel({
    snapshot: snapshotWith(), bridge: { status: 'failed', revision: 3 },
  });
  assert.equal(disconnected.notice.kind, 'ui-disconnected');
  assert.equal(disconnected.notice.actionId, 'retry-connection');
  assert.equal(disconnected.connection.musicUnaffected, true);
  assert.match(disconnected.connection.label, /音乐继续在后台运行/);

  // Before the first snapshot.
  const loading = describePanel({});
  assert.equal(loading.notice.kind, 'loading');
  assert.equal(loading.track, null);

  // A platform that is expired, as opposed to never signed in.
  const expired = describeNotice({ snapshot: snapshotWith(), platform: { status: 'expired' } });
  assert.equal(expired.kind, 'login-expired');
  assert.equal(expired.actionId, 'sign-in');

  // A platform error is its own case, with its own retry.
  const platformError = describeNotice({ snapshot: snapshotWith(), platform: { status: 'error', reason: '平台挂了' } });
  assert.equal(platformError.kind, 'platform-error');
  assert.equal(platformError.detail, '平台挂了');
});

test('core failures are explained with the real remedy, or none rather than a made-up one', () => {
  const cases = [
    ['login_required', 'sign-in'],
    ['media_failed', 'retry-track'],
    ['no_candidates', 'import'],
    ['media_unavailable', null],
    ['constraint_conflict', null],
  ];
  for (const [code, actionId] of cases) {
    const notice = describeNotice({ snapshot: snapshotWith({}, { status: 'error', lastError: { code, message: 'x', retryable: false } }) });
    assert.equal(notice.kind, code);
    assert.ok(notice.title, `${code} needs a human title`);
    assert.equal(notice.actionId, actionId, `${code} should offer ${actionId}`);
  }
  // An unknown code still says something rather than showing a bare code.
  const unknown = describeNotice({ snapshot: snapshotWith({}, { lastError: { code: 'brand_new', message: 'something odd' } }) });
  assert.equal(unknown.title, '播放出现问题');
  assert.equal(unknown.detail, 'something odd');
  assert.equal(unknown.retryable, false);
});

test('an import that fell back says which source it actually used', () => {
  const degraded = describeNotice({
    snapshot: snapshotWith(),
    platform: { status: 'authorized', capabilities: { seed: { status: 'degraded', source: 'liked', reason: '近期播放不可用，改用 liked' } } },
  });
  assert.equal(degraded.kind, 'seed-degraded');
  assert.match(degraded.title, /我喜欢/, 'the source is named in the user\'s language');
  assert.equal(degraded.detail, '近期播放不可用，改用 liked');

  const none = describeNotice({
    snapshot: snapshotWith(),
    platform: { status: 'authorized', capabilities: { seed: { status: 'unavailable', reason: '三次尝试都失败了' } } },
  });
  assert.equal(none.kind, 'seed-unavailable');
  assert.equal(none.actionId, 'import', 'the user can try again');
});

test('the panel reflects what the core actually reports, not a parallel model', async () => {
  // Driving a real core and feeding its snapshot through keeps this honest: if
  // the core's shape changes, this fails instead of drifting quietly.
  const store = new MusicStore();
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const playback = new FakePlayback();
  const core = new MusicCore({ store, provider, playback, clock: new FakeClock(1) });
  playback.onEvent((event) => core.onPlaybackEvent(event));
  try {
    core.dispatch({ commandId: 'c1', type: 'requestTrack', track });
    await core.waitForIdle();
    const panel = describePanel({ snapshot: core.snapshot() });
    assert.equal(panel.track.title, 'Track');
    assert.equal(panel.track.provider, 'netease');
    assert.equal(panel.playback.switches.key, 'on-on');
    assert.equal(panel.playback.mode, 'normal');
    assert.equal(panel.playback.discoveryPercent, 20);
    assert.equal(panel.notice, null);

    // Silent: autonomous listening with no sound (MVP: "你自己听，我不想听").
    core.dispatch({ commandId: 'c2', type: 'setHumanPlayback', value: false });
    const silent = describePanel({ snapshot: core.snapshot() });
    assert.equal(silent.playback.switches.key, 'on-off');
    assert.equal(silent.playback.switches.label, SWITCH_COMBINATIONS['on-off'].label);
    assert.equal(silent.playback.mode, 'silent');

    // Off closes both switches, and the panel says so.
    core.dispatch({ commandId: 'c3', type: 'setMode', value: 'off' });
    const off = describePanel({ snapshot: core.snapshot() });
    assert.equal(off.playback.switches.key, 'off-off');
    assert.equal(off.playback.mode, 'off');
    assert.equal(off.playback.paused, true);
    const resume = availableActions({ snapshot: core.snapshot() }).find((action) => action.id === 'resume');
    assert.ok(resume, 'the panel offers a way back');
  } finally {
    store.close();
  }
});

test('the panel never invents an error out of a healthy snapshot', () => {
  for (const status of ['idle', 'playing', 'paused', 'resolving']) {
    const panel = describePanel({ snapshot: snapshotWith({}, { status }) });
    // Only a real error or a platform problem produces a notice.
    assert.equal(panel.notice, null, `${status} is not a problem`);
  }
});