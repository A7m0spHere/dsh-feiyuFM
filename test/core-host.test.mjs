// The core host that the DSH plugin owns: protocol, event gating, provider
// honesty, and the shutdown behaviour that makes "stopping the plugin stops the
// music" true for the real product path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createCoreHost, mapSessionEvent, ProviderRegistry, CORE_HOST_PROTOCOL } from '../src/core-host.mjs';
import { MusicStore } from '../src/storage.mjs';
import { FakeProvider } from '../src/fakes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const track = { provider: 'netease', providerTrackId: 'h1', title: 'Host track', durationMs: 600 };

/** Collects protocol lines written by a host. */
function collector() {
  const messages = [];
  return {
    stream: { write: (chunk) => { for (const line of chunk.split('\n')) if (line.trim()) messages.push(JSON.parse(line)); } },
    messages,
  };
}

test('greets with a snapshot and answers commands in order', async () => {
  const out = collector();
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake', dbPath: ':memory:' });
  try {
    await host.start();
    assert.equal(out.messages[0].type, 'ready');
    assert.equal(out.messages[0].v, CORE_HOST_PROTOCOL);
    assert.equal(out.messages[0].snapshot.revision >= 0, true);

    await host.handle({ id: 'q', type: 'setQueue', tracks: [track] });
    assert.equal(out.messages.at(-1).type, 'result');
    assert.equal(out.messages.at(-1).id, 'q');

    await host.handle({ id: 'n', type: 'command', command: { type: 'next', commandId: 'c1' } });
    const afterNext = out.messages.at(-1);
    assert.equal(afterNext.ok, true);
    assert.equal(afterNext.snapshot.current.track.providerTrackId, 'h1');
    assert.equal(afterNext.snapshot.paused, true, 'next while paused must stay paused');

    await host.handle({ id: 's', type: 'snapshot' });
    assert.equal(out.messages.at(-1).snapshot.current.track.title, 'Host track');
  } finally {
    await host.close();
  }
});

test('reports command failures as named errors without dropping the session', async () => {
  const out = collector();
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake' });
  try {
    await host.start();
    await host.handle({ id: 'bad', type: 'command', command: { type: 'next', commandId: 'c1' } });
    const error = out.messages.at(-1);
    assert.equal(error.type, 'error');
    assert.equal(error.error.code, 'no_candidates');

    await host.handle({ id: 'unknown', type: 'not-a-thing' });
    assert.equal(out.messages.at(-1).error.code, 'invalid_command');

    await host.handle({ id: 'ok', type: 'snapshot' });
    assert.equal(out.messages.at(-1).ok, true, 'the host must keep serving after an error');
  } finally {
    await host.close();
  }
});

test('an accepted slow media command cannot hold up a pause, snapshot or shutdown', async () => {
  const provider=new FakeProvider(); provider.defer(track);
  const out=collector();
  const host=createCoreHost({provider,playbackMode:'fake',output:out.stream});
  try {
    await host.start();
    const at=Date.now();
    await host.handle({type:'command',id:'slow',command:{type:'requestTrack',track,commandId:'slow'}});
    assert.ok(Date.now()-at<1000,'acceptance must not wait for the 5s provider timeout');
    assert.equal(out.messages.at(-1).snapshot.status,'resolving');
    await host.handle({type:'command',id:'pause',command:{type:'pause',commandId:'pause-slow'}});
    await host.core.waitForIdle();
    assert.equal(host.snapshot().paused,true);
    assert.equal(host.playback.playing,false);
    await host.handle({type:'snapshot',id:'read-after-pause'});
    assert.equal(out.messages.at(-1).snapshot.paused,true);
  } finally {await host.close();}
});

