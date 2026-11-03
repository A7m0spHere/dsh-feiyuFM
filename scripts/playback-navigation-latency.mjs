#!/usr/bin/env node
// Opt-in measurement: a NEW real DSH Web profile, real WPF, silent local media,
// and headless Chrome. This does not operate the user's Desktop or music data.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { writeTone } from './make-tone.mjs';
import { DatabaseSync } from 'node:sqlite';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const repo = resolve(arg('--repo', resolve(import.meta.dirname, '..')));
const runtimeNode = arg('--runtime-node', 'D:/dsh/DeepSeek Harness.exe');
const runtime = arg('--runtime-root', 'D:/dsh/resources/app.asar/dsh');
const chromePath = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const realProvider = process.argv.includes('--real-provider');
const sourceDatabase = resolve(arg('--source-db', 'C:/Users/86137/.dsh/fishfm/music.sqlite'));
const fixedTrackId = arg('--track-id', null);
const naturalOnly = process.argv.includes('--natural-only');
const onlyNext = process.argv.includes('--only-next');
if (naturalOnly && (!realProvider || !fixedTrackId)) throw new Error('--natural-only requires --real-provider and --track-id');
const output = arg('--out', null);
if (!output || process.platform !== 'win32') throw new Error('Pass --out <NEW directory>; Windows WPF is required');
const out = resolve(output), home = join(out, 'home'), workspace = join(out, 'workspace');
if (existsSync(out)) throw new Error('Output must be a new directory');
mkdirSync(workspace, { recursive: true });
const report = { schema: 1, measuredAt: new Date().toISOString(), scope: realProvider ? 'real-dsh-web-wpf-netease-muted' : 'real-dsh-web-wpf-local-silent-media',
  realPlatformAudio: realProvider ? 'started' : 'not_executed', nativeDesktop: 'not_executed', interaction: 'programmatic-DOM-click', scenarios: [], sourceHashes: {} };
for (const file of ['src/core.mjs', 'src/core-host.mjs', 'src/ui/dsh-client.js', 'src/playback/service.mjs', 'src/playback/transport.mjs', 'src/playback/host/wpf-media-host.ps1']) {
  report.sourceHashes[file] = createHash('sha256').update(readFileSync(join(repo, file))).digest('hex');
}
const save = () => writeFileSync(join(out, 'timings.json'), JSON.stringify(report, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 45000) { const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw new Error('Timed out: ' + (last?.message ?? 'condition'));
}
async function freePort() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise(r => server.close(r)); return port; }
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_DESKTOP_NODE_EXECUTABLE: runtimeNode,
  FISHFM_ACCEPTANCE_MEDIA: join(out, 'silent.wav'), FISHFM_ACCEPTANCE_WORKSPACE: workspace, FISHFM_PLAYBACK_WARM_HOLDERS: '0' };
