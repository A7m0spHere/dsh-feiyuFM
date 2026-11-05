// Deterministic audio-host double for tests. It speaks the same IPC protocol
// as the WPF host without touching an audio device, has no external
// dependencies, and can reproduce the awkward cases the real host showed:
// slow or failed opens, a transient 0 ms position after a resume, duplicate
// ended notifications, stale-version events and a mid-session crash.
//
// Options arrive as JSON in FISHFM_FAKE_BACKEND. Used by test/playback.test.mjs.
import net from 'node:net';
import { rmSync } from 'node:fs';
import { pipePath } from './transport.mjs';

const options = JSON.parse(process.env.FISHFM_FAKE_BACKEND ?? '{}');
const argOf = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const PIPE_NAME = argOf('-PipeName');
const OWNER_PID = Number(argOf('-OwnerPid') ?? 0);
const PROTOCOL = Number(argOf('-ProtocolVersion') ?? 1);
if (!PIPE_NAME) throw new Error('Fake backend needs -PipeName');
const endpoint = pipePath(PIPE_NAME);
// 崩溃恢复复用同一个名称，AF_UNIX 遗留 socket 需先清理。
if (process.platform === 'darwin') rmSync(endpoint, { force: true });
process.on('exit', () => {
  if (process.platform === 'darwin') rmSync(endpoint, { force: true });
});

const durationMs = options.durationMs ?? 2000;
const tickMs = options.tickMs ?? 40;
const openDelayMs = options.openDelayMs ?? 20;
const openBehavior = options.openBehavior ?? 'open'; // open | fail | never
const supportsSeek = options.supportsSeek !== false;
const duplicateEnded = options.duplicateEnded === true;
const transientZero = options.transientZero === true;
const staleProgress = options.staleProgress === true;
const crashOn = options.crashOn ?? null; // 'load' | 'play' | null
const crashDelayMs = options.crashDelayMs ?? 30;

let status = 'idle';
let instance = null;
let version = null;
let acceptedVersion = -1;
let resource = null;
let muted = false;
let positionMs = 0;
let startedSent = false;
let endedSent = false;
let playingSince = null;
let basePosition = 0;
let writer = null;
let server = null;
let reader = null;
let readTask = null;
let connectTask = null;
let running = true;
let lastWatchdog = Date.now();
let transientZeroPending = false;
let pendingLoad = null;
let preloaded = null;

const send = (value) => {
  if (!writer) return;
  try {
    writer.write(`${JSON.stringify({ v: PROTOCOL, ...value })}\n`);
  } catch {
    writer = null;
  }
};

const state = () => ({
  status,
  playInstanceId: instance,
  version,
  positionMs: Math.round(currentPosition()),
  durationMs,
  muted,
  seek: supportsSeek,
  resource,
});

const sendResult = (id, extra = {}) => send({ type: 'result', id, ok: true, state: state(), ...extra });
const sendError = (id, code, message, retryable = false) =>
  send({ type: 'result', id, ok: false, error: { code, message, retryable }, state: state() });
const sendEvent = (event, extra = {}) =>
  send({ type: 'event', event, playInstanceId: instance, version, ...extra });

/** Wall-clock timeline, with an optional transient 0 right after a resume. */
function currentPosition() {
  if (transientZeroPending) return 0;
  if (status !== 'playing' || playingSince === null) return positionMs;
  return Math.min(durationMs, basePosition + (Date.now() - playingSince));
}

function stopTimeline() {
  positionMs = Math.round(currentPosition());
  playingSince = null;
}

function crash() {
  process.exit(options.crashCode ?? 3);
}

function cancelLoad() {
  if (!pendingLoad) return;
  const pending = pendingLoad;
  pendingLoad = null;
  clearTimeout(pending.timer);
  sendError(pending.id, 'cancelled', 'Media open was superseded by a playback control');
}

function cancelPreload() {
  const pending = preloaded;
  preloaded = null;
  if (!pending) return;
  clearTimeout(pending.timer);
  if (!pending.ready) sendError(pending.id, 'cancelled', 'Media preload was superseded by a playback control');
}

