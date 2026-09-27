// U1: the UI bridge and window position memory.
//
// The bridge rules come from ARCHITECTURE: a reconnect takes a snapshot before
// consuming newer revisions, a UI failure affects display only, and the protocol
// carries a version, a disconnect snapshot and an exit notification. The window
// rules come from MVP section 5: position memory, and a return to a visible area
// after a monitor is disconnected or the scale changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import {
  createUiBridge, createMemoryTransport, UI_BRIDGE_PROTOCOL, BRIDGE_STATUSES,
} from '../src/ui/bridge.mjs';
import {
  restoreWindowState, saveWindowState, forgetWindowState, visibleArea, placeInside, WINDOW_STATE_KEY,
} from '../src/ui/window-state.mjs';

const display = (x, y, width, height) => ({ x, y, width, height });
const PRIMARY = display(0, 0, 1920, 1080);
const SECONDARY = display(1920, 0, 1280, 1024);

function bridgeHarness(options = {}) {
  const states = [];
  const statuses = [];
  const transport = createMemoryTransport(options.transportOptions ?? {});
  const bridge = createUiBridge({
    transport,
    onState: (event) => states.push(event),
    onStatus: (event) => statuses.push(event),
    ...options,
  });
  return { bridge, transport, states, statuses, lastStatus: () => statuses.at(-1)?.status };
}

test('the bridge refuses a protocol it does not speak instead of guessing', async () => {
  const { bridge, transport, lastStatus } = bridgeHarness();
  await bridge.connect();
  assert.equal(lastStatus(), 'connecting', 'a snapshot is requested before anything is accepted');

  const outcome = bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL + 1 });
  assert.equal(outcome.compatible, false);
  assert.equal(lastStatus(), 'incompatible');
  assert.match(bridge.status === 'incompatible' ? 'incompatible' : '', /incompatible/);

  // A matching protocol is accepted and the panel is live.
  const other = bridgeHarness();
  await other.bridge.connect();
  assert.equal(other.bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL }).accepted, true);
  assert.equal(other.bridge.status, 'connected');
  assert.equal(transport.closed, false);
});

test('an older revision is dropped rather than replayed', () => {
  const { bridge, states } = bridgeHarness();
  bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL });

  assert.equal(bridge.handleMessage({ type: 'state', revision: 5, snapshot: { status: 'playing' } }).accepted, true);
  assert.equal(bridge.revision, 5);
  assert.equal(bridge.snapshot.status, 'playing');

  // The replay a reconnect can cause: an older revision arriving late.
  const stale = bridge.handleMessage({ type: 'state', revision: 4, snapshot: { status: 'idle' } });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale revision');
  assert.equal(bridge.snapshot.status, 'playing', 'the displayed state is unchanged');
  assert.equal(bridge.counters.staleStates, 1);

  // The same revision twice is also not an update.
  assert.equal(bridge.handleMessage({ type: 'state', revision: 5, snapshot: { status: 'paused' } }).accepted, false);
  assert.equal(bridge.snapshot.status, 'playing');

  // A newer one is accepted.
  assert.equal(bridge.handleMessage({ type: 'state', revision: 6, snapshot: { status: 'paused' } }).accepted, true);
  assert.equal(bridge.snapshot.status, 'paused');
  assert.equal(states.length, 2, 'only real updates notify the panel');
});

test('a disconnect asks for a snapshot again, and gives up after a bounded number of tries', async () => {
  const { bridge, transport } = bridgeHarness({ reconnect: { maxAttempts: 3, backoff: () => 10 } });
  await bridge.connect();
  bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL });
  transport.sent.length = 0;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const outcome = await bridge.handleDisconnect('socket closed');
    assert.equal(outcome.reconnect, true);
    assert.equal(outcome.attempt, attempt);
    assert.equal(bridge.status, 'reconnecting');
  }
  const exhausted = await bridge.handleDisconnect('socket closed');
  assert.equal(exhausted.reconnect, false);
  assert.match(exhausted.reason, /attempts exhausted/);
  assert.equal(bridge.status, 'failed', 'the panel reports failure rather than retrying forever');

  // Reconnecting successfully resets the attempt count and re-asks for state.
  await bridge.connect();
  bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL });
  assert.equal(bridge.attempts, 0);
  assert.equal(bridge.status, 'connected');
});

test('a pending command is answered with a refusal when the connection drops', async () => {
  const { bridge, transport } = bridgeHarness();
  await bridge.connect();
  bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL });
  const pending = bridge.command({ type: 'pause', commandId: 'c1' });
  assert.equal(pending instanceof Promise, true);

  await bridge.handleDisconnect('socket closed');
  const answer = await pending;
  assert.equal(answer.type, 'error');
  assert.equal(answer.error.code, 'ui_disconnected', 'the panel is told, not left hanging');
  assert.equal(transport.sent.some((line) => line.includes('pause')), true);
});

