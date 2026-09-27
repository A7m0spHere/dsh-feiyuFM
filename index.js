// FishFM plugin entry for the DeepSeek Harness (desktop profile).
//
// The plugin is deliberately thin: it owns the lifecycle of an independent core
// process and exposes user commands, so music never depends on the visible
// window staying open, and disabling the plugin stops music.
//
// Verified Harness contract (0.1.7-rc.2, see docs/spikes/P0-01-dsh.md):
//   - `apply(ctx, config)` with optional `inject`; register through ctx.effect
//     and ctx.on so an unload removes everything;
//   - children are started the way the host itself starts pnpm:
//     `process.execPath --expose-internals <script>` with ELECTRON_RUN_AS_NODE=1,
//     or the payload node when the plugin runs outside Electron;
//   - `session/event` delivers `{ type, seq, time, data }`.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreBridge, registerAdapter } from './src/dsh-adapter.mjs';

export const name = 'fishfm';

// Cordis validates a row's `config` against an exported `Config` schema, so a
// plain object here breaks activation (`Cannot read properties of undefined
// (reading 'validate')`). Deployment knobs are therefore read defensively in
// apply() and defaulted there instead of being declared as a schema.
export const inject = ['tools'];

const DEFAULT_SETTINGS = Object.freeze({
  /** Absolute path of the core entry to launch. Defaults to this package. */
  coreEntry: undefined,
  /** 'real' uses the WPF audio host; 'fake' is for tests. */
  playback: 'real',
  /** 'real' fails resolution honestly until a platform adapter exists. */
  provider: 'real',
  /** SQLite file; ':memory:' keeps a run disposable. */
  database: undefined,
  /**
   * Platform endpoint maps, keyed by provider. Deliberately empty by default:
   * this build ships no platform URL, so an unconfigured install reports
   * "not installed" for each platform instead of guessing at an API.
   * Deployment supplies them (see docs/spikes/P2-netease.md).
   */
  endpoints: undefined,
});

const here = dirname(fileURLToPath(import.meta.url));

/** Mirrors @deepseek-ai/dsh-desktop-host: an Electron binary used as Node. */
export function coreCommand({ coreEntry, playback = 'real', provider = 'real', database, env = process.env }) {
  const entry = coreEntry ?? join(here, 'bin', 'fishfm-core.mjs');
  const exe = env.DSH_DESKTOP_NODE_EXECUTABLE;
  const args = [];
  if (exe) args.push('--expose-internals', entry);
  else args.push(entry);
  args.push('--playback', playback, '--provider', provider);
  if (database) args.push('--db', database);
  return {
    command: exe ?? process.execPath,
    args,
    env: exe ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
  };
}

/** Default database location: beside the Harness home, never inside the repo. */
export function defaultDatabase(env = process.env) {
  const home = env.DSH_HOME;
  return home ? join(home, 'fishfm', 'music.sqlite') : ':memory:';
}

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(config ?? {}) };
  const command = coreCommand({
    coreEntry: settings.coreEntry,
    playback: settings.playback,
    provider: settings.provider,
    database: settings.database ?? defaultDatabase(),
  });

  const bridge = new CoreBridge({
    spawnCore: () => spawn(command.command, command.args, {
      env: command.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
    onLog: (entry) => {
      // Type-and-code only: no credentials, no resolved media URLs.
      try { ctx.logger?.('fishfm')?.debug?.(JSON.stringify(entry)); } catch { /* logging is optional */ }
    },
  });

  const dispose = registerAdapter(ctx, { bridge });
  // Start eagerly so a failure is visible at load time, but never block apply:
  // the Harness must stay responsive even when audio is slow to come up.
  bridge.start().catch((error) => {
    try { ctx.logger?.('fishfm')?.warn?.(`music core failed to start: ${error.message}`); } catch { /* optional */ }
  });

  return dispose;
}