// DSH adapter (I1): the bridge to the core process and the registrations it
// puts on a Harness profile context. The fake ctx mirrors the API verified
// against the installed Harness in P0-01 (apply/inject, ctx.effect, ctx.on,
// ctx.tools.register, ctx.commands.register).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreBridge, registerAdapter, translateSessionEvent, TOOL_NAMES, COMMAND_NAMES } from '../src/dsh-adapter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const track = { provider: 'netease', providerTrackId: 'a1', title: 'Adapter track', durationMs: 600 };

const spawnFakeCore = ({ dbPath = ':memory:' } = {}) => spawn(
  process.execPath,
  [join(root, 'bin', 'fishfm-core.mjs'), '--db', dbPath, '--playback', 'fake', '--provider', 'fake'],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);

/** The product path: no platform adapter installed yet. */
const spawnRealCore = () => spawn(
  process.execPath,
  [join(root, 'bin', 'fishfm-core.mjs'), '--playback', 'fake', '--provider', 'real'],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);

function fakeHarnessContext() {
  const registered = { tools: new Map(), commands: new Map(), events: new Map(), effects: [] };
  let disposed = false;
  const ctx = {
    // Mirrors cordis: services are entered through inject, and reading a
    // non-injected service property throws.
    inject(names, callback) {
      callback(ctx);
      return () => {};
    },
    effect(fn) {
      const dispose = fn();
      registered.effects.push(dispose);
      return () => { disposed = true; return dispose?.(); };
    },
    on(name, handler) {
      registered.events.set(name, handler);
      return () => registered.events.delete(name);
    },
    tools: {
      register(definition) {
        // The real registry rejects malformed ids and union type arrays (P0-01).
        assert.match(definition.name, /^[a-z][a-z0-9_]*$/, 'tool names must be lowercase identifiers');
        assert.equal(typeof definition.description, 'string');
        assert.ok(definition.output?.schema, 'output.schema is mandatory');
        for (const [key, value] of Object.entries(definition.output.schema.properties ?? {})) {
          assert.equal(typeof value.type, 'string', `${key} must declare a single type string`);
        }
        registered.tools.set(definition.name, definition);
        return () => registered.tools.delete(definition.name);
      },
    },
    commands: {
      register(definition) {
        assert.match(definition.name, /^[a-z][a-z0-9-]*$/, 'command names must be lowercase without a slash');
        registered.commands.set(definition.name, definition);
        return () => registered.commands.delete(definition.name);
      },
    },
    get disposed() { return disposed; },
  };
  return { ctx, registered };
}

test('translates only the allowlisted session events', () => {
  assert.equal(translateSessionEvent({ type: 'turn/end' }).kind, 'turn_end');
  assert.equal(translateSessionEvent({ type: 'turn/end' }).allowsAutonomy, true);
  assert.equal(translateSessionEvent({ type: 'turn/start' }).kind, 'session_start');
  assert.equal(translateSessionEvent({ type: 'turn/start' }).allowsAutonomy, false);
  assert.equal(translateSessionEvent({ type: 'tool/call' }).kind, 'activity');
  assert.equal(translateSessionEvent({ type: 'idle' }), null, 'DSH has no idle event; do not guess');
  assert.equal(translateSessionEvent({ type: 'task_phase_change' }), null);
  assert.equal(translateSessionEvent({ type: 'anything/else' }), null);
  assert.equal(translateSessionEvent({}), null);
});

test('the bridge drives a real core process', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnFakeCore() });
  try {
    await bridge.start();
    assert.ok(bridge.snapshot, 'the greeting must carry a snapshot');

    const snapshot = await bridge.setQueue([track]);
    assert.equal(snapshot.queue.length, 1);

    const paused = await bridge.command({ type: 'next' });
    assert.equal(paused.snapshot.current.track.providerTrackId, 'a1');
    assert.equal(paused.snapshot.paused, true, 'next while paused keeps the pause');

    await assert.rejects(() => bridge.command({ type: 'next' }), /no_candidates|queue/i);
  } finally {
    await bridge.stop();
  }
});

