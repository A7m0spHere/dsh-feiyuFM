// Audio backend descriptors. A backend only describes how to start a host
// process that speaks the playback pipe protocol; the Node side never imports
// platform audio code, so a verified host can be swapped without touching Core.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playbackError } from './protocol.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export const WPF_HOST_SCRIPT = join(root, 'host', 'wpf-media-host.ps1');
export const FAKE_BACKEND_SCRIPT = join(root, 'fake-backend.mjs');

function windowsPowerShellPath(env) {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Ordered shell candidates. P0-04 verified `pwsh -Sta`; in-box Windows
 * PowerShell 5.1 is the fallback because it is STA by default and always
 * present, while `pwsh` is not.
 */
export function powerShellCandidates({ env = process.env, exists = existsSync } = {}) {
  const candidates = [];
  if (env.FISHFM_PLAYBACK_SHELL) {
    candidates.push({ command: env.FISHFM_PLAYBACK_SHELL, label: 'FISHFM_PLAYBACK_SHELL', source: 'override' });
  }
  candidates.push({ command: 'pwsh', label: 'pwsh', source: 'path' });
  const inBox = windowsPowerShellPath(env);
  candidates.push(exists(inBox)
    ? { command: inBox, label: 'Windows PowerShell', source: 'inbox' }
    : { command: 'powershell.exe', label: 'powershell.exe', source: 'path' });
  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = candidate.command.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate) => ({
      ...candidate,
      args: ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File'],
    }));
}

/** Real audio backend: a hidden STA PowerShell process driving WPF MediaPlayer. */
export function wpfBackend({ env = process.env, exists = existsSync, volume = 0.35, candidates } = {}) {
  return {
    name: 'wpf-mediaplayer',
    script: WPF_HOST_SCRIPT,
    candidates: candidates ?? powerShellCandidates({ env, exists }),
    extraArgs: (context) => [
      '-PipeName', context.pipeName,
      '-OwnerPid', String(context.ownerPid ?? 0),
      '-ProtocolVersion', String(context.protocol),
      '-Volume', String(volume),
    ],
  };
}

/**
 * Deterministic test double. It speaks the same protocol without touching an
 * audio device, so supervisor, transport and adapter behavior stay testable in
 * CI on any Windows runner.
 */
export function fakeBackend(options = {}, { env = process.env } = {}) {
  return {
    name: `fake-backend${options.name ? `:${options.name}` : ''}`,
    script: FAKE_BACKEND_SCRIPT,
    candidates: [{ command: process.execPath, args: [], label: 'node', source: 'process.execPath' }],
    env: { ...env, FISHFM_FAKE_BACKEND: JSON.stringify(options) },
    extraArgs: (context) => [
      '-PipeName', context.pipeName,
      '-OwnerPid', String(context.ownerPid ?? 0),
      '-ProtocolVersion', String(context.protocol),
    ],
  };
}

export function requireWindows(platform = process.platform) {
  if (platform !== 'win32') {
    throw playbackError('unsupported_platform', 'Real audio playback currently requires Windows');
  }
}

export function candidateCommandLine(backend, candidate, context) {
  return {
    command: candidate.command,
    args: [...candidate.args, backend.script, ...backend.extraArgs(context)],
    env: backend.env ? { ...process.env, ...backend.env } : process.env,
  };
}