test('an exit notification stops the panel from reconnecting', async () => {
  const { bridge, transport } = bridgeHarness();
  await bridge.connect();
  bridge.handleMessage({ type: 'hello', protocol: UI_BRIDGE_PROTOCOL });
  assert.equal(bridge.handleMessage({ type: 'exiting' }).kind, 'exiting');
  assert.equal(bridge.status, 'closed');

  const outcome = await bridge.handleDisconnect('transport closed');
  assert.equal(outcome.reconnect, false, 'the core said goodbye, so reconnecting would be wrong');
  assert.match(outcome.reason, /closed on purpose/);
  assert.equal(transport.closed, false);
});

test('a UI failure only affects the display, never the music', async () => {
  // The core keeps its own state; the bridge has no way to change it.
  const store = new MusicStore();
  const { bridge, transport } = bridgeHarness();
  try {
    store.setSetting('unrelated', { keep: true });
    const before = JSON.stringify(store.getCoreState());

    transport.failNextConnect(new Error('the panel could not reach the core'));
    const result = await bridge.connect();
    assert.equal(result.connected, false);
    assert.equal(bridge.status, 'failed');
    assert.match(result.reason, /could not reach the core/);

    // Nothing about the core's stored state changed, and no command was sent.
    assert.equal(JSON.stringify(store.getCoreState()), before);
    assert.deepEqual(store.getSetting('unrelated'), { keep: true });
    assert.equal(transport.sent.length, 0);
  } finally {
    store.close();
  }
});

test('a closed transport is reported instead of throwing into the panel', async () => {
  const { bridge, transport } = bridgeHarness();
  await bridge.connect();
  transport.close();
  const outcome = bridge.send({ type: 'snapshot' });
  assert.equal(outcome, null, 'send returns nothing rather than throwing');
  assert.equal(bridge.status, 'failed');
  assert.match(String(bridge.counters.refused + bridge.counters.disconnects), /\d/);
});

test('unknown and malformed messages are ignored without breaking the bridge', () => {
  const { bridge } = bridgeHarness();
  assert.equal(bridge.handleMessage('not json').ignored, true);
  assert.equal(bridge.handleMessage(null).ignored, true);
  assert.equal(bridge.handleMessage({ type: 'mystery' }).ignored, true);
  assert.equal(bridge.revision, -1, 'nothing was accepted');
  assert.ok(BRIDGE_STATUSES.includes(bridge.status));
});

test('the bridge understands the host\'s real message shapes, not an imagined protocol', async () => {
  // Captured from a live createCoreHost run: the greeting is `ready`, and a
  // state push carries the revision inside the snapshot rather than on the
  // envelope. Feeding those exact shapes in is what keeps this honest.
  const { bridge, states } = bridgeHarness();
  await bridge.connect();

  const greeting = { v: 1, type: 'ready', protocol: UI_BRIDGE_PROTOCOL, snapshot: { revision: 4, status: 'idle' } };
  const accepted = bridge.handleMessage(greeting);
  assert.equal(accepted.accepted, true, 'the real greeting is accepted');
  assert.equal(bridge.status, 'connected');
  assert.equal(bridge.revision, 4, 'the greeting snapshot is used, so the panel can render at once');

  const push = { v: 1, type: 'state', reason: 'changed', snapshot: { revision: 5, status: 'playing' } };
  assert.equal(bridge.handleMessage(push).accepted, true);
  assert.equal(bridge.revision, 5);
  assert.equal(bridge.snapshot.status, 'playing');
  assert.equal(states.at(-1).reason, 'changed', 'the host\'s reason is passed through');

  // The revision rule still holds when it arrives only inside the snapshot.
  assert.equal(bridge.handleMessage({ v: 1, type: 'state', reason: 'changed', snapshot: { revision: 5, status: 'idle' } }).accepted, false);
  assert.equal(bridge.snapshot.status, 'playing');
  assert.equal(bridge.counters.staleStates, 1);

  // A host that speaks a different version is refused, whichever field says so.
  const other = bridgeHarness();
  await other.bridge.connect();
  assert.equal(other.bridge.handleMessage({ v: 9, type: 'ready', protocol: 9, snapshot: {} }).compatible, false);
  assert.equal(other.bridge.status, 'incompatible');
  assert.equal(other.bridge.handleMessage({ v: 9, type: 'ready', snapshot: {} }).compatible, false,
    'a bare version field is enough to refuse');
});