test('the bridge reports a core that never starts instead of hanging', async () => {
  const bridge = new CoreBridge({
    spawnCore: () => spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: ['pipe', 'pipe', 'pipe'] }),
    requestTimeoutMs: 3000,
  });
  await assert.rejects(() => bridge.start(), /exited during startup|did not report ready/);
  await bridge.stop();
});

test('the product path reports a missing platform adapter instead of inventing a track', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnRealCore() });
  await bridge.start();
  try {
    // An empty environment means there is nothing to select: the attempt is
    // reported to the user instead of pretending the command succeeded.
    await assert.rejects(bridge.command({ type: 'chooseSelf' }), (error) => error.code === 'no_candidates');

    // Fill the environment the way a real import will, then let the agent pick.
    await bridge.request({
      type: 'import',
      provider: 'netease',
      source: 'recent',
      requested: 1,
      tracks: [track],
    });
    const selected = await bridge.command({ type: 'chooseSelf' });
    assert.equal(selected.snapshot.status, 'resolving', 'selection acknowledgement is not playback success');
    const resolved = await bridge.request({ type: 'wait' });
    // Selection works; resolving to something playable is what must fail while
    // no platform adapter exists, and it must fail with the real reason.
    assert.equal(resolved.snapshot.status, 'error');
    assert.equal(resolved.snapshot.lastError.code, 'provider_unavailable');
    assert.equal(resolved.snapshot.lastSelection.trackKey, 'netease:a1');

    const account = await bridge.request({ type: 'account', provider: 'netease' });
    assert.equal(account.account.status, 'unavailable');
    assert.ok(account.capabilities.seed.reason, 'the missing capability must explain itself');
  } finally {
    await bridge.stop();
  }
});

test('a session identity is read from whichever shape the host provides', async () => {
  const { sessionIdOf } = await import('../src/dsh-adapter.mjs');
  // The real shape was not recorded, so several plausible ones are accepted and
  // an unknown object yields null rather than an invented id.
  assert.equal(sessionIdOf({ id: 'a' }), 'a');
  assert.equal(sessionIdOf({ sessionId: 'b' }), 'b');
  assert.equal(sessionIdOf({ key: 'c' }), 'c');
  assert.equal(sessionIdOf({ id: () => 'd' }), 'd');
  assert.equal(sessionIdOf({ meta: { sessionId: 'e' } }), 'e');
  assert.equal(sessionIdOf({ info: { id: 'f' } }), 'f');
  assert.equal(sessionIdOf({ id: '' }), null, 'an empty id is not an identity');
  assert.equal(sessionIdOf({}), null);
  assert.equal(sessionIdOf(null), null);
  assert.equal(sessionIdOf('a-string'), null, 'a bare string is not a session object');
  // A throwing getter must not take the event down with it.
  assert.equal(sessionIdOf({ id: () => { throw new Error('nope'); }, sessionId: 'g' }), 'g');
});

