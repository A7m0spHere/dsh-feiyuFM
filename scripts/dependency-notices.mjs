// Update only the generated section of the single copyright document.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- BEGIN GENERATED DEPENDENCY NOTICES -->';
const END = '<!-- END GENERATED DEPENDENCY NOTICES -->';
const NOTICE = /^(?:license|licence|copying|notice)(?:[._-]|$)/i;
const quote = value => '`' + value + '`';

function filesIn(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : filesIn(directory, path);
      }
      return entry.isFile() ? [path] : [];
    });
}

export function updateDependencyNotices(root, { check = false } = {}) {
  const target = join(root, 'THIRD_PARTY_NOTICES.md');
  const original = readFileSync(target, 'utf8');
  const start = original.indexOf(START), end = original.indexOf(END);
  if (start < 0 || end < start || original.indexOf(START, start + START.length) >= 0
    || original.indexOf(END, end + END.length) >= 0) {
    throw new Error('Copyright document must have exactly one ordered generated section');
  }
  const lock = JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8'));
  const rows = Object.entries(lock.packages).filter(([path]) => path).map(([path, pinned]) => {
    const directory = join(root, path);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (manifest.version !== pinned.version) throw new Error('Installed version differs from lockfile: ' + path);
    const declared = manifest.license ?? manifest.licenses;
    if (!declared) throw new Error('Missing upstream license: ' + path);
    const license = typeof declared === 'string' ? declared : declared.map(value => value.type).join(' OR ');
    const files = filesIn(directory);
    const notices = files.filter(file => {
      if (NOTICE.test(basename(file))) return true;
      if (!/^readme(?:\.|$)/i.test(basename(file))) return false;
      const text = readFileSync(join(directory, file), 'utf8');
      return /copyright/i.test(text) && /permission (?:is hereby granted|to use, copy)/i.test(text);
    }).map(file => quote(path + '/' + file));
    const key = manifest.name + '@' + manifest.version;
    if (key === 'saxes@6.0.0') {
      if (!original.includes('<a id="saxes-license"></a>') || !original.includes('Copyright (c) Isaac Z. Schlueter and Contributors')) {
        throw new Error('Missing saxes supplemental notice');
      }
      notices.push('[本文保留的上游许可](#saxes-license)');
    }
    if (!notices.length) {
      const placeholder = ['gzip@0.1.0', 'https@1.0.0'].includes(key)
        && files.every(file => file === 'package.json' || statSync(join(directory, file)).size === 0);
      if (!placeholder) throw new Error('Missing upstream license text: ' + path);
      notices.push('占位包，仅元数据/空文件；许可声明见 ' + quote(path + '/package.json'));
    }
    return { name: manifest.name, version: manifest.version, license, notices, path };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.path.localeCompare(b.path));
  const body = [
    '', '', '共 ' + rows.length + ' 个锁定运行依赖条目。下列路径相对于插件安装目录。', '',
    '| Package | Version | Declared license | 随包原文或补充通知 |',
    '|---|---|---|---|',
    ...rows.map(row => '| ' + row.name + ' | ' + row.version + ' | ' + row.license.replaceAll('|', '/')
      + ' | ' + row.notices.join('；') + ' |'),
    '', ''
  ].join('\n');
  const updated = original.slice(0, start + START.length) + body + original.slice(end);
  if (check && updated !== original) throw new Error('Dependency notices are stale; run node scripts/dependency-notices.mjs');
  if (!check && updated !== original) writeFileSync(target, updated);
  return rows.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = updateDependencyNotices(fileURLToPath(new URL('../', import.meta.url)), { check: process.argv.includes('--check') });
  console.log('Verified ' + count + ' bundled dependency notices in THIRD_PARTY_NOTICES.md');
}
