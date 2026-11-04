// Opt-in real DSH installation + installed client initialization probe.
// No production profile, credentials, model calls or audio playback.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const out = resolve(arg('--out', '')), source = arg('--package', null);
if (!source || !arg('--out', null) || existsSync(out)) throw new Error('Pass --package <tgz> --out <NEW directory>');
const repo = resolve(import.meta.dirname, '../..');
const runtime = arg('--runtime-root', 'D:/dsh/resources/app.asar/dsh');
const runtimeNode = arg('--runtime-node', 'D:/dsh/DeepSeek Harness.exe');
const home = join(out, 'home'), workspace = join(out, 'workspace');
mkdirSync(workspace, { recursive: true });
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_DESKTOP_NODE_EXECUTABLE: runtimeNode };
const report = { date: new Date().toISOString(), scope: 'real-isolated-dsh-installed-client', checks: [], network: [] };
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await pause(250); } throw new Error('Probe condition timed out'); }
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function command(args) { const r = spawnSync(runtimeNode, args, { env, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 }); if (r.status !== 0) { writeFileSync(join(out, 'subprocess-private.log'), r.stdout + r.stderr); throw new Error(`Subprocess failed: ${r.status ?? r.error?.code}`); } return r.stdout; }
let host, chrome, socket, cookie, baseUrl, log = '', evaluate, cdp;
async function rpc(method, payload = {}) {
  const start = Date.now();
  const r = await fetch(`${baseUrl}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(method === 'fishfm-acceptance' ? payload : { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }), signal: AbortSignal.timeout(25000) });
  const json = await r.json(); return { http: r.status, ms: Date.now() - start, result: json.result };
}
try {
  report.setup = JSON.parse(command([join(repo, 'scripts/fixtures/dsh-acceptance/setup.cjs'), runtime, home, repo]).trim().split('\n').at(-1));
  // Keep only a teardown probe. Plugin config uses the installed production defaults.
  // A fixture inside this repository inherits its dsh.client manifest. Keep it
  // in its own package so the host cannot discover the checkout's client too.
  const probeRoot = join(out, 'private-probe'); mkdirSync(probeRoot);
  cpSync(join(repo, 'scripts/fixtures/dsh-acceptance/probe.mjs'), join(probeRoot, 'index.mjs'));
  writeFileSync(join(probeRoot, 'package.json'), JSON.stringify({ name: 'feiyufm-initialization-probe', private: true, type: 'module' }));
  command(['-e', `const fs=require('node:fs'),p=require('node:path'),{createRequire}=require('node:module');const y=createRequire(p.join(${JSON.stringify(runtime)},'package.json'))('js-yaml');const f=${JSON.stringify(join(home, 'acceptance.patch.yml'))};fs.writeFileSync(f,y.dump([{id:'session-title-llm',disabled:true},{insert:[{id:'fishfm-acceptance-probe',name:${JSON.stringify(pathToFileURL(join(probeRoot, 'index.mjs')).href)}}]}]));`]);
  const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  writeFileSync(join(out, 'install-private.log'), command([cli, 'plugin', '--profile', 'fishfm-acceptance', 'add', resolve(source), ...(process.argv.includes('--online') ? [] : ['--offline'])]));
  report.install = JSON.parse(command(['-e', `const{createRequire}=require('node:module'),p=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');const req=createRequire(${JSON.stringify(join(home, 'profiles/fishfm-acceptance/package.json'))}),root=p.dirname(req.resolve('dsh-feiyufm/package.json'));console.log(JSON.stringify({root,version:req('dsh-feiyufm/package.json').version,clientHash:crypto.createHash('sha256').update(fs.readFileSync(p.join(root,'src/ui/dsh-client.js'))).digest('hex'),manifest:JSON.parse(fs.readFileSync(${JSON.stringify(join(home, 'profiles/fishfm-acceptance/package.json'))},'utf8'))}));`]).trim());
  report.tarballSha256 = createHash('sha256').update(readFileSync(resolve(source))).digest('hex'); save();
  const installedRelative = relative(home, report.install.root);
  if (!installedRelative || installedRelative.startsWith('..') || isAbsolute(installedRelative)) throw new Error('Installed package escaped the isolated profile');
  if (process.argv.includes('--missing-dependency')) {
    command(['-e', `const fs=require('node:fs'),p=require('node:path');const d=p.join(${JSON.stringify(report.install.root)},'node_modules/@neteasecloudmusicapienhanced/api');fs.renameSync(d,d+'.probe-disabled');`]);
    report.missingDependency = '@neteasecloudmusicapienhanced/api';
  }
  if (arg('--database-from', null)) {
    command(['-e', `const fs=require('node:fs'),p=require('node:path'),{DatabaseSync}=require('node:sqlite');const dir=${JSON.stringify(join(home, 'fishfm'))};fs.mkdirSync(dir,{recursive:true});const d=new DatabaseSync(${JSON.stringify(resolve(arg('--database-from', null)))},{readOnly:true});d.prepare('VACUUM INTO ?').run(p.join(dir,'music.sqlite'));d.close();`]);
    report.retainedDatabase = 'read-only SQLite snapshot; credentials not copied';
  }
  if (process.argv.includes('--reinstall')) {
    const db = join(home, 'fishfm/music.sqlite');
    const before = createHash('sha256').update(readFileSync(db)).digest('hex');
    command([cli, 'plugin', '--profile', 'fishfm-acceptance', 'remove', 'dsh-feiyufm']);
    command([cli, 'plugin', '--profile', 'fishfm-acceptance', 'add', resolve(source), ...(process.argv.includes('--online') ? [] : ['--offline'])]);
    report.databasePreservedAcrossReinstall = before === createHash('sha256').update(readFileSync(db)).digest('hex');
    if (!report.databasePreservedAcrossReinstall) throw new Error('Reinstall changed retained database');
  }
  host = spawn(runtimeNode, [cli, '--profile', 'fishfm-acceptance', '--patch', join(home, 'acceptance.patch.yml'), '--no-open', '--port', String(await port())], { env, cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const s of [host.stdout, host.stderr]) s.on('data', b => { log += b; writeFileSync(join(out, 'host-private.log'), log); });
  const launch = await until(() => { const m = log.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\u001b]*/); return m ? new URL(m[0]) : null; });
  baseUrl = launch.origin;
  const exchange = await fetch(`${baseUrl}/?token=${encodeURIComponent(launch.searchParams.get('token') ?? launch.searchParams.get('auth'))}`, { redirect: 'manual' });
  cookie = exchange.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const initial = await rpc('fishfm/state', { minimal: true });
  report.rpc = { http: initial.http, ms: initial.ms, ok: initial.result?.ok, error: initial.result?.error,
    snapshot: !!initial.result?.value?.snapshot, neteaseInstalled: initial.result?.value?.platforms?.netease?.installed, libraryTotal: initial.result?.value?.library?.total }; save();
  chrome = spawn(arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${await port()}`, `--user-data-dir=${join(out, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio', '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Chrome prints the selected debugger port even with a caller-selected port.
  let chromeLog = ''; chrome.stderr.on('data', b => { chromeLog += b; });
  const debuggerUrl = await until(() => chromeLog.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/)?.[0]);
  const targets = await (await fetch(`http://${new URL(debuggerUrl).host}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let seq = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (!m.id) { if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/fishfm/')) report.network.push({ path: new URL(m.params.response.url).pathname, status: m.params.response.status }); return; } const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); };
  cdp = (method, params = {}) => new Promise((r, j) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); j(new Error(`CDP ${method} timed out`)); }, 30000); pending.set(id, { resolve: r, reject: j, timer }); socket.send(JSON.stringify({ id, method, params })); });
  evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('Browser evaluation failed'); return r.result.value; };
  await cdp('Network.enable');
  for (const item of cookie.split('; ')) { const i = item.indexOf('='); await cdp('Network.setCookie', { name: item.slice(0, i), value: item.slice(i + 1), url: baseUrl }); }
  await cdp('Page.navigate', { url: baseUrl });
  await until(() => evaluate(`!!document.body?.innerText.includes('肥鱼')`));
  const clickButton = async (label, selector = 'button') => {
    report.stage = `click:${label}`; save();
    const point = await until(() => evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)return null;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&b.contains(document.elementFromPoint(x,y))?{x,y}:null})()`), 8000);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  try {
    await until(() => evaluate(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='继续'&&e.getClientRects().length)`), 15000);
    await clickButton('继续');
    await until(() => evaluate(`![...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='继续'&&e.getClientRects().length)`));
    report.hostPreviewDismissed = true;
  } catch (error) {
    if (!error.message.includes('condition timed out')) throw error;
    report.hostPreviewDismissed = false;
  }
  // The host follows its preview notice with an optional DeepSeek sign-in
  // prompt. Dismiss via its own Close control; do not supply any host account.
  try {
    await until(() => evaluate(`!![...document.querySelectorAll('h2')].find(e=>e.textContent.trim()==='开始使用'&&e.getClientRects().length)`), 5000);
    await clickButton('关闭');
    await until(() => evaluate(`![...document.querySelectorAll('h2')].some(e=>e.textContent.trim()==='开始使用'&&e.getClientRects().length)`));
    report.optionalHostSignInDismissed = true;
  } catch (error) { if (!error.message.includes('condition timed out')) throw error; }
  // Let the new host finish its initial workspace/navigation restoration before
  // selecting the plugin panel; otherwise that host update can replace the page.
  await pause(20000);
  await clickButton('肥鱼电台', 'button,[role=button]');
  await until(() => evaluate(`!!document.querySelector('.fishfm')?.getClientRects().length`));
  await clickButton('电台设置', '.fishfm button');
  await until(() => evaluate(`!![...document.querySelectorAll('.fishfm button')].find(e=>e.textContent.trim()==='电台设置'&&e.getAttribute('aria-pressed')==='true')`));
  await evaluate(`(()=>{const s=[...document.querySelectorAll('.fishfm summary')].find(e=>e.textContent.includes('音乐平台'));if(s&&!s.parentElement.open)s.click();return true})()`);
  await pause(300);
  if (!await evaluate(`!!document.querySelector('.fishfm .fm-platform')?.getClientRects().length`)) throw new Error('Platform section is not visible');
  report.ui = await evaluate(`(()=>{let c;for(const el of document.querySelectorAll('.fishfm,.fm-float')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let f=el[key],n=0;f&&n++<35;f=f.return){if(f.memoizedProps?.controller){c=f.memoizedProps.controller;break}}if(c)break}window.__fishfmProbeController=c;const s=c?.getSnapshot();return {hasController:!!c,connected:s?.connected,hasSnapshot:!!s?.snapshot,error:s?.error,neteaseInstalled:s?.platforms?.netease?.installed,platformText:document.querySelector('.fm-platform')?.innerText,loginButtons:[...document.querySelectorAll('.fishfm button')].filter(b=>b.textContent==='扫码登录').map(b=>{const r=b.getBoundingClientRect();return {disabled:b.disabled,visible:b.getClientRects().length>0,clickable:!b.disabled&&!!r.width&&!!r.height&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}),initializationTrace:c?.getInitializationTrace?.()}})()`);
  report.clientMatchesInstalled = Boolean(report.ui.initializationTrace) === readFileSync(join(report.install.root, 'src/ui/dsh-client.js'), 'utf8').includes('getInitializationTrace');
  if (!report.clientMatchesInstalled) throw new Error('Mounted client differs from installed package');
  if (process.argv.includes('--recover-dependency')) {
    if (!process.argv.includes('--missing-dependency')) throw new Error('--recover-dependency requires --missing-dependency');
    command(['-e', `const fs=require('node:fs'),p=require('node:path');const d=p.join(${JSON.stringify(report.install.root)},'node_modules/@neteasecloudmusicapienhanced/api');fs.renameSync(d+'.probe-disabled',d);`]);
    await clickButton('重新连接', '.fishfm button');
    await until(() => evaluate(`window.__fishfmProbeController.getSnapshot().connected`));
    report.recovery = await evaluate(`(()=>{const s=window.__fishfmProbeController.getSnapshot();return {connected:s.connected,hasSnapshot:!!s.snapshot,error:s.error,loginButton:[...document.querySelectorAll('.fishfm button')].some(b=>b.textContent==='扫码登录'&&!b.disabled&&b.getClientRects().length>0)}})()`);
  }
  if (process.argv.includes('--qr') && report.ui.loginButtons.some(b => !b.disabled)) {
    await clickButton('扫码登录', '.fishfm button');
    await until(() => evaluate(`!window.__fishfmProbeController.getSnapshot().platformBusy`), 35000);
    report.qr = await evaluate(`(()=>{const s=window.__fishfmProbeController.getSnapshot();return {status:s.login?.status,qrImage:!!document.querySelector('.fm-login img')?.src?.startsWith('data:image/png'),errorCode:s.errorCode,error:s.error}})()`);
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, 'panel.png'), Buffer.from(shot.data, 'base64')); save();
  console.log(JSON.stringify({ out, rpc: report.rpc, ui: { connected: report.ui.connected, platformText: report.ui.platformText,
    loginButtons: report.ui.loginButtons }, clientMatchesInstalled: report.clientMatchesInstalled, qr: report.qr, recovery: report.recovery }));
} catch (error) {
  report.failure = { name: error.name, message: error.message }; process.exitCode = 1; console.error(error.message);
  try { const shot = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, 'failure-private.png'), Buffer.from(shot.data, 'base64')); } catch { /* browser unavailable */ }
}
finally {
  socket?.close(); chrome?.kill();
  if (host?.exitCode === null) {
    try { await rpc('fishfm-acceptance', { op: 'toggle', disabled: true }); await rpc('fishfm-acceptance', { op: 'shutdown' }); await until(() => host.exitCode !== null, 10000); report.gracefulShutdown = true; } catch { host.kill(); report.gracefulShutdown = false; }
  }
  report.finishedAt = new Date().toISOString(); save();
}
