// Real React + production bundle; mocked RPC fixtures only. No accounts/audio.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const out = resolve(arg('--out', '')), base = arg('--url', 'http://127.0.0.1:4187/guide');
if (!arg('--out', null) || existsSync(out)) throw new Error('Pass --out <NEW directory>');
mkdirSync(out, { recursive: true });
const report = { date: new Date().toISOString(), scope: 'production-client-real-react-mocked-rpc-chrome', checks: [], errors: [] };
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) {
  try { const v = await fn(); if (v) return v; } catch (e) { if (!/navigated|Execution context|Cannot find context/i.test(e.message)) throw e; }
  await sleep(50);
} throw new Error('UI condition timed out'); }
const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r));
const chrome = spawn(arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, 'chrome')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio', '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, cdp, evaluate;
const check = (name, passed, detail) => { report.checks.push({ name, passed, detail }); save(); assert.ok(passed, name); };
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok; } catch { return false; } });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let seq = 0, loads = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (!m.id) {
    if (m.method === 'Page.loadEventFired') loads++;
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); return;
  } const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); };
  cdp = (method, params = {}) => new Promise((r, j) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); j(new Error(`CDP ${method} timeout`)); }, 20000); pending.set(id, { resolve: r, reject: j, timer }); socket.send(JSON.stringify({ id, method, params })); });
  evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  const key = async (key, code, vk) => { for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk,
    ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); };
  const click = async selector => { const point = await until(() => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`)); for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point }); };
  const text = async label => { await evaluate(`(()=>{const e=[...document.querySelectorAll('.fishfm button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw new Error('Button missing');e.dataset.qaClick='target'})()`); await click('[data-qa-click=target]'); await evaluate(`document.querySelector('[data-qa-click=target]')?.removeAttribute('data-qa-click')`); };
  const ready = async () => until(() => evaluate(`!!window.__guideQa&&['ready','error'].includes(__guideQa.controller.getSnapshot().initializationState)`));
  const settled = async () => until(() => evaluate(`__guideQa.controller.getSnapshot().profileState==='ready'&&__guideQa.controller.getSnapshot().libraryReady`));
  const visible = () => evaluate(`!!document.querySelector('.fm-guide')?.getClientRects().length`);
  const navigate = async (method, params = {}) => { const before = loads; await cdp(method, params); await until(() => loads > before); await ready(); };
  const scene = async name => navigate('Page.navigate', { url: `${base}?scenario=${name}&reset=1` });
  const shot = async name => { await sleep(350); const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.data, 'base64')); };
  const forbidden = () => evaluate(`__guideQa.calls.filter(r=>!['fishfm/state','fishfm/profile','fishfm/library'].includes(r.endpoint))`);

  await scene('fresh'); await settled(); await until(visible);
  check('fresh install shows the three-step guide after initialization', await evaluate(`document.querySelectorAll('.fm-guide-step').length===3&&__guideQa.controller.getSnapshot().guideStatus==='started'`));
  await shot('desktop');
  await navigate('Page.reload'); await settled(); await until(visible);
  check('unfinished guidance survives reload rather than being dismissed by a transient mount', true);
  await evaluate(`document.querySelector('[data-guide-step=connect]').focus()`); await key('Enter', 'Enter', 13);
  await until(() => evaluate(`document.activeElement?.hasAttribute('data-guide-login')`));
  check('keyboard step 1 expands platform and focuses real login', await evaluate(`document.querySelector('.fm-platform-details').open&&document.activeElement.textContent==='扫码登录'`));
  await shot('connect-focus');
  await text('打开使用指南'); await until(visible);
  await evaluate(`document.querySelector('[data-guide-step=connect]').focus()`); await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9);
  check('Tab reaches the third step in document order', await evaluate(`document.activeElement.dataset.guideStep==='listen'`));
  await key('Enter', 'Enter', 13);
  check('step 3 returns to listening, explains feedback and never plays', await evaluate(`document.querySelector('.fm-listen-page').hidden===false&&!!document.querySelector('.fm-guide-tip')&&__guideQa.controller.getSnapshot().snapshot.paused`));
  check('guide actions call no account import playback or model endpoint', (await forbidden()).length === 0);
  await text('跳过引导'); await until(async () => !await visible());
  await navigate('Page.reload'); await settled(); check('skip survives client restart', !await visible());
  await text('电台设置'); await text('打开使用指南'); await until(visible); await text('完成引导');
  await navigate('Page.reload'); await settled(); check('completion survives client restart', !await visible());

  await scene('authorized'); await settled(); check('authorized upgrade stays quiet', !await visible());
  await text('电台设置'); await text('打开使用指南'); await until(visible);
  await click('[data-guide-step=connect]');
  check('authorized connect step describes existing connection rather than a missing login button', await evaluate(`document.querySelector('.fm-guide-target-note').textContent.includes('网易云已连接')&&!document.querySelector('[data-guide-login]')`));
  await text('打开使用指南'); await until(visible);
  await evaluate(`document.querySelector('[data-guide-step=connect]').focus()`); await key('Tab', 'Tab', 9); await key('Enter', 'Enter', 13);
  await until(() => evaluate(`document.activeElement?.matches('select[data-guide-import]')`));
  check('step 2 focuses actual import source without reading playlists or importing', await evaluate(`document.activeElement.value==='auto'&&document.querySelector('.fm-platform-details').open`) && (await forbidden()).length === 0);
  await shot('import-focus');
  await scene('used'); await settled(); check('existing library upgrade stays quiet', !await visible());
  await scene('failure'); check('P0 failure takes precedence', await evaluate(`!document.querySelector('.fm-guide')&&document.querySelector('[role=alert]').textContent.includes('dependency_missing')`));
  await evaluate(`__guideQa.setScenario('fresh')`); await settled(); await until(visible); check('P0 recovery permits fresh-user guide', true);
  await scene('pending'); await until(() => evaluate(`__guideQa.controller.getSnapshot().profileState==='ready'`));
  check('unknown library is not an empty library', !await visible());
  await evaluate(`__guideQa.releaseLibrary(6)`); await settled(); check('late existing library suppresses guide', !await visible());
  await scene('pending'); await until(() => evaluate(`__guideQa.controller.getSnapshot().profileState==='ready'`)); await evaluate(`__guideQa.releaseLibrary(0)`); await settled(); await until(visible); check('late empty library permits guide', true);
  await scene('blocked'); await settled(); await until(visible); await text('跳过引导'); await text('电台设置'); await text('正在听');
  check('unavailable storage keeps navigation and in-memory skip working', !await visible() && await evaluate(`__guideQa.controller.getSnapshot().connected`));

  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await scene('fresh'); await settled(); await until(visible); await evaluate(`document.documentElement.setAttribute('data-ds-dark-theme','')`);
    check(`narrow ${width}px and reduced motion have no horizontal overflow`, await evaluate(`document.querySelector('.fishfm').scrollWidth<=document.querySelector('.fishfm').clientWidth+1&&document.documentElement.scrollWidth<=innerWidth`));
    await shot(`narrow-${width}`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await scene('authorized'); await settled(); await text('电台设置');
  await evaluate(`(()=>{const c=__guideQa.controller,original=__guideQa.connection.rpc.call.bind(__guideQa.connection.rpc);let total=0,loggedOut=false;const snapshot=structuredClone(c.getSnapshot().snapshot);const page=n=>({total:n,matched:n,query:'',offset:0,limit:12,tracks:[]});__guideQa.connection.rpc.call=async(channel,endpoint,payload,signal)=>{if(endpoint==='fishfm/library')return new Promise(resolve=>{window.__releaseStaleLibrary=()=>resolve({ok:true,value:{library:page(9)}})});if(endpoint==='fishfm/import'){total=5;snapshot.revision++;return{ok:true,value:{snapshot:structuredClone(snapshot),library:page(total),imported:{source:'liked',total,imported:5}}}}if(endpoint==='fishfm/logout'){loggedOut=true;snapshot.revision++;return{ok:true,value:{snapshot:structuredClone(snapshot),login:null,platformError:'模拟平台读取失败 (read_failed)',library:page(total)}}}if(endpoint==='fishfm/playlists')return{ok:true,value:{snapshot:structuredClone(snapshot),platforms:{netease:{installed:true,account:{status:'login_required'}}},library:page(total),playlists:[]}};if(endpoint==='fishfm/state')return{ok:true,value:{snapshot:structuredClone(snapshot),platforms:{netease:{installed:true,account:{status:loggedOut?'login_required':'authorized'}}},library:page(total)}};return original(channel,endpoint,payload,signal)};void c.queryLibrary();return true})()`);
  await evaluate(`__guideQa.controller.platformAction('import','netease')`); await evaluate(`__releaseStaleLibrary()`);
  check('delayed pre-import library does not roll back the visible imported total', await evaluate(`__guideQa.controller.getSnapshot().library.total===5&&[...document.querySelectorAll('.fm-input-library summary')].some(e=>e.textContent.includes('5 首'))`));
  await evaluate(`__guideQa.controller.platformAction('logout','netease')`);
  await click('.fm-platform-details>summary');
  await until(() => evaluate(`!!document.querySelector('.fm-platform')?.getClientRects().length`));
  const blocked = await evaluate(`__guideQa.controller.getSnapshot().platformError.includes('read_failed')&&![...document.querySelectorAll('.fm-platform button')].some(e=>e.textContent==='导入我的音乐'&&!e.disabled)&&document.querySelector('.fm-platform').textContent.includes('读取失败')`);
  await evaluate(`__guideQa.controller.platformAction('playlists','netease')`);
  check('partial logout clears cached authorization and a fresh platform response restores login', blocked && await evaluate(`__guideQa.controller.getSnapshot().platformError===''&&!!document.querySelector('[data-guide-login]')`));
  check('no uncaught errors or React errors', report.errors.length === 0, report.errors);
} catch (error) { report.failure = error.message; process.exitCode = 1; try { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, 'failure.png'), Buffer.from(r.data, 'base64')); } catch {} }
finally { socket?.close(); chrome.kill(); report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ out, checks: report.checks.length, failed: report.checks.filter(c=>!c.passed).length, error: report.failure ?? null })); }
