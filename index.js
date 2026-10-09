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
import { readFileSync } from 'node:fs';
import { clientArtwork } from './src/ui/artwork-assets.mjs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreBridge, registerAdapter } from './src/dsh-adapter.mjs';
import { registerSettingsApi } from './src/ui/dsh-settings.mjs';
import { createRuntimeEvidence } from './src/runtime/evidence.mjs';
import {createHostCollector} from './src/runtime/host-collector.mjs';
import {createPersonaModelService} from './src/persona-model.mjs';
import {createPersonaScheduler} from './src/persona-scheduler.mjs';

export const name = 'fishfm';

// Cordis validates a row's `config` against an exported `Config` schema, so a
// plain object here breaks activation (`Cannot read properties of undefined
// (reading 'validate')`). Deployment knobs are therefore read defensively in
// apply() and defaulted there instead of being declared as a schema.
export const inject = ['tools'];

const DEFAULT_SETTINGS = Object.freeze({
  /** Absolute path of the core entry to launch. Defaults to this package. */
  coreEntry: undefined,
  /** 'real' uses the native audio host for the current platform; 'fake' is for tests. */
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
export function registerClientAssets(ctx, { assetRoot } = {}) {
  ctx.effect(() => {
    const routes = [...clientArtwork(assetRoot).files].map(([path, file]) => {
      const body = readFileSync(file);
      return ctx.webServer.register({
        kind: 'exact', path,
        handler(req, res) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          res.writeHead(200, {
            'content-type': file.endsWith('.gif') ? 'image/gif' : 'image/png',
            'content-length': body.length,
            'cache-control': 'public, max-age=3600',
            'x-content-type-options': 'nosniff',
          });
          res.end(req.method === 'HEAD' ? undefined : body);
        },
      });
    });
    return () => routes.forEach((dispose) => dispose());
  }, 'fishfm: client artwork routes');
}

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
  // The official desktop host resolves an unset DSH_HOME to ~/.dsh without
  // exporting it to plugins. Match that convention instead of losing data.
  let home = env.DSH_HOME?.trim() ? env.DSH_HOME : join(homedir(), '.dsh');
  if (home === '~') home = homedir();
  else if (/^~[\\/]/.test(home)) home = join(homedir(), home.slice(2));
  return join(resolve(home), 'fishfm', 'music.sqlite');
}

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(config ?? {}) };
  const database = settings.database ?? defaultDatabase();
  const evidence = createRuntimeEvidence({ directory: database === ':memory:' ? null : join(dirname(database), 'runtime'), component: 'adapter', mode: settings.playback === 'real' ? 'real' : 'synthetic' });
  ctx.effect(() => () => evidence.close(), 'fishfm: runtime evidence lifecycle');
  const command = coreCommand({
    coreEntry: settings.coreEntry,
    playback: settings.playback,
    provider: settings.provider,
    database,
  });

  const bridge = new CoreBridge({
    spawnCore: () => spawn(command.command, command.args, {
      env: command.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
    onLog: (entry) => {
      evidence.event(entry);
      // Type-and-code only: no credentials, no resolved media URLs.
      try { ctx.logger?.('fishfm')?.debug?.(JSON.stringify(entry)); } catch { /* logging is optional */ }
    },
  });

  const hostCollector=createHostCollector({onLog:entry=>evidence.event(entry)});
  evidence.setHostCollector(hostCollector);
  const dispose = registerAdapter(ctx, { bridge, hostCollector, onLog: entry => evidence.event(entry) });
  const summaryService={current:null};
  if(typeof ctx.inject==='function')ctx.inject(['llm'],modelCtx=>{
    const service=createPersonaModelService({llm:modelCtx.llm,bridge,onLog:entry=>evidence.event(entry)});
    summaryService.current=service;
    modelCtx.on('llm/stream',(options,next)=>{service.observe(options);return next();});
    // The schedule is off until the user turns it on; the Core still re-checks
    // every gate when it reserves, so a stale check cannot force a call.
    const scheduler=createPersonaScheduler({bridge,service,onLog:entry=>evidence.event(entry)});
    scheduler.start();
    // 设置页"刷新新歌"后手动补跑发现候选筛选；Core 侧仍会重验每个门控。
    summaryService.discoveryFilterRun=()=>scheduler.checkDiscoveryFilter();
    let lastPipelineSignal=null;
    const offPipeline=bridge.onState(snapshot=>{
      const status=snapshot?.discovery;
      if(status?.pipeline!=='platform-filter')return;
      const signal=`${status.candidateRevision}|${status.count}|${status.remaining}|${status.filterCallId}|${snapshot.settings.listening}|${snapshot.blockUntil}`;
      if(signal===lastPipelineSignal)return;
      lastPipelineSignal=signal;
      if(status.count>0&&!status.refreshing&&!status.filtering&&(status.picked===0||status.remaining<=1))void scheduler.checkDiscoveryFilter();
    });
    modelCtx.effect(()=>()=>{offPipeline();scheduler.stop();service.dispose();if(summaryService.current===service)summaryService.current=null;delete summaryService.discoveryFilterRun;},'fishfm: optional summaries');
  });
  // Optional in headless profiles; the browser uses the host's authenticated RPC.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (uiCtx) => registerSettingsApi(uiCtx, bridge,summaryService));
    ctx.inject(['webServer'], registerClientAssets);
  }
  // Start eagerly so a failure is visible at load time, but never block apply:
  // the Harness must stay responsive even when audio is slow to come up.
  bridge.start().catch((error) => {
    try { ctx.logger?.('fishfm')?.warn?.(`music core failed to start: ${error.message}`); } catch { /* optional */ }
  });

  return () => { dispose(); evidence.close(); };
}