test('stdio keeps processing pause while the previous track is still resolving', async () => {
  const hostUrl=new URL('../src/core-host.mjs',import.meta.url).href;
  const fakesUrl=new URL('../src/fakes.mjs',import.meta.url).href;
  const script=`import {runCoreHost} from ${JSON.stringify(hostUrl)}; import {FakeProvider} from ${JSON.stringify(fakesUrl)}; const p=new FakeProvider(); p.defer(${JSON.stringify(track)}); await runCoreHost({provider:p,playbackMode:'fake'});`;
  const child=spawn(process.execPath,['--input-type=module','--eval',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const messages=[]; let buffer='';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',text=>{buffer+=text; for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line)messages.push(JSON.parse(line));}});
  const until=async predicate=>{const stop=Date.now()+2500;while(!predicate()){if(Date.now()>stop)throw new Error('stdio response timed out');await delay(10);}};
  const send=message=>child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    await until(()=>messages.some(m=>m.type==='ready'));
    send({type:'command',id:'slow',command:{type:'requestTrack',track,commandId:'stdio-slow'}});
    await until(()=>messages.some(m=>m.id==='slow'));
    send({type:'command',id:'pause',command:{type:'pause',commandId:'stdio-pause'}});
    await until(()=>messages.some(m=>m.id==='pause'));
    assert.equal(messages.find(m=>m.id==='pause').snapshot.paused,true);
    send({type:'shutdown',id:'stop'});
    await until(()=>child.exitCode!==null);
    assert.equal(child.exitCode,0);
  } finally {if(child.exitCode===null)child.kill();}
});

test('only turn/end may trigger autonomous selection; unknown events are ignored', () => {
  assert.equal(mapSessionEvent('turn/end').allowsAutonomy, true);
  assert.equal(mapSessionEvent('turn/end').kind, 'turn_end');
  assert.equal(mapSessionEvent('turn/start').kind, 'session_start');
  assert.equal(mapSessionEvent('tool/call').kind, 'activity');
  // No guessing at work phase, and no idle event exists in DSH.
  assert.equal(mapSessionEvent('idle').kind, 'unknown');
  assert.equal(mapSessionEvent('task_phase_change').kind, 'unknown');
  assert.equal(mapSessionEvent('idle').allowsAutonomy, false);
});

test('an import fills the environment, initializes taste and becomes selectable', async () => {
  const out = collector();
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake', stateIntervalMs: 1000 });
  try {
    await host.start();
    await host.handle({
      id: 'imp', type: 'import', provider: 'netease', source: 'liked', requested: 2,
      tracks: [track, { ...track, providerTrackId: 'h2', title: 'Second' }],
      seed: 11,
    });
    const answer = out.messages.at(-1);
    assert.equal(answer.ok, true);
    assert.equal(answer.import.source, 'liked');
    assert.equal(answer.import.imported, 2);
    assert.equal(answer.import.requested, 2);
    assert.equal(answer.import.degraded, false, 'a full import is not degraded');
    assert.equal(answer.taste.initialized, true);
    assert.equal(answer.taste.seed, 11);

    await host.handle({ id: 'env', type: 'environment' });
    const env = out.messages.at(-1).environment;
    assert.equal(env.total, 2);
    assert.equal(env.bySource.liked.count, 2);
    assert.equal(env.bySource.liked.label, '我喜欢');

    await host.handle({ id: 'library', type: 'library' });
    const library = out.messages.at(-1).library;
    assert.equal(library.total, 2);
    assert.equal(library.tracks[0].providerTrackId, 'h1');
    assert.equal(library.tracks[0].durationMs, 600);
    assert.deepEqual(Object.keys(library.tracks[0]).sort(), ['artist', 'durationMs', 'provider', 'providerTrackId', 'title']);

    // The newly imported tracks are selectable: the selector reads the
    // environment on every decision rather than caching it at startup.
    await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'c1' } });
    const selected = host.snapshot().lastSelection;
    assert.ok(selected?.trackKey, 'the imported environment must be selectable');
    assert.ok(['h1', 'h2'].includes(selected.trackKey.split(':')[1]));
  } finally {
    await host.close();
  }
});

test('a rejected import is reported and changes nothing', async () => {
  const out = collector();
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake' });
  try {
    await host.start();
    await host.handle({
      id: 'bad', type: 'import', provider: 'netease', source: 'recent', requested: 1,
      tracks: [{ provider: 'qq', providerTrackId: 'x', title: 'wrong platform' }],
    });
    const answer = out.messages.at(-1);
    assert.equal(answer.type, 'error');
    assert.match(answer.error.message, /received a qq track/);
    await host.handle({ id: 'env', type: 'environment' });
    assert.equal(out.messages.at(-1).environment.total, 0, 'a rejected import must leave no rows');
  } finally {
    await host.close();
  }
});