test('the window remembers where it was', () => {
  const store = new MusicStore();
  try {
    assert.deepEqual(restoreWindowState({ store, displays: [PRIMARY] }).source, 'default');
    saveWindowState(store, { x: 100, y: 200, width: 220, height: 260 }, { now: 1234 });
    const restored = restoreWindowState({ store, displays: [PRIMARY] });
    assert.equal(restored.source, 'remembered');
    assert.deepEqual(
      { x: restored.rect.x, y: restored.rect.y, width: restored.rect.width, height: restored.rect.height },
      { x: 100, y: 200, width: 220, height: 260 },
    );
    assert.equal(restored.reason, null);
    assert.equal(store.getSetting(WINDOW_STATE_KEY).savedAt, 1234);

    assert.equal(forgetWindowState(store), true);
    assert.equal(restoreWindowState({ store, displays: [PRIMARY] }).source, 'default');
  } finally {
    store.close();
  }
});

test('a position on a disconnected monitor comes back into view', () => {
  const store = new MusicStore();
  try {
    // Saved while a second monitor existed.
    saveWindowState(store, { x: 2100, y: 300, width: 220, height: 260 });
    assert.ok(visibleArea(store.getSetting(WINDOW_STATE_KEY), [PRIMARY, SECONDARY]) > 0, 'it was visible then');

    // The monitor is gone.
    const restored = restoreWindowState({ store, displays: [PRIMARY] });
    assert.equal(restored.source, 'recovered');
    assert.match(restored.reason, /no longer on any display/);
    assert.ok(visibleArea(restored.rect, [PRIMARY]) >= 48 * 48, 'the window is reachable again');
    assert.deepEqual(restored.remembered, { x: 2100, y: 300, width: 220, height: 260, savedAt: restored.remembered.savedAt },
      'what the user last chose is still reported, not silently discarded');
  } finally {
    store.close();
  }
});

test('a display scale change clamps a size that no longer fits', () => {
  const store = new MusicStore();
  try {
    saveWindowState(store, { x: 10, y: 10, width: 1600, height: 900 }, { scaleFactor: 1 });
    const restored = restoreWindowState({ store, displays: [PRIMARY], scaleFactor: 1.5 });
    assert.equal(restored.source, 'resized');
    assert.match(restored.reason, /scale changed/);
    assert.ok(restored.rect.width <= PRIMARY.width && restored.rect.height <= PRIMARY.height);

    // A size larger than the display is clamped even without a scale change.
    saveWindowState(store, { x: 0, y: 0, width: 4000, height: 3000 });
    const clamped = restoreWindowState({ store, displays: [PRIMARY] });
    assert.equal(clamped.source, 'resized');
    assert.equal(clamped.rect.width, PRIMARY.width);
  } finally {
    store.close();
  }
});

test('a window dragged to the edge is still treated as visible and kept', () => {
  const store = new MusicStore();
  try {
    // Mostly off the left edge but a usable corner remains on screen.
    saveWindowState(store, { x: -160, y: 40, width: 220, height: 260 });
    const restored = restoreWindowState({ store, displays: [PRIMARY] });
    assert.equal(restored.source, 'remembered', 'a partly visible window is the user\'s choice');
    assert.equal(restored.rect.x, -160);
  } finally {
    store.close();
  }
});

test('without display information the remembered position is returned untouched', () => {
  const store = new MusicStore();
  try {
    saveWindowState(store, { x: 500, y: 500, width: 200, height: 200 });
    const restored = restoreWindowState({ store, displays: [] });
    assert.equal(restored.source, 'remembered');
    assert.match(restored.reason, /no display information/);
    assert.deepEqual({ x: restored.rect.x, y: restored.rect.y }, { x: 500, y: 500 });
  } finally {
    store.close();
  }
});

test('placement keeps a window inside a display with a margin', () => {
  const placed = placeInside({ x: -500, y: -500, width: 200, height: 200 }, [PRIMARY]);
  assert.ok(placed.x >= PRIMARY.x && placed.y >= PRIMARY.y);
  assert.ok(placed.x + placed.width <= PRIMARY.x + PRIMARY.width);
  const oversized = placeInside({ x: 0, y: 0, width: 5000, height: 5000 }, [PRIMARY]);
  assert.ok(oversized.width <= PRIMARY.width);
  assert.equal(placeInside({ x: 1, y: 2, width: 3, height: 4 }, []).x, 1, 'no displays means no opinion');
});

test('an invalid rectangle is refused rather than stored', () => {
  const store = new MusicStore();
  try {
    assert.throws(() => saveWindowState(store, { x: 1, y: 2 }), /rectangle/);
    assert.throws(() => saveWindowState(store, null), /rectangle/);
    assert.equal(store.getSetting(WINDOW_STATE_KEY, null), null);
  } finally {
    store.close();
  }
});