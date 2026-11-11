// Audio backend descriptors. A backend only describes how to start a host
// process that speaks the playback IPC protocol; the Node side never imports
// platform audio code, so a verified host can be swapped without touching Core.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playbackError } from './protocol.mjs';
import { pipePath } from './transport.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export const WPF_HOST_SCRIPT = join(root, 'host', 'wpf-media-host.ps1');
export const MAC_HOST_LAUNCHER_SCRIPT = join(root, 'host', 'macos-host-launcher.mjs');
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

/**
 * Output volume for the real host. Diagnostics and isolated end-to-end tests need
 * a silent host without editing production defaults: 0 is a valid value and must
 * not be mistaken for "unset".
 */
export function playbackVolumeFromEnv(env = process.env) {
  const raw = env.FISHFM_PLAYBACK_VOLUME;
  if (raw === undefined || raw === '') return 0.35;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.35;
}

/**
 * How many warm holders to use, unless a caller says otherwise.
 *
 * Default is 0 (off). The 2026-11-03 real-host measurements on this machine
 * showed the pool contending with real loads: with five holders a switch took
 * 9-14 s versus 5-6 s with none, because every holder open competes with the
 * media open that the user is waiting for. The pool's original 4.6 s -> 0.45 s
 * premise no longer holds here. `FISHFM_PLAYBACK_WARM_HOLDERS=1..8` re-enables
 * it for machines where it still pays off; an explicit argument always wins.
 */
export function warmHoldersFromEnv(env = process.env) {
  const raw = env.FISHFM_PLAYBACK_WARM_HOLDERS;
  if (raw === undefined || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 8) return 0;
  return value;
}

/**
 * Real audio backend: a hidden STA PowerShell process driving WPF MediaPlayer.
 *
 * `warmHolders` is how many silent resources the host keeps open. It defaults to
 * 0: the 2026-11-03 measurements showed the pool competing with real loads on
 * this machine (9-14 s versus 5-6 s per switch), so it is opt-in now. The
 * original 2026-10-06 evidence needed five holders; see
 * docs/spikes/N20-review-fixes.md for that history. `warmResource` overrides the
 * silent resource; by default the host writes its own, because audio must never be
 * committed to this repository (AGENTS.md).
 */
export function wpfBackend({
  env = process.env, exists = existsSync, volume = null, warmHolders = null,
  warmResource = '', candidates, adaptiveWarm = null,
} = {}) {
  const effectiveVolume = volume ?? playbackVolumeFromEnv(env);
  const holders = warmHolders ?? warmHoldersFromEnv(env);
  const configured = Number(env.FISHFM_PLAYBACK_WARM_HOLDERS);
  const explicitPool = warmHolders !== null || (env.FISHFM_PLAYBACK_WARM_HOLDERS !== undefined
    && env.FISHFM_PLAYBACK_WARM_HOLDERS !== '' && Number.isInteger(configured) && configured >= 0 && configured <= 8);
  const adaptive = adaptiveWarm ?? !explicitPool;
  return {
    name: 'wpf-mediaplayer',
    volumeOverride: volume ?? (env.FISHFM_PLAYBACK_VOLUME === undefined || env.FISHFM_PLAYBACK_VOLUME === '' ? null : effectiveVolume),
    script: WPF_HOST_SCRIPT,
    candidates: candidates ?? powerShellCandidates({ env, exists }),
    extraArgs: (context) => [
      '-PipeName', context.pipeName,
      '-OwnerPid', String(context.ownerPid ?? 0),
      '-ProtocolVersion', String(context.protocol),
      '-Volume', String(effectiveVolume),
      '-WarmHolders', String(holders),
      '-AdaptiveWarm', adaptive ? '1' : '0',
      ...(warmResource ? ['-WarmResource', warmResource] : []),
    ],
  };
}

/** AVFoundation host launched through the DSH Node runtime on macOS. */
export function macBackend() {
  return {
    name: 'avfoundation',
    script: MAC_HOST_LAUNCHER_SCRIPT,
    candidates: [{ command: process.execPath, args: [], label: 'DSH Node runtime', source: 'process.execPath' }],
    extraArgs: (context) => [
      '--socket', pipePath(context.pipeName, 'darwin'),
      '--owner-pid', String(context.ownerPid ?? 0),
      '--protocol', String(context.protocol),
    ],
  };
}

export function backendForPlatform(platform = process.platform) {
  if (platform === 'win32') return wpfBackend();
  if (platform === 'darwin') return macBackend();
  throw playbackError('unsupported_platform', `Real audio playback is not supported on ${platform}`);
}

export function requireSupportedPlatform(platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) {
    throw playbackError('unsupported_platform', `Real audio playback is not supported on ${platform}`);
  }
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