test('the host decays preferences on a schedule, so growth cannot ratchet upward forever', async () => {
  const out = collector();
  const logs = [];
  const host = createCoreHost({
    output: out.stream, playbackMode: 'fake', maintenanceIntervalMs: 300, onLog: (entry) => logs.push(entry),
  });
  try {
    await host.start();
    // A preference that was earned long ago and then left alone.
    host.store.setPreference({
      targetType: 'track', targetKey: 'netease:old', affinity: 0.9, source: 'listen',
      updatedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    });
    const before = host.store.getPreference('track', 'netease:old').affinity;

    // stateIntervalMs * 30 is the maintenance period, so 40ms * 30 = 1.2s.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const after = host.store.getPreference('track', 'netease:old').affinity;
    assert.ok(after < before, `a stale preference must decay (${before} -> ${after})`);
    assert.ok(after > 0.5, '60 days of decay must not overshoot past neutral');
    assert.ok(logs.some((entry) => entry.type === 'maintenance'), 'the pass is reported');
  } finally {
    await host.close();
  }
});

test('closing the host stops the maintenance pass, and a closed store is not written to', async () => {
  const out = collector();
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-maintenance-'));
  const path = join(directory, 'maintenance.sqlite');
  try {
    const host = createCoreHost({ output: out.stream, playbackMode: 'fake', maintenanceIntervalMs: 200, dbPath: path });
    await host.start();
    host.store.setPreference({
      targetType: 'track', targetKey: 'netease:old', affinity: 0.9, source: 'listen',
      updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    await host.close();

    // After close the interval is cleared, so nothing keeps writing. Reopen the
    // same file and confirm the value stays put across a wait.
    const reopened = new MusicStore(path);
    try {
      const first = reopened.getPreference('track', 'netease:old').affinity;
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(reopened.getPreference('track', 'netease:old').affinity, first,
        'a closed host must not keep decaying in the background');
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a finished listen grows the agent preference through the host', async () => {
  const out = collector();
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake', provider, stateIntervalMs: 20 });
  try {
    await host.start();
    await host.handle({
      id: 'imp', type: 'import', provider: 'netease', source: 'recent', requested: 1, tracks: [track], seed: 4,
    });
    const before = host.store.getPreference('track', 'netease:h1').affinity;

    // The agent must be the one that chose the track: a user's own pick never
    // updates agent preferences, which is exactly what the MVP requires.
    await host.handle({ id: 'user-pick', type: 'command', command: { type: 'requestTrack', track, commandId: 'cu' } });
    const userInstance = host.snapshot().current.playInstanceId;
    assert.equal(host.snapshot().current.selectedBy, 'user');
    host.core.onPlaybackEvent({ type: 'progress', playInstanceId: userInstance, positionMs: track.durationMs, progressSource: 'audio' });
    host.core.onPlaybackEvent({ type: 'ended', playInstanceId: userInstance });
    await host.handle({ id: 'wait-user', type: 'wait' });
    assert.equal(host.store.getPreference('track', 'netease:h1').affinity, before,
      'a user pick must not grow the agent preference');

    // Now let the agent choose and finish a track itself. A second track is
// imported because the first one is inside its cooldown after just playing.
    const second = { ...track, providerTrackId: 'h2', title: 'Second track' };
    provider.set(second, 'fake:handle-2');
    await host.handle({
      id: 'imp2', type: 'import', provider: 'netease', source: 'recent', requested: 2,
      tracks: [track, second], seed: 4,
    });
    await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'c1' } });
    await host.handle({ id: 'wait-self', type: 'wait' });
    const current = host.snapshot().current;
    assert.equal(current?.selectedBy, 'agent', 'the agent must own this listen');
    const agentKey = current.track.providerTrackId === 'h1' ? 'netease:h1' : 'netease:h2';
    const beforeAgent = host.store.getPreference('track', agentKey).affinity;
    host.core.onPlaybackEvent({ type: 'progress', playInstanceId: current.playInstanceId, positionMs: track.durationMs, progressSource: 'audio' });
    host.core.onPlaybackEvent({ type: 'ended', playInstanceId: current.playInstanceId });
    await host.handle({ id: 'wait', type: 'wait' });

    const after = host.store.getPreference('track', agentKey).affinity;
    assert.ok(after > beforeAgent, `an agent listen must grow the preference (${beforeAgent} -> ${after})`);
    assert.equal(host.store.getPreference('track', 'netease:h1').affinity, before,
      'the track the user picked was never listened to by the agent, so it must not grow');

    // A pause must not grow anything.
    await host.handle({ id: 'self2', type: 'command', command: { type: 'chooseSelf', commandId: 'c2' } });
    await host.handle({ id: 'pause', type: 'command', command: { type: 'pause', commandId: 'c3' } });
    await host.handle({ id: 'wait2', type: 'wait' });
    assert.equal(host.store.getPreference('track', agentKey).affinity, after, 'a pause changes nothing');
  } finally {
    await host.close();
  }
});

test('the host selects autonomously from the user environment and records the fallback', async () => {
  const out = collector();
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const host = createCoreHost({
    output: out.stream, playbackMode: 'fake', provider, stateIntervalMs: 20,
  });
  try {
    await host.start();
    // Seed the environment the way a real import would, then let the agent pick.
    const { importSeedTracks } = await import('../src/environment.mjs');
    const { initializeAgentPreferences } = await import('../src/taste.mjs');
    importSeedTracks({ store: host.store, provider: 'netease', source: 'recent', requested: 1, tracks: [track] });
    initializeAgentPreferences({ store: host.store, seed: 3, now: 1 });

    // Force exploration so the fallback is deterministic rather than a coin flip.
    await host.handle({ id: 'rate', type: 'command', command: { type: 'setDiscoveryRate', value: 1, commandId: 'c0' } });
    // A fresh core is paused; only an explicit user choice starts autonomy.
    await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'c1' } });
    const decision = host.snapshot().lastSelection;
    assert.ok(decision, 'the autonomous decision must be recorded');
    assert.equal(decision.trackKey, 'netease:h1');
    assert.equal(decision.pool, 'familiar');
    assert.equal(decision.discoveryRate, 1, 'the user rate is preserved, not rewritten');
    assert.equal(decision.fellBack, true, 'exploration was attempted and had nothing to offer');
    assert.match(decision.fallbackReason, /discovery pool had no usable track/);
    assert.equal(host.snapshot().current.track.providerTrackId, 'h1');
  } finally {
    await host.close();
  }
});