env.FISHFM_PLAYBACK_VOLUME = '0';
function command(args) { const r = spawnSync(runtimeNode, args, { env, windowsHide: true, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) { writeFileSync(join(out, 'subprocess-private.log'), `${r.stdout}\n${r.stderr}`); throw new Error(`Subprocess failed: ${r.status ?? r.error?.code}`); } return r.stdout; }
let host, chrome, socket, hostLog = '', baseUrl, cookie, cdp, evaluate;
async function rpc(method, payload = {}) {
  const response = await fetch(`${baseUrl}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(method === 'fishfm-acceptance' ? payload : { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }), signal: AbortSignal.timeout(30000) });
  const json = await response.json(), result = json.result ?? json;
  if (!result.ok) throw new Error(`RPC ${method}: ${result.error?.code}`); return result.value;
}
const state = () => rpc('fishfm/state', { playbackOnly: true });
const control = (type, value) => rpc('fishfm/command', { type, ...(value === undefined ? {} : { value }) });
try {
  const fixture = join(repo, 'scripts/fixtures/dsh-acceptance');
  report.setup = JSON.parse(command([join(fixture, 'setup.cjs'), runtime, home, repo]).trim().split('\n').at(-1));
  if (realProvider) {
    const isolatedDb = join(home, 'fishfm/music.sqlite');
    mkdirSync(join(home, 'fishfm'), { recursive: true });
    const original = new DatabaseSync(sourceDatabase, { readOnly: true });
    try { original.exec("VACUUM INTO '" + isolatedDb.replace(/'/g, "''") + "'"); } finally { original.close(); }
    cpSync('C:/Users/86137/.dsh/fishfm/credentials', join(home, 'fishfm/credentials'), { recursive: true });
    // Only the disposable copy is changed. Disable all model/discovery work;
    // keep the existing approved pool, preferences and ordinary next policy.
    const { MusicStore } = await import(new URL('../src/storage.mjs', import.meta.url));
    const isolated = new MusicStore(isolatedDb);
    try {
      isolated.setSetting('summary_daily_tokens', 0); isolated.setSetting('summary_automatic', false);
      const saved = isolated.getCoreState();
      if (saved?.settings) { saved.settings.discovery = false; saved.settings.discoveryRate = 0; isolated.setCoreState(saved); }
      if (naturalOnly) {
        const row = isolated.db.prepare('SELECT provider,provider_track_id,title,artist,duration_ms FROM tracks WHERE track_key=?').get(`netease:${fixedTrackId}`);
        if (!saved || !row?.duration_ms) throw new Error('A saved Core state and known duration are required for near-end resume');
        saved.current = { ...(saved.current??{}), track: { provider:row.provider,providerTrackId:row.provider_track_id,title:row.title,artist:row.artist,durationMs:row.duration_ms },
          playInstanceId:crypto.randomUUID(),selectedBy:'user',decisionId:null,positionMs:Math.max(0,row.duration_ms-15000),effectiveMs:0,agentEffectiveMs:0,audibleMs:0,
          progressSource:'audio',agentListening:false,audible:false,finished:false,startedAt:null,sessionId:null,sessionTransient:false,selectionPool:'user',selectionTrigger:'user-track',origin:null };
        saved.paused=true; saved.status='paused'; isolated.setCoreState(saved);
        report.scope='real-dsh-web-wpf-netease-muted-near-end-resume';
        report.nearEndFixture={remainingMediaMs:15000,source:'isolated saved position, normal resume and real media-ended event'};
      }
    } finally { isolated.close(); }
    command(['-e', `const fs=require('node:fs'),p=require('node:path'),{createRequire}=require('node:module');const req=createRequire(p.join(${JSON.stringify(runtime)},'package.json')),y=req('js-yaml'),file=${JSON.stringify(join(home, 'acceptance.patch.yml'))};const rows=y.load(fs.readFileSync(file,'utf8'));const f=rows.find(r=>r.id==='fishfm');f.config.provider='real';f.config.coreEntry=${JSON.stringify(join(repo, 'bin/fishfm-core.mjs'))};fs.writeFileSync(file,y.dump(rows));`]);
    report.snapshotSource = 'read-only VACUUM INTO and same-user DPAPI ciphertext copy';
    report.sourceDatabaseHash = createHash('sha256').update(readFileSync(sourceDatabase)).digest('hex');
  }
  writeFileSync(join(out, 'install.log'), command([join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'plugin', '--profile', 'fishfm-acceptance', 'add', repo, '--offline']));
  // The isolated provider's declared duration and real media agree. A 30s file
  // permits 20s preparation plus a natural-end observation in the same run.
  writeTone({ path: env.FISHFM_ACCEPTANCE_MEDIA, seconds: 30, amplitude: 0 });
  const port = await freePort();
  host = spawn(runtimeNode, [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'fishfm-acceptance', '--patch', join(home, 'acceptance.patch.yml'), '--no-open', '--port', String(port)],
    { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  report.hostPid = host.pid;
  for (const stream of [host.stdout, host.stderr]) stream.on('data', b => { hostLog += b; writeFileSync(join(out, 'host-private.log'), hostLog); });
  const launch = await until(() => { const m = hostLog.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\u001b]*/); return m ? new URL(m[0]) : null; });
  baseUrl = launch.origin;
  const token = launch.searchParams.get('token') ?? launch.searchParams.get('auth');
  const exchange = await fetch(`${baseUrl}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  cookie = exchange.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  await until(async () => (await state()).snapshot);
  await control('setHumanPlayback', false); await control('setDiscovery', false); await control('setDiscoveryRate', 0);
  const debugPort = await freePort();
  report.debugPort = debugPort; save();
  chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio', '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let seq = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (!m.id) return; const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); };
  cdp = (method, params = {}) => new Promise((resolveCall, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 35000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await cdp('Network.enable');
  for (const item of cookie.split('; ')) { const i = item.indexOf('='); await cdp('Network.setCookie', { name: item.slice(0, i), value: item.slice(i + 1), url: baseUrl }); }
  await cdp('Page.navigate', { url: baseUrl });
  await cdp('Page.bringToFront');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until(async () => evaluate(`!!document.querySelector('body') && document.body.innerText.includes('肥鱼')`));
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='继续');if(b)b.click();return true})()`);
  // Open the real installed FeiyuFM panel through the host sidebar.
  await evaluate(`(()=>{const all=[...document.querySelectorAll('button,[role=button]')];const b=all.find(e=>e.getAttribute('aria-label')?.includes('肥鱼')||e.title?.includes('肥鱼')||e.textContent.trim()==='肥鱼电台');if(b)b.click();return all.map(e=>({text:e.textContent.trim().slice(0,40),label:e.getAttribute('aria-label'),title:e.title}));})()`)
    .then(v => { report.sidebar = v; save(); });
  await until(async () => evaluate(`!!document.querySelector('.fishfm')`));
  const attached = await evaluate(`(()=>{for(const el of document.querySelectorAll('.fishfm,.fm-float,[class*=fm-]')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let f=el[key],n=0;f&&n++<35;f=f.return){const c=f.memoizedProps?.controller;if(c?.command&&c?.getSnapshot){window.__fishfmTimingController=c;return true}}}return false})()`);
  if (!attached) throw new Error('Could not inspect the actual mounted controller');
  await evaluate(`(()=>{window.__fishfmTimings=[];const c=window.__fishfmTimingController;let last=null;const at=()=>({at:Date.now(),monotonicMs:performance.now()});c.subscribe(()=>{const s=c.getSnapshot().snapshot;if(!s)return;const id=s.current?.playInstanceId;if(id&&id!==last?.id)window.__fishfmTimings.push({phase:'ui-current',playInstanceId:id,version:s.commandVersion,...at()});if(s.status==='playing'&&(last?.status!=='playing'||id!==last.id))window.__fishfmTimings.push({phase:'ui-playing',playInstanceId:id,version:s.commandVersion,...at()});last={id,status:s.status}});const original=c.command.bind(c);c.command=async function(type,value){window.__fishfmTimings.push({phase:'ui-click',kind:type,...at()});const r=await original(type,value);window.__fishfmTimings.push({phase:'command-returned',kind:type,...at()});return r};return true})()`);
  report.onboardingOverlay = await evaluate(`!!document.querySelector('[class*="_mask_"]')`);
  await evaluate(`(()=>{let previousId=null,previousPlaying=false,queued=false;const capture=()=>{queued=false;const s=window.__fishfmTimingController.getSnapshot().snapshot,id=s?.current?.playInstanceId,title=document.querySelector('.fishfm .fm-track')?.textContent?.trim(),label=document.querySelector('.fishfm .fm-live')?.textContent?.trim();if(!id||title!==s.current.track.title)return;const detail={playInstanceId:id,version:s.commandVersion,at:Date.now(),monotonicMs:performance.now()};if(id!==previousId)window.__fishfmTimings.push({phase:'dom-current',...detail});const playing=s.status==='playing'&&/静音播放|正在播放|正在听/.test(label);if(playing&&(!previousPlaying||id!==previousId))window.__fishfmTimings.push({phase:'dom-playing',...detail});previousId=id;previousPlaying=playing;};const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(capture)}});observer.observe(document.querySelector('.fishfm'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-busy','data-state']});capture();return true})()`);
  const waitPlaying = async previous => until(async () => { const s = (await state()).snapshot; return s.status === 'playing' && s.current && (!previous || s.current.playInstanceId !== previous) ? s : null; });
  const waitUIPlaying = instance => until(async () => {
    const s = await evaluate(`(()=>{const s=window.__fishfmTimingController.getSnapshot().snapshot;return {status:s.status,instance:s.current?.playInstanceId}})()`);
    return s.status === 'playing' && s.instance === instance;
  });
  const clickTransport = async (kind, wait = true) => {
    const started = Date.now();
    await evaluate(`(()=>{const b=[...document.querySelectorAll('.fishfm .fm-transport')].find(e=>e.textContent.trim()===${JSON.stringify(kind === 'next' ? '下一首' : '上一首')});if(!b||b.disabled)throw new Error('Transport button unavailable');b.click();return true})()`);
    if (wait) await until(() => evaluate(`window.__fishfmTimings.some(e=>e.phase==='command-returned'&&e.kind===${JSON.stringify(kind)}&&e.at>=${started})`));
  };
  for (const seconds of naturalOnly?[]:arg('--delays', '1,4,10,20').split(',').map(Number)) {
    report.stage = `next-after-${seconds}s:starting`; save();
    let track = realProvider ? ((await state()).snapshot.current?.track ?? (await rpc('fishfm/state', { minimal: true })).library?.firstTrack)
      : { provider: 'netease', providerTrackId: 'acceptance-1', title: 'Acceptance 1', artist: 'Fixture 1', durationMs: 30000 };
    if (realProvider && fixedTrackId) {
      const db = new DatabaseSync(join(home, 'fishfm/music.sqlite'), { readOnly: true });
      try { const row = db.prepare('SELECT provider, provider_track_id, title, artist, duration_ms FROM tracks WHERE track_key = ?').get(`netease:${fixedTrackId}`);
        if (!row) throw new Error('The selected bootstrap track is absent from the isolated database');
        track = { provider: row.provider, providerTrackId: row.provider_track_id, title: row.title, artist: row.artist, durationMs: row.duration_ms };
      } finally { db.close(); }
    }
    if (!track) throw new Error('No isolated platform track is available');
    await rpc('fishfm/command', { type: 'requestTrack', track });
    const before = await waitPlaying();
    report.pendingInstance = before.current.playInstanceId;
    report.initialUI = await evaluate(`({hidden:document.hidden,status:window.__fishfmTimingController.getSnapshot().snapshot.status,instance:window.__fishfmTimingController.getSnapshot().snapshot.current?.playInstanceId})`);
    report.stage = `next-after-${seconds}s:waiting-initial-ui`; save();
    await waitUIPlaying(before.current.playInstanceId);
    await pause(seconds * 1000);
    const start = Date.now();
    report.stage = `next-after-${seconds}s:clicking`; save();
    await clickTransport('next');
    report.stage = `next-after-${seconds}s:waiting-target-core`; save();
    const after = await waitPlaying(before.current.playInstanceId);
    await waitUIPlaying(after.current.playInstanceId);
    const traces = await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`);
    report.scenarios.push({ name: `next-after-${seconds}s`, startedAt: start, playingObservedAt: Date.now(), before: before.current.playInstanceId, after: after.current.playInstanceId, ...traces }); save();
    if (realProvider) report.realPlatformAudio = 'measured-muted';
    console.log(`measured next-after-${seconds}s`);
  }
  let naturalSourceInstance=null;
  if (!naturalOnly&&!onlyNext) {
  report.stage='rapid-next';save();
  const beforeRapid = (await state()).snapshot.current.playInstanceId;
  await evaluate(`(()=>{const c=window.__fishfmTimingController;for(let i=0;i<4;i++)c.command('next');return true})()`);
  const rapidAfter = await waitPlaying(beforeRapid); await waitUIPlaying(rapidAfter.current.playInstanceId);
  report.scenarios.push({ name: 'rapid-next', before: beforeRapid, after: rapidAfter.current.playInstanceId,
    ...await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`) }); save();
  // GUI sequential clicks: the controller-call burst above can be merged by the
  // UI's own dedupe, so real button presses are measured separately.
  report.stage='rapid-gui-next';save();
  const beforeGuiRapid = (await state()).snapshot.current.playInstanceId;
  const clickNext = () => evaluate(`(()=>{const b=[...document.querySelectorAll('.fishfm .fm-transport')].find(e=>e.textContent.trim()==='下一首');if(!b||b.disabled)return false;b.click();return true})()`);
  let acceptedClicks = 0;
  // A burst while the first switch is pending: the UI disables the button, so
  // only clicks the user could actually make are counted.
  for (let i = 0; i < 4; i += 1) { if (await clickNext()) acceptedClicks += 1; await pause(60); }
  // Sequential accepted switches: wait until the button is enabled again.
  for (let i = 0; i < 2; i += 1) {
    await until(() => evaluate(`(()=>{const b=[...document.querySelectorAll('.fishfm .fm-transport')].find(e=>e.textContent.trim()==='下一首');return !!b&&!b.disabled})()`), 20000);
    if (await clickNext()) acceptedClicks += 1;
    await pause(250);
  }
  const guiRapidAfter = await waitPlaying(beforeGuiRapid); await waitUIPlaying(guiRapidAfter.current.playInstanceId);
  report.scenarios.push({ name: 'rapid-gui-next', before: beforeGuiRapid, after: guiRapidAfter.current.playInstanceId, acceptedClicks,
    ...await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`) }); save();
  // next followed immediately by pause: the accepted switch must not revive playback.
  report.stage='next-then-pause';save();
  const beforeNextPause = (await state()).snapshot.current.playInstanceId;
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.fishfm .fm-transport')].find(e=>e.textContent.trim()==='下一首');if(!b||b.disabled)throw new Error('Transport button unavailable');b.click();return true})()`);
  await pause(120);
  await evaluate(`(()=>{const b=document.querySelector('.fishfm .fm-primary.fm-transport');if(!b||b.disabled)throw new Error('Pause button unavailable');b.click();return true})()`);
  const pausedAfterNext = await until(async () => { const s = (await state()).snapshot; return s.paused && s.status !== 'playing' ? s : null; }, 15000);
  await pause(600);
  const stillPaused = (await state()).snapshot;
  report.scenarios.push({ name: 'next-then-pause', before: beforeNextPause, after: pausedAfterNext.current?.playInstanceId ?? null,
    paused: stillPaused.paused === true && stillPaused.status !== 'playing',
    ...await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`) }); save();
  await control('resume');
  const resumedAfterPause = await waitPlaying();
  await waitUIPlaying(resumedAfterPause.current.playInstanceId);
  const historyBefore = (await state()).snapshot.current.track.providerTrackId;
  report.stage='history-back';save();
  const backInstance = (await state()).snapshot.current.playInstanceId;
  await clickTransport('previous'); const back = await waitPlaying(backInstance); await waitUIPlaying(back.current.playInstanceId);
  const historyBack = (await state()).snapshot.current.track.providerTrackId;
  report.stage='history-forward';save();
  await clickTransport('next'); const forward = await waitPlaying(back.current.playInstanceId); await waitUIPlaying(forward.current.playInstanceId);
  const historyForward = (await state()).snapshot.current.track.providerTrackId;
  report.scenarios.push({ name: 'history-forward', after: forward.current.playInstanceId, historyBefore, historyBack, historyForward, correct: historyBefore === historyForward,
    ...await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`) }); save();
  } else if(naturalOnly) {
    naturalSourceInstance=(await state()).snapshot.current.playInstanceId;
    await control('resume'); const resumed=await waitPlaying();
    report.nearEndFixture.actualCorePositionMs=resumed.current.positionMs;
    if(resumed.current.positionMs<resumed.current.track.durationMs-20000)throw new Error('Native resume has not confirmed a seek near the media end');
    const loaded=await until(()=>JSON.parse(readFileSync(join(home,'fishfm/runtime/core.json'),'utf8')).events.find(e=>e.type==='loaded'&&e.playInstanceId===naturalSourceInstance),20000);
    report.nearEndFixture.hostLoadedPositionMs=loaded.positionMs;
    if(loaded.positionMs<resumed.current.track.durationMs-20000)throw new Error('The native load result did not confirm the requested seek');
  }
  const beforeNatural = naturalSourceInstance??(await state()).snapshot.current.playInstanceId;
  const naturalStart = Date.now();
  if (realProvider && !process.argv.includes('--wait-natural')) report.scenarios.push({ name: 'natural-end', status: 'not_executed_remote_duration', reason: 'Pass --wait-natural to wait for the complete remote song; local-media natural-end is measured separately.' });
  else {
    report.stage='natural-end';save();
    const natural = await until(async () => { const s = (await state()).snapshot; return s.status === 'playing' && s.current?.playInstanceId !== beforeNatural ? s : null; }, realProvider ? 600000 : 45000);
    await waitUIPlaying(natural.current.playInstanceId);
    // A load/autoplay reply can project "playing" before the progress-confirmed
    // native started event. Do not stop the host until that event was flushed.
    await until(() => {
      const evidence=JSON.parse(readFileSync(join(home,'fishfm/runtime/core.json'),'utf8'));
      return evidence.events.some(e=>e.type==='playback'&&e.event==='started'&&e.playInstanceId===natural.current.playInstanceId);
    },30000);
    report.scenarios.push({ name: 'natural-end', before: beforeNatural, after: natural.current.playInstanceId, observationStartedAt: naturalStart, playingObservedAt: Date.now(),
      ...await evaluate(`({observed:window.__fishfmTimings.splice(0),controller:window.__fishfmTimingController.getPlaybackTrace?.()??null})`) });
  }
  await control('pause');
  const coreReport = JSON.parse(readFileSync(join(home, 'fishfm/runtime/core.json'), 'utf8'));
  report.coreEvents = coreReport.events; report.corePid = coreReport.pid; report.coreStartedAt = coreReport.startedAt;
  report.plugin = await rpc('fishfm-acceptance', { op: 'status' });
  report.loadedCode = { isolatedNewCore: coreReport.startedAt >= new Date(report.measuredAt).getTime(), sourceHashesUnchanged: Object.entries(report.sourceHashes).every(([file, hash]) => createHash('sha256').update(readFileSync(join(repo, file))).digest('hex') === hash), installedFromSelectedRepo: report.setup.initialized };
  save();
} catch (error) { report.error = { name: error.name, message: error.message }; process.exitCode = 1; console.error(error.message);
  try { report.failedUI = await evaluate(`({state:window.__fishfmTimingController?.getSnapshot(),text:document.body.innerText.slice(-1000),observed:window.__fishfmTimings})`); } catch { /* page may not exist */ }
}
finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await pause(300); }
  if (host && host.exitCode === null) {
    try {
      await rpc('fishfm-acceptance', { op: 'toggle', disabled: true });
      try { await until(()=>JSON.parse(readFileSync(join(home,'fishfm/runtime/core.json'),'utf8')).closed===true,15000); report.closeConfirmed=true; }
      catch { report.closeConfirmed=false; }
      await rpc('fishfm-acceptance', { op: 'shutdown' }); await until(() => host.exitCode !== null, 10000);
    }
    catch { if (host.exitCode === null) host.kill(); }
  }
  const evidencePath = join(home, 'fishfm/runtime/core.json');
  if (existsSync(evidencePath)) { const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')); report.coreEvents = evidence.events;
    report.coreClosed = evidence.closed; report.corePid = evidence.pid;
    report.loadedCode??={isolatedNewCore:evidence.startedAt>=Date.parse(report.measuredAt),
      sourceHashesUnchanged:Object.entries(report.sourceHashes).every(([file,hash])=>createHash('sha256').update(readFileSync(join(repo,file))).digest('hex')===hash),
      installedFromSelectedRepo:report.setup?.initialized===true};
  }
  report.finishedAt = new Date().toISOString(); save();
  rmSync(env.FISHFM_ACCEPTANCE_MEDIA, { force: true });
  const credentialCopy = join(home, 'fishfm/credentials');
  const credentialRelative = relative(out, resolve(credentialCopy));
  if (realProvider && credentialRelative && !credentialRelative.startsWith('..') && !isAbsolute(credentialRelative)) rmSync(credentialCopy, { recursive: true, force: true });
  // The profile and diagnostic logs are intentionally kept as the evidence.
  console.log(JSON.stringify({ output: join(out, 'timings.json'), scenarios: report.scenarios.length, error: report.error ?? null }));
}