test('registering the adapter exposes tools and commands, and unload removes everything', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnFakeCore() });
  await bridge.start();
  const { ctx, registered } = fakeHarnessContext();
  const unregister = registerAdapter(ctx, { bridge });
  try {
    assert.deepEqual([...registered.tools.keys()].sort(), Object.values(TOOL_NAMES).sort());
    assert.deepEqual([...registered.commands.keys()].sort(), [...COMMAND_NAMES].sort());

    // A real tool call goes all the way to the core process and back.
    const status = await registered.tools.get(TOOL_NAMES.status).execute({}, { signal: new AbortController().signal });
    assert.equal(status.status, 'idle');
    assert.equal(status.paused, true, 'a fresh core starts paused');
    assert.equal(status.queueLength, 0);
    assert.equal(status.track, '');

    const control = await registered.tools.get(TOOL_NAMES.control).execute({ action: 'stop_for_today' }, {});
    assert.equal(control.accepted, true);
    assert.equal(control.paused, true);

    // With a provider installed, point play must succeed through the tool surface.
    const request = await registered.tools.get(TOOL_NAMES.request).execute(
      { provider: 'netease', providerTrackId: 'a1' }, {},
    );
    assert.equal(request.accepted, true);
    assert.equal(request.error, '');
    assert.equal(request.status, 'resolving', 'the tool reports acceptance while media is prepared');
    assert.equal((await bridge.request({ type: 'wait' })).snapshot.status, 'playing');

    // A user ban is a constraint, not a suggestion: the conflict must surface.
    await bridge.command({ type: 'banTrack', track: { provider: 'netease', providerTrackId: 'a1' } });
    const banned = await registered.tools.get(TOOL_NAMES.request).execute(
      { provider: 'netease', providerTrackId: 'a1' }, {},
    );
    assert.equal(banned.accepted, false);
    assert.equal(banned.error, 'constraint_conflict');

    const command = await registered.commands.get('fishfm').handler();
    assert.equal(command.kind, 'success');

    const failing = await registered.commands.get('fishfm-next').handler();
    assert.equal(failing.kind, 'error', 'an empty queue must be reported, not faked');

    unregister();
    assert.equal(registered.tools.size, 0, 'unload must remove every tool');
    assert.equal(registered.commands.size, 0, 'unload must remove every command');
    assert.equal(registered.events.size, 0, 'unload must remove the event listener');
  } finally {
    unregister();
    await bridge.stop();
  }
});

test('session events reach the core without blocking the host, and paused state is respected', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnFakeCore() });
  const states = [];
  await bridge.start();
  const { ctx, registered } = fakeHarnessContext();
  try {
    bridge.onState((snapshot) => states.push(snapshot));
    registerAdapter(ctx, { bridge });
    const listener = registered.events.get('session/event');
    assert.ok(listener, 'the adapter must observe session/event');

    await bridge.setQueue([track]);
    // turn/end arrives in the real envelope shape; the payload lives under data.
    listener({ id: 's1' }, { type: 'turn/end', seq: 12, time: 1, data: { turn: 1, reason: { kind: 'completed' } } });
    await delay(200);
    assert.equal(bridge.snapshot.current, null, 'a paused core must not start music from an automatic event');

    listener({ id: 's1' }, { type: 'idle', seq: 13, time: 2, data: {} });
    assert.equal(bridge.pending.size, 0, 'unknown events must not queue work');
  } finally {
    await bridge.stop();
  }
});

test('DSH tool cancellation stops read-only calls and blocks commands before dispatch', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnFakeCore() });
  await bridge.start();
  const { ctx, registered } = fakeHarnessContext();
  const unregister = registerAdapter(ctx, { bridge });
  try {
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));

    await assert.rejects(
      () => registered.tools.get(TOOL_NAMES.status).execute({}, { signal: controller.signal }),
      (error) => error.name === 'AbortError' && error.code === 'cancelled',
    );

    const control = await registered.tools.get(TOOL_NAMES.control).execute(
      { action: 'pause' }, { signal: controller.signal },
    );
    assert.equal(control.accepted, false);
    assert.equal(control.error, 'cancelled');
    assert.equal(bridge.pending.size, 0);

    const snapshot = await bridge.request({ type: 'snapshot' });
    assert.equal(snapshot.snapshot.paused, true, 'an aborted command must not reach Core');
  } finally {
    unregister();
    await bridge.stop();
  }
});

test('stopping the bridge stops the core process, which is what unload does', async () => {
  const bridge = new CoreBridge({ spawnCore: () => spawnFakeCore() });
  await bridge.start();
  const pid = bridge.child.pid;
  await bridge.stop();
  await delay(200);
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'unloading the plugin must not leave the core running');
});
