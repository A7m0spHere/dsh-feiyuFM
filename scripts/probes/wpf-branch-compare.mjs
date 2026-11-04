// Opt-in serial comparison of unchanged, silent native WPF tests. No user data.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const root = resolve(import.meta.dirname, '../..'), baseline = resolve(arg('--baseline') ?? ''), out = resolve(arg('--out') ?? '');
if (!arg('--baseline') || !arg('--out') || existsSync(out) || process.platform !== 'win32') throw new Error('Pass --baseline <main snapshot> --out <NEW directory> on Windows');
if (process.env.FISHFM_TEST_REAL_AUDIO === '0') throw new Error('Real audio tests are disabled in the inherited environment');
mkdirSync(out, { recursive: true });
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error('Git metadata failed'); return r.stdout.trim(); };
const hash = value => createHash('sha256').update(value).digest('hex');
const files = ['test/playback-warm.test.mjs', 'test/playback-wpf.test.mjs'];
function collect(dir, prefix = '') { return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(e => e.isDirectory() ? collect(dir, join(prefix, e.name)) : [join(prefix, e.name)]); }
const sourceFiles = [...files, ...collect(join(root, 'src/playback')).map(f => join('src/playback', f)), 'src/contracts.mjs'];
const sourceComparison = sourceFiles.map(file => ({ file: file.replaceAll('\\', '/'), identical: hash(readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')) === hash(readFileSync(join(baseline, file), 'utf8').replaceAll('\r\n', '\n')) }));
if (!sourceComparison.every(r => r.identical)) throw new Error('The compared playback code or tests differ; inspect before attributing failures');
function audioEnvironment() {
  const script = "$ErrorActionPreference='Stop'; $s=@(Get-Service Audiosrv,AudioEndpointBuilder | Sort-Object Name | Select-Object Name,@{N='Status';E={$_.Status.ToString()}}); $d=@(Get-CimInstance Win32_SoundDevice | Sort-Object PNPDeviceID | Select-Object PNPDeviceID,Status); $e=@(Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Sort-Object InstanceId | Select-Object InstanceId,Status); @{services=$s;devices=$d;endpoints=$e} | ConvertTo-Json -Depth 5 -Compress";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error('Audio environment observation failed');
  const value = JSON.parse(r.stdout); return { fingerprint: hash(JSON.stringify(value)), services: value.services, devices: value.devices.length, endpoints: value.endpoints.length };
}
const report = { date: new Date().toISOString(), node: process.version, main: git('rev-parse', 'main'), fix: git('rev-parse', 'HEAD'), order: ['main', 'fix', 'fix', 'main'], thresholdsMs: { generatedSilentResource: 12000, sameSourceReload: 8000 }, sourceComparison, runs: [] };
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
for (const [index, ref] of report.order.entries()) {
  const before = audioEnvironment(), startedAt = new Date().toISOString();
  const pattern = '^(the host writes its own silent resource rather than shipping one|WPF re-opens the same source after a resume-style reload)$';
  const args = ['--test', '--test-concurrency=1', '--test-timeout=30000', '--test-reporter=tap', '--test-name-pattern', pattern, ...files];
  let log = '';
  const child = spawn(process.execPath, args, { cwd: ref === 'main' ? baseline : root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const exit = await new Promise((r, j) => { child.once('error', j); child.once('exit', r); });
  writeFileSync(join(out, `${index + 1}-${ref}.log`), log);
  const count = key => Number(log.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] ?? -1);
  const after = audioEnvironment();
  const run = { ref, startedAt, finishedAt: new Date().toISOString(), exit, tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), before, after,
    failures: [...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]), mediaOpenTimeout: log.includes('media_open_timeout') };
  report.runs.push(run); save();
  console.log(JSON.stringify({ ref, passed: run.passed, failed: run.failed, skipped: run.skipped, stableAudio: before.fingerprint === after.fingerprint }));
  if (run.tests !== 2 || run.skipped !== 0) throw new Error('Comparison did not execute both native tests');
}
report.sameObservedAudioEnvironment = new Set(report.runs.flatMap(r => [r.before.fingerprint, r.after.fingerprint])).size === 1;
report.finishedAt = new Date().toISOString(); save();
