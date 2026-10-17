#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate, feedbackTemplate, qualityMarkdown, fail} from './research/quality.mjs';
import {exportSnapshot} from './research/snapshot.mjs';
import {summarizeTrial, trialFiles, trialMarkdown} from './research/trial.mjs';
import {runPreferenceSignals, signalsMarkdown} from './research/preference-signals.mjs';

const HELP = `FishFM 推荐研究（只读导出 / 离线回放，不启动模型或播放器）
  export --database <music.sqlite> --out <新目录> [--metadata]
  replay --input <snapshot.json> --out <新目录> [--feedback <人工反馈.json>] [--top-k 6]
  trial-init --input <snapshot.json> --participant <匿名标识> --out <新试用包目录> [--study pilot-01]
  trial-report --input <试用包或包含试用包的目录> --out <新汇总目录>
  signals --out <新目录>
默认导出去除歌名、原始理由、平台/账号标识；--metadata 仅保留候选和最多四首参考曲的目录元数据，仍只留本机。
示例：npm run research -- replay --input scripts/fixtures/research/snapshot.json --out .tmp/research-demo
说明：docs/research/README.md`;
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') return {command: 'help'};
  const flags = {export: ['--database', '--out', '--metadata'], replay: ['--input', '--out', '--feedback', '--top-k'],
    'trial-init': ['--input', '--out', '--participant', '--study'], 'trial-report': ['--input', '--out'], signals: ['--out']}[command];
  if (!flags) fail('未知命令；运行 npm run research -- --help');
  const options = {command};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flags.includes(flag) || flag in options) fail('未知或重复参数');
    if (flag === '--metadata') options[flag] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) fail('参数缺少值'); options[flag] = rest[++i]; }
  }
  if (!options['--out'] || command !== 'signals' && !options[command === 'export' ? '--database' : '--input']) fail('缺少输入或 --out');
  if (command === 'trial-init' && !options['--participant']) fail('需要 --participant 匿名标识');
  return options;
}
const read = path => {
  const resolved = resolve(path), stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('输入必须是不超过 1 MiB 的普通 JSON 文件');
  return JSON.parse(readFileSync(resolved, 'utf8'));
};
export function readTrialPackets(directory) {
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink()) fail('试用目录不能是符号链接');
  const single = existsSync(join(root, 'participant.json'));
  const entries = single ? [] : readdirSync(root, {withFileTypes: true});
  if (entries.some(e => e.isSymbolicLink())) fail('试用目录不能包含符号链接');
  const folders = single ? [root] : entries.filter(e => e.isDirectory()).map(e => join(root, e.name));
  if (!folders.length || folders.length > 20) fail('需要 1–20 个参与者目录');
  return folders.map(folder => ({participant: read(join(folder, 'participant.json')), snapshot: read(join(folder, 'snapshot.json'))}));
}
export function writeBundle(directory, files) {
  const out = resolve(directory);
  if (existsSync(out)) fail('输出目录已存在；请使用新目录，避免覆盖已填写的反馈');
  mkdirSync(out, {recursive: true});
  for (const [name, value] of Object.entries(files)) writeFileSync(join(out, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  return out;
}
export function run(argv) {
  const o = parseArgs(argv);
  if (o.command === 'help') { console.log(HELP); return; }
  if (o.command === 'signals') {
    const r = runPreferenceSignals();
    console.log(JSON.stringify({out: writeBundle(o['--out'], {'report.json': r, 'report.md': signalsMarkdown(r)}), passed: r.passed, checks: r.checkCount}));
    if (r.passed !== r.checkCount) process.exitCode = 1;
    return;
  }
  if (o.command === 'trial-init') {
    const files = trialFiles(read(o['--input']), {participantId: o['--participant'], studyId: o['--study'] ?? 'pilot-01'});
    console.log(JSON.stringify({out: writeBundle(o['--out'], files), trialStarted: false}));
    return;
  }
  if (o.command === 'trial-report') {
    const r = summarizeTrial(readTrialPackets(o['--input']));
    console.log(JSON.stringify({out: writeBundle(o['--out'], {'report.json': r, 'report.md': trialMarkdown(r)}), status: r.status, completedParticipants: r.completedParticipants}));
    return;
  }
  const s = o.command === 'export' ? exportSnapshot(resolve(o['--database']), {metadata: o['--metadata'] === true}) : read(o['--input']);
  const feedback = o['--feedback'] ? read(o['--feedback']) : null;
  const r = evaluate(s, {feedback, topK: o['--top-k'] === undefined ? 6 : Number(o['--top-k'])});
  const out = writeBundle(o['--out'], {'snapshot.json': s, 'report.json': r, 'report.md': qualityMarkdown(r), 'feedback.template.json': feedbackTemplate(s)});
  console.log(JSON.stringify({out, inputHash: r.inputHash, decision: r.decision, replayNewCalls: 0}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error instanceof SyntaxError ? 'JSON 文件无法解析，请核对输入格式' : error.message); process.exitCode = 1; }
}