test('the selector is reproducible from the stored agent seed', async () => {
  const { buildSelector } = await import('../src/core-host.mjs');
  const { MusicStore } = await import('../src/storage.mjs');
  const { importSeedTracks } = await import('../src/environment.mjs');
  const { initializeAgentPreferences } = await import('../src/taste.mjs');

  const make = () => {
    const store = new MusicStore();
    const tracks = ['1', '2', '3'].map((id) => ({ provider: 'netease', providerTrackId: id, title: `N${id}`, artist: 'A' }));
    importSeedTracks({ store, provider: 'netease', source: 'recent', requested: 3, tracks });
    initializeAgentPreferences({ store, seed: 777, now: 1 });
    return { store, tracks };
  };

  const first = make();
  const second = make();
  try {
    const at = Date.parse('2026-09-27T12:00:00+08:00');
    const sequence = (store, tracks) => {
      const selector = buildSelector({ store, now: () => at });
      return Array.from({ length: 8 }, () => selector.decide({ discoveryRate: 0, at }).track.providerTrackId);
    };
    assert.deepEqual(sequence(first.store, first.tracks), sequence(second.store, second.tracks),
      'two stores with the same seed must select identically');
  } finally {
    first.store.close();
    second.store.close();
  }
});

test('a session event may select autonomously and never invents work context', async () => {
  const out = collector();
  // The fixed-candidate queue is the Phase 1 entry point; it is a separate,
  // explicit mode from selecting out of the user's environment.
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake', selectionMode: 'queue' });
  try {
    await host.start();
    await host.handle({ id: 'q', type: 'setQueue', tracks: [track] });

    // A freshly started core is paused, and autonomy must respect that.
    await host.handle({ id: 'start', type: 'session-event', name: 'turn/start', sessionId: 'session-1' });
    assert.equal(out.messages.at(-1).selected, false, 'turn/start must not start music by itself');
    assert.equal(out.messages.at(-1).kind, 'session_start');
    assert.equal(out.messages.at(-1).snapshot.current, null, 'a paused core must not pick a track');

    // An event that carries no session cannot start music: the core cannot tell
    // whose context it belongs to, and guessing would let sessions interfere.
    await host.handle({ id: 'no-session', type: 'session-event', name: 'turn/end' });
    assert.equal(out.messages.at(-1).autonomy.allowed, false);
    assert.match(out.messages.at(-1).autonomy.reason, /no session id/);
    assert.equal(out.messages.at(-1).selected, false);

    // Only an explicit user choice lifts the pause.
    await host.handle({ id: 'self', type: 'command', command: { type: 'chooseSelf', commandId: 'c1' } });
    assert.equal(out.messages.at(-1).ok, true);

    await host.handle({ id: 'end', type: 'session-event', name: 'turn/end', sessionId: 'session-1' });
    assert.equal(out.messages.at(-1).kind, 'turn_end');

    await host.handle({ id: 'unknown', type: 'session-event', name: 'mystery/event', sessionId: 'session-1' });
    assert.equal(out.messages.at(-1).kind, 'unknown');
    assert.equal(out.messages.at(-1).selected, false);
  } finally {
    await host.close();
  }
});

