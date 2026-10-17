#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate, feedbackTemplate, qualityMarkdown, fail} from './research/quality.mjs';
import {exportSnapshot} from './research/snapshot.mjs';

const HELP = `FishFM 推荐研究（只读导出 / 离线回放，不启动模型或播放器）
  export --database <music.sqlite> --out <新目录> [--metadata]
  replay --input <snapshot.json> --out <新目录> [--feedback <人工反馈.json>] [--top-k 6]
默认导出去除歌名、原始理由、平台/账号标识；--metadata 仅保留候选和最多四首参考曲的目录元数据，仍只留本机。
示例：npm run research -- replay --input scripts/fixtures/research/snapshot.json --out .tmp/research-demo
说明：docs/research/README.md`;
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') return {command: 'help'};
  const flags = {export: ['--database', '--out', '--metadata'], replay: ['--input', '--out', '--feedback', '--top-k']}[command];
  if (!flags) fail('未知命令；运行 npm run research -- --help');
  const options = {command};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flags.includes(flag) || flag in options) fail('未知或重复参数');
    if (flag === '--metadata') options[flag] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) fail('参数缺少值'); options[flag] = rest[++i]; }
  }
  if (!options['--out'] || !options[command === 'export' ? '--database' : '--input']) fail('缺少输入或 --out');
  return options;
}
const read = path => JSON.parse(readFileSync(resolve(path), 'utf8'));
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
  const s = o.command === 'export' ? exportSnapshot(resolve(o['--database']), {metadata: o['--metadata'] === true}) : read(o['--input']);
  const feedback = o['--feedback'] ? read(o['--feedback']) : null;
  const r = evaluate(s, {feedback, topK: o['--top-k'] === undefined ? 6 : Number(o['--top-k'])});
  const out = writeBundle(o['--out'], {'snapshot.json': s, 'report.json': r, 'report.md': qualityMarkdown(r), 'feedback.template.json': feedbackTemplate(s)});
  console.log(JSON.stringify({out, inputHash: r.inputHash, decision: r.decision, replayNewCalls: 0}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
