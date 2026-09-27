// Real-audio verification for the independent playback backend (Phase 2, P1).
//
// It uses the actual WPF audio host, a generated WAV, and no music account, so
// it answers the P1 completion conditions directly:
//   real backend under the shared contract, observable pause/mute/end/error,
//   playback that survives a UI process exiting, and a host that stops when the
//   plugin that owns it is torn down.
//
// Run: node scripts/playback-smoke.mjs [--seconds 6] [--keep-tone]
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playbackError } from '../src/playback/protocol.mjs';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { wpfBackend } from '../src/playback/backends.mjs';
import { writeTone } from './make-tone.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const seconds = Number(argValue('--seconds', 6));
const keepTone = process.argv.includes('--keep-tone');

const results = [];
const record = (step, ok, detail = {}) => {
  results.push({ step, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${JSON.stringify(detail)}`);
};

const toneDirectory = join(root, '.tmp');
mkdirSync(toneDirectory, { recursive: true });
const tonePath = join(toneDirectory, `fishfm-smoke-${seconds}s.wav`);
const tone = writeTone({ path: tonePath, seconds, frequency: 440 });
console.log(`tone: ${tonePath} ${tone.durationMs}ms ${tone.bytes} bytes`);

const events = [];
const logs = [];
const supervisor = new PlaybackSupervisor({
  backend: wpfBackend(),
  startupTimeoutMs: 25000,
  greetTimeoutMs: 8000,
  onLog: (entry) => logs.push(entry),
});
const service = new PlaybackService({ supervisor, openTimeoutMs: 15000, commandTimeoutMs: 8000, progressIntervalMs: 200 });
service.onEvent((event) => events.push(event));

const waitFor = async (predicate, { timeoutMs = 20000, what = 'condition' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(25);
  }
  return false;
};
const probePid = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

let exitCode = 0;
try {
  const loaded = await service.load({ resource: { handle: tonePath }, playInstanceId: 'smoke-1', version: 1 });
  record('real host greets and opens a local WAV', supervisor.hello?.backend === 'wpf-mediaplayer' && loaded.positionMs === 0, {
    backend: supervisor.hello?.backend, hostPid: supervisor.pid, positionMs: loaded.positionMs,
  });

  // A UI stand-in: an unrelated process that starts and exits. In this
  // architecture the desktop UI talks to the music core, never to the audio
  // host, so the host must be unaffected by it coming and going.
  const ui = spawn(process.execPath, ['-e', "console.log('ui-stand-in')"], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolve) => ui.once('exit', resolve));
  record('an unrelated UI process starts and exits', !probePid(ui.pid), { uiPid: ui.pid });

  await service.play({ playInstanceId: 'smoke-1', version: 1 });
  const startedOk = await waitFor(() => events.some((e) => e.type === 'started'), { what: 'started' });
  record('audio timeline really advances after play', startedOk, {
    started: events.find((e) => e.type === 'started')?.positionMs ?? null,
  });

  await waitFor(() => events.some((e) => e.type === 'progress' && e.positionMs > 500), { what: 'progress past 500ms' });
  const beforePause = events.filter((e) => e.type === 'progress').at(-1)?.positionMs ?? 0;
  record('playback continues with no UI process alive', beforePause > 500, { positionMs: beforePause });

  await service.pause({ version: 2 });
  const afterPause = events.filter((e) => e.type === 'progress').at(-1)?.positionMs ?? 0;
  await delay(1200);
  const stillPaused = events.filter((e) => e.type === 'progress').at(-1)?.positionMs ?? 0;
  record('pause freezes the position', stillPaused <= afterPause + 50, { afterPause, stillPaused });

  await service.setMuted({ muted: true, version: 2 });
  const resumed = await service.load({ resource: { handle: tonePath }, playInstanceId: 'smoke-1', startPositionMs: stillPaused, version: 3 });
  record('resume seeks back to the paused position', resumed.positionMs > 0, { requested: stillPaused, actual: resumed.positionMs });
  await service.play({ playInstanceId: 'smoke-1', version: 3 });
  const resumedProgress = await waitFor(
    () => events.some((e) => e.type === 'progress' && e.version === 3 && e.positionMs > resumed.positionMs),
    { what: 'progress after resume' },
  );
  record('muted playback still advances the timeline', resumedProgress, {
    from: resumed.positionMs,
    to: events.filter((e) => e.type === 'progress' && e.version === 3).at(-1)?.positionMs ?? null,
  });

  // Client loss must not stop audio. While a track is active the service is
  // expected to reconnect on its own and adopt the running instance from the
  // host snapshot instead of reporting a fabricated failure.
  const hostPidBefore = supervisor.pid;
  const positionBeforeDrop = events.filter((e) => e.type === 'progress').at(-1)?.positionMs ?? 0;
  supervisor.transport?.close({ reason: playbackError('pipe_closed', 'smoke: simulated client loss') });
  const reconnected = await waitFor(() => supervisor.connected && supervisor.pid === hostPidBefore, {
    timeoutMs: 15000, what: 'reconnect',
  });
  record('a dropped client connection reconnects to the same host', reconnected, { hostPid: hostPidBefore });
  const lossError = events.find((e) => e.code === 'playback_host_lost');
  record('client loss does not report a playback error', !lossError, {
    message: lossError?.message ?? null,
  });
  const adopted = await service.hostSnapshot();
  record('the reconnected host still holds the running track', adopted?.playInstanceId === 'smoke-1', {
    playInstanceId: adopted?.playInstanceId ?? null,
    hostPositionMs: adopted?.positionMs ?? null,
    positionBeforeDrop,
  });

  const endedOk = await waitFor(() => events.some((e) => e.type === 'ended'), { timeoutMs: 30000, what: 'ended' });
  const ended = events.find((e) => e.type === 'ended');
  record('a muted track still reaches its end', endedOk && (ended?.positionMs ?? 0) >= tone.durationMs - 400, {
    endedPositionMs: ended?.positionMs ?? null, toneDurationMs: tone.durationMs,
  });

  // Failure path: a text file renamed to .mp3 must fail, not fake a start.
  const badPath = join(toneDirectory, 'fishfm-smoke-broken.mp3');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(badPath, 'this is not audio');
  let failure = null;
  try {
    await service.load({ resource: { handle: badPath }, playInstanceId: 'smoke-2', version: 4 });
  } catch (error) {
    failure = error;
  }
  record('an unplayable resource fails with a bounded, named error', Boolean(failure?.code), {
    code: failure?.code ?? null,
  });
  rmSync(badPath, { force: true });

  record('no fabricated playback events for the failing resource', !events.some((e) => e.playInstanceId === 'smoke-2'), {});

  const hostPid = supervisor.pid;
  await service.close({ gracefulTimeoutMs: 4000 });
  await delay(300);
  record('tearing the service down stops the audio host', !probePid(hostPid), { hostPid });
} catch (error) {
  record('smoke run completed without an unexpected throw', false, { message: error.message, code: error.code ?? null });
  exitCode = 1;
} finally {
  try { await service.close({ gracefulTimeoutMs: 2000 }); } catch { /* already closed */ }
  if (!keepTone) rmSync(tonePath, { force: true });
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed checks:', failed.map((entry) => entry.step).join('; '));
  exitCode = 1;
}
if (process.env.FISHFM_SMOKE_LOGS === '1') console.log('service logs:', JSON.stringify(logs, null, 2));
process.exit(exitCode);