test('an unimplemented platform is reported as unavailable instead of an empty result', async () => {
  const out = collector();
  const host = createCoreHost({ output: out.stream, playbackMode: 'fake', providerRegistry: new ProviderRegistry({}) });
  try {
    await host.start();
    await host.handle({ id: 'a', type: 'account', provider: 'netease' });
    const answer = out.messages.at(-1);
    assert.equal(answer.account.status, 'unavailable');
    assert.equal(answer.capabilities.seed.status, 'unavailable');
    assert.ok(answer.capabilities.seed.reason, 'the reason must be explicit');
  } finally {
    await host.close();
  }
});

test('publishes state changes without being polled, and a restart comes back paused', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-host-restart-'));
  const dbPath = join(directory, 'host.sqlite');
  const out = collector();
  const provider = new FakeProvider();
  provider.set(track, 'fake:handle');
  const host = createCoreHost({
    output: out.stream, playbackMode: 'fake', provider, dbPath, stateIntervalMs: 20,
  });
  try {
    await host.start();
    await host.handle({ id: 'play', type: 'command', command: { type: 'requestTrack', track, commandId: 'c1' } });
    await delay(120);
    const pushed = out.messages.filter((m) => m.type === 'state');
    assert.ok(pushed.length >= 1, 'state must be pushed to the owner, not only returned');
    assert.equal(host.playback.playing, true);

    await host.handle({ id: 'bye', type: 'shutdown' });
    assert.equal(host.playback.playing, false, 'shutdown must stop playback');
  } finally {
    await host.close();
  }

  // Reopening the same database must restore the track paused, not resume it.
  const second = createCoreHost({ output: collector().stream, playbackMode: 'fake', provider, dbPath });
  try {
    await second.start();
    const snapshot = second.snapshot();
    assert.equal(snapshot.paused, true, 'a restart must come back paused');
    assert.equal(snapshot.current?.track.providerTrackId, 'h1', 'the track itself is retained');
    assert.equal(second.playback.playing, false, 'a restart must not resume audio by itself');
  } finally {
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('spawned as a process it serves the plugin path and exits cleanly on shutdown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-core-'));
  const dbPath = join(directory, 'core.sqlite');
  const child = spawn(process.execPath, [join(root, 'bin', 'fishfm-core.mjs'), '--db', dbPath, '--playback', 'fake'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const messages = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) messages.push(JSON.parse(line));
    }
  });
  child.stderr.resume();
  const waitFor = async (predicate, what) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await delay(20);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const sendLine = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  try {
    await waitFor(() => messages.some((m) => m.type === 'ready'), 'ready');
    sendLine({ id: 'q', type: 'setQueue', tracks: [track] });
    await waitFor(() => messages.some((m) => m.id === 'q'), 'queue result');
    sendLine({ id: 'n', type: 'command', command: { type: 'next', commandId: 'c1' } });
    await waitFor(() => messages.some((m) => m.id === 'n'), 'next result');
    const next = messages.find((m) => m.id === 'n');
    assert.equal(next.snapshot.current.track.providerTrackId, 'h1');

    sendLine({ id: 'bye', type: 'shutdown' });
    await waitFor(() => messages.some((m) => m.id === 'bye'), 'shutdown result');
    // The child may already be gone by now; check before attaching a listener.
    const code = child.exitCode !== null
      ? child.exitCode
      : await new Promise((r) => child.once('exit', r));
    assert.equal(code, 0, 'the core must exit cleanly when its owner stops it');

    // The database the plugin pointed at must have been written.
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(dbPath), true, 'the core must persist to the configured database');
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