function handle(command, id) {
  if (Number.isFinite(command.version)) {
    if (command.version < acceptedVersion) return void sendError(id, 'stale_version', 'Ignored an older playback command');
    acceptedVersion = command.version;
    if (instance) version = command.version;
  }
  switch (command.type) {
    case 'load': {
      if (command.usePreload === true && preloaded?.ready && preloaded.resource === command.resource) {
        // Standby media is already open: answer without the open delay.
        const standby = preloaded;
        preloaded = null;
        clearTimeout(standby.timer);
        stopTimeline();
        status = 'loading';
        instance = command.playInstanceId ?? null;
        version = command.version ?? null;
        resource = command.resource ?? null;
        positionMs = 0;
        basePosition = 0;
        startedSent = false;
        endedSent = false;
        transientZeroPending = false;
        if (typeof command.muted === 'boolean') muted = command.muted;
        status = command.autoplay === true ? 'playing' : 'ready';
        if (command.autoplay === true) playingSince = Date.now();
        sendResult(id, { positionMs: 0, seek: true, muted, playing: command.autoplay === true, preloaded: true });
        return;
      }
      cancelPreload();
      cancelLoad();
      stopTimeline();
      status = 'loading';
      instance = command.playInstanceId ?? null;
      version = command.version ?? null;
      resource = command.resource ?? null;
      positionMs = 0;
      basePosition = 0;
      startedSent = false;
      endedSent = false;
      transientZeroPending = false;
      if (typeof command.muted === 'boolean') muted = command.muted;
      const autoplay = command.autoplay === true;
      if (crashOn === 'load') return void setTimeout(crash, crashDelayMs);
      const pending = { id, timer: null };
      pendingLoad = pending;
      pending.timer = setTimeout(() => {
        if (pendingLoad !== pending) return;
        if (openBehavior === 'never') {
          // Mirror the real host: a bounded wait that answers with a timeout
          // error instead of leaving the client to guess.
          const timeoutMs = Number(command.openTimeoutMs ?? 1000);
          pending.timer = setTimeout(() => {
            if (pendingLoad !== pending) return;
            pendingLoad = null;
            status = 'error';
            sendError(id, 'media_open_timeout', `Media did not open within ${timeoutMs} ms`, true);
          }, timeoutMs);
          return;
        }
        if (openBehavior === 'fail') {
          pendingLoad = null;
          status = 'error';
          sendError(id, 'media_failed', 'Simulated media failure');
          return;
        }
        const startMs = Number(command.startPositionMs ?? 0);
        pendingLoad = null;
        const seeked = startMs > 0 ? supportsSeek : true;
        basePosition = seeked ? startMs : 0;
        positionMs = basePosition;
        status = 'ready';
        if (autoplay) {
          // Same contract as the real host: one load command can start audio.
          status = 'playing';
          playingSince = Date.now();
          startedSent = false;
          transientZeroPending = false;
          sendResult(id, { positionMs: basePosition, seek: seeked, muted, playing: true });
          return;
        }
        sendResult(id, { positionMs: basePosition, seek: seeked, muted });
      }, openDelayMs);
      return;
    }
    case 'preload': {
      cancelPreload();
      const pending = { id, resource: command.resource ?? null, timer: null, ready: false };
      preloaded = pending;
      pending.timer = setTimeout(() => {
        if (preloaded !== pending) return;
        if (openBehavior === 'fail') { preloaded = null; return void sendError(id, 'media_failed', 'Simulated preload failure'); }
        if (openBehavior === 'never') { preloaded = null; return void sendError(id, 'media_open_timeout', 'Preload did not open', true); }
        pending.ready = true;
        sendResult(id, { positionMs: 0, preloaded: true });
      }, openDelayMs);
      return;
    }
    case 'preloadCancel': {
      cancelPreload();
      return void sendResult(id, { preloaded: false });
    }
    case 'play': {
      if (!instance) return void sendError(id, 'no_media', 'Nothing is loaded');
      status = 'playing';
      playingSince = Date.now();
      startedSent = false;
      transientZeroPending = transientZero;
      setTimeout(() => { transientZeroPending = false; }, Number(options.transientZeroMs ?? 120));
      if (crashOn === 'play') setTimeout(crash, crashDelayMs);
      return void sendResult(id, { positionMs: Math.round(currentPosition()) });
    }
    case 'seek': {
      if (!supportsSeek) return void sendError(id, 'seek_unsupported', 'Seeking unavailable');
      if (!instance || command.playInstanceId !== instance) return void sendError(id, 'stale_track', 'Track changed');
      if (!Number.isFinite(command.positionMs) || command.positionMs < 0 || command.positionMs >= durationMs) return void sendError(id, 'invalid_command', 'Invalid seek target');
      if (options.seekFailure) return void sendError(id, 'seek_failed', 'Simulated seek failure');
      positionMs = basePosition = command.positionMs;
      if (status === 'playing') playingSince = Date.now();
      return void sendResult(id, { positionMs });
    }
    case 'pause': {
      cancelPreload();
      if (pendingLoad) { cancelLoad(); status = 'paused'; }
      stopTimeline();
      if (status === 'playing' || status === 'ready') status = 'paused';
      return void sendResult(id, { positionMs: Math.round(positionMs) });
    }
    case 'stop': {
      cancelPreload();
      cancelLoad();
      stopTimeline();
      status = 'idle';
      instance = null;
      version = null;
      resource = null;
      positionMs = 0;
      basePosition = 0;
      startedSent = false;
      endedSent = false;
      return void sendResult(id, { positionMs: 0 });
    }
    case 'setMuted': {
      muted = command.muted === true;
      return void sendResult(id, { muted, positionMs: Math.round(currentPosition()) });
    }
    case 'snapshot':
    case 'ping':
      return void sendResult(id);
    case 'shutdown': {
      cancelPreload();
      cancelLoad();
      stopTimeline();
      status = 'idle';
      sendResult(id);
      sendEvent('exiting');
      running = false;
      setTimeout(() => process.exit(0), 20);
      return;
    }
    default:
      return void sendError(id, 'invalid_command', `Unknown command: ${String(command.type)}`);
  }
}

