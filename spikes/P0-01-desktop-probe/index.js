// F1 desktop-host probe, packaged as an installable workspace bundle.
//
// It exists to answer one question that documentation alone cannot settle:
// does a plugin activated in the real DSH desktop profile receive real events,
// own an out-of-process Node Core through DSH's own node shim, serve a local
// pipe that a child can reach, and stop that child when the plugin is removed?
//
// Evidence goes to a JSONL file so the answer never depends on plugin stdout.
// Only desensitized facts are recorded: types, counts, pids, exit codes.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

export const name = 'fishfm-p0-desktop';
export const inject = ['sessions', 'tools'];

let evidencePath = join(tmpdir(), 'fishfm-p0-desktop.jsonl');
let repoRoot = null;

function record(phase, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), phase, ...data });
  try {
    mkdirSync(dirname(evidencePath), { recursive: true });
    appendFileSync(evidencePath, `${line}\n`);
  } catch { /* Evidence is best effort. */ }
}

/** Mirrors what @deepseek-ai/dsh-desktop-host does to run Node work itself. */
function nodeCommand(scriptPath) {
  const exe = process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? process.execPath;
  return {
    command: exe,
    args: ['--expose-internals', scriptPath],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  };
}

export function apply(ctx, config = {}) {
  if (typeof config.evidencePath === 'string' && config.evidencePath) evidencePath = config.evidencePath;
  if (typeof config.repoRoot === 'string' && config.repoRoot) repoRoot = config.repoRoot;

  record('apply', {
    pid: process.pid,
    versions: { node: process.versions.node, electron: process.versions.electron ?? null },
    configKeys: Object.keys(config).sort(),
    env: {
      DSH_PROFILE: process.env.DSH_PROFILE ?? null,
      DSH_DESKTOP_NODE_EXECUTABLE: process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? null,
      DSH_HOME_PRESENT: Boolean(process.env.DSH_HOME),
      DSH_SESSION_ID_PRESENT: Boolean(process.env.DSH_SESSION_ID),
    },
    services: {
      sessions: Boolean(ctx.sessions),
      tools: Boolean(ctx.tools),
      // Non-injected services throw on property access; ctx.get() reports absence.
      commands: Boolean(ctx.get?.('commands')),
      credentials: Boolean(ctx.get?.('credentials')),
      effect: typeof ctx.effect === 'function',
      on: typeof ctx.on === 'function',
    },
  });

  const eventTypes = new Map();
  ctx.on('session/event', (_session, event) => {
    const type = String(event?.type ?? 'unknown');
    const seen = eventTypes.get(type) ?? { count: 0, keys: Object.keys(event ?? {}).sort().slice(0, 10) };
    seen.count += 1;
    eventTypes.set(type, seen);
    if (seen.count <= 2) record('session-event', { type, keys: seen.keys });
  });

  const observations = { childReady: false, pipeEcho: null, childExit: null };
  const disposers = [];

  try {
    disposers.push(ctx.tools.register({
      name: 'fishfm_desktop_probe',
      description: 'FishFM F1 probe: report whether the music core child process is alive. No network access.',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['status'] } },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        // DSH rejects union type arrays: every property needs one type string.
        schema: {
          type: 'object',
          properties: {
            childPid: { type: 'integer' },
            childAlive: { type: 'boolean' },
            pipeEcho: { type: 'string' },
          },
          required: ['childPid', 'childAlive', 'pipeEcho'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute() {
        const alive = child ? child.exitCode === null : false;
        record('tool-execute', { childPid: child?.pid ?? null, alive });
        return {
          childPid: child?.pid ?? 0,
          childAlive: alive,
          pipeEcho: observations.pipeEcho ?? '',
        };
      },
    }));
    record('tool-registered', { ok: true, name: 'fishfm_desktop_probe' });
  } catch (error) {
    record('tool-registered', { ok: false, error: String(error?.message ?? error) });
  }

  // Optional dependency: an absent command service must leave the plugin active
  // (references/practices.md), so the command is registered inside ctx.inject.
  try {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(() => {
        const dispose = commandCtx.commands.register({
          name: 'fishfm-probe',
          description: 'FishFM F1 probe: report the music core child process state.',
          handler: () => ({ kind: 'success', text: `child pid ${child?.pid ?? 'none'}` }),
        });
        record('command-registered', { ok: true, name: 'fishfm-probe' });
        return () => {
          record('command-disposed', {});
          dispose();
        };
      });
    });
  } catch (error) {
    record('command-registered', { ok: false, error: String(error?.message ?? error) });
  }

  let child = null;
  let server = null;

  ctx.effect(() => {
    record('effect-start', { repoRoot });
    const pipeName = `fishfm-p0-desktop-${process.pid}`;
    let pipeClient = null;

    try {
      server = net.createServer((socket) => {
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          record('pipe-server-data', { bytes: chunk.length });
          socket.write(`${JSON.stringify({ ok: true, echo: 'pong' })}\n`);
        });
      });
      server.on('error', (error) => record('pipe-server-error', { code: error?.code ?? null }));
      server.listen(`\\\\.\\pipe\\${pipeName}`, () => {
        record('pipe-server-listening', { name: pipeName });
        if (!repoRoot) {
          record('pipe-client-skip', { reason: 'no repoRoot in config' });
          return;
        }
        const shim = nodeCommand(join(repoRoot, 'spikes', 'P0-01-desktop-pipe-client.mjs'));
        pipeClient = spawn(shim.command, [...shim.args, pipeName], {
          env: shim.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        });
        let out = '';
        pipeClient.stdout.setEncoding('utf8');
        pipeClient.stdout.on('data', (chunk) => { out += chunk; });
        pipeClient.stderr.setEncoding('utf8');
        pipeClient.stderr.on('data', (chunk) => { out += chunk; });
        pipeClient.once('exit', (code) => {
          observations.pipeEcho = out.trim() || `exit ${code}`;
          record('pipe-client-exit', { code, output: observations.pipeEcho.slice(0, 200) });
        });
      });
    } catch (error) {
      record('pipe-server-error', { code: 'throw', message: String(error?.message ?? error) });
    }

    try {
      if (!repoRoot) throw new Error('no repoRoot in config');
      const shim = nodeCommand(join(repoRoot, 'bin', 'fishfm-debug.mjs'));
      child = spawn(shim.command, shim.args, { env: shim.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      record('core-spawn', { pid: child.pid, command: shim.command });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        for (let index; (index = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line && !observations.childReady) {
            observations.childReady = true;
            record('core-ready', { pid: child.pid, bytes: line.length });
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => record('core-stderr', { text: String(chunk).trim().slice(0, 160) }));
      child.once('exit', (code) => {
        observations.childExit = code;
        record('core-exit', { pid: child.pid, code });
      });
      child.once('error', (error) => record('core-error', { message: String(error?.message ?? error) }));
    } catch (error) {
      record('core-spawn', { ok: false, error: String(error?.message ?? error) });
    }

    const timer = setTimeout(async () => {
      try {
        const result = await ctx.tools.execute({
          callId: 'fishfm-p0-desktop-self-call',
          name: 'fishfm_desktop_probe',
          arguments: { action: 'status' },
          signal: AbortSignal.timeout(20000),
        });
        record('tool-self-call', { outcome: result?.isError ? 'error' : 'ok' });
      } catch (error) {
        record('tool-self-call', { outcome: 'threw', message: String(error?.message ?? error).slice(0, 160) });
      }
      record('event-summary', {
        types: [...eventTypes.entries()].map(([type, value]) => ({ type, count: value.count })),
      });
    }, Number(process.env.FISHFM_P0_SELF_CALL_DELAY_MS ?? 8000));

    return async () => {
      clearTimeout(timer);
      record('dispose-begin', { childPid: child?.pid ?? null });
      for (const dispose of disposers.reverse()) {
        try { dispose(); } catch (error) { record('dispose-error', { message: String(error?.message ?? error) }); }
      }
      if (pipeClient && pipeClient.exitCode === null) { try { pipeClient.kill(); } catch { /* gone */ } }
      if (server) { try { server.close(); } catch { /* already closed */ } }
      if (child && child.exitCode === null) {
        try { child.stdin.write('exit\n'); } catch { /* fall through to kill */ }
        const graceful = await new Promise((resolve) => {
          const killTimer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(false); }, 2000);
          child.once('exit', (code) => { clearTimeout(killTimer); record('core-exit-after-exit-line', { code }); resolve(true); });
        });
        record('core-stopped', { graceful, code: child.exitCode });
      }
      record('dispose-end', { childAlive: child ? child.exitCode === null : false });
    };
  });

  record('applied', { evidencePath });
}