function tick() {
  if (!running) return;
  if (status === 'playing') {
    const position = Math.round(currentPosition());
    if (position > 0 && position > basePosition) {
      if (!startedSent) {
        startedSent = true;
        positionMs = position;
        sendEvent('started', { positionMs: position, progressSource: 'audio' });
        if (staleProgress) sendEvent('progress', { positionMs: position, progressSource: 'audio', version: -1 });
      } else if (position > positionMs) {
        positionMs = position;
        sendEvent('progress', { positionMs: position, progressSource: 'audio' });
      }
    }
    if (position >= durationMs && !endedSent) {
      endedSent = true;
      positionMs = durationMs;
      playingSince = null;
      status = 'ended';
      sendEvent('ended', { positionMs: durationMs });
      if (duplicateEnded) sendEvent('ended', { positionMs: durationMs });
    }
  }
  if (OWNER_PID > 0 && Date.now() - lastWatchdog >= 200) {
    lastWatchdog = Date.now();
    let alive = true;
    try { process.kill(OWNER_PID, 0); } catch { alive = false; }
    if (!alive) {
      process.stdout.write('FISHFM_PLAYBACK_OWNER_GONE\n');
      stopTimeline();
      process.exit(0);
    }
  }
}

function accept() {
  server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    // Only the active socket may own the writer. A late 'close' from a socket
    // the client already abandoned must not clobber the connection that
    // replaced it, or the next answer would be written into nowhere.
    const isActive = () => writer === socket;
    writer = socket;
    reader = '';
    process.stdout.write('FISHFM_PLAYBACK_CLIENT_CONNECTED\n');
    send({
      type: 'hello',
      protocol: PROTOCOL,
      pid: process.pid,
      backend: 'fake-backend',
      ownerPid: OWNER_PID,
      capabilities: { seek: supportsSeek, seekInPlace: supportsSeek, mute: true, autoplay: true, reuseSwitch: true, preload: true },
    });
    send({ type: 'state', ...state() });
    socket.on('data', (chunk) => {
      if (!isActive()) return;
      reader += chunk;
      for (let index; (index = reader.indexOf('\n')) >= 0;) {
        const line = reader.slice(0, index).trim();
        reader = reader.slice(index + 1);
        if (!line) continue;
        let command;
        try { command = JSON.parse(line); } catch { continue; }
        handle(command, command.id);
      }
    });
    socket.on('error', () => { if (isActive()) writer = null; });
    socket.on('close', () => {
      if (!isActive()) return;
      writer = null;
      process.stdout.write('FISHFM_PLAYBACK_CLIENT_DISCONNECTED\n');
    });
  });
  server.on('error', (error) => {
    process.stderr.write(`fake backend pipe error: ${error.code ?? error.message}\n`);
    process.exit(4);
  });
  server.listen(endpoint, () => {
    process.stdout.write(`FISHFM_PLAYBACK_READY protocol=${PROTOCOL} pid=${process.pid}\n`);
  });
}

accept();
setInterval(tick, tickMs);
process.on('SIGTERM', () => process.exit(0));
