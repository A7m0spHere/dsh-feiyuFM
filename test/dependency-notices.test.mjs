import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { updateDependencyNotices } from '../scripts/dependency-notices.mjs';

const START = '<!-- BEGIN GENERATED DEPENDENCY NOTICES -->';
const END = '<!-- END GENERATED DEPENDENCY NOTICES -->';
const prefix = '人工维护的角色署名与许可原文\n\n' + START;
const suffix = END + '\n\n人工维护的反馈入口\n';

function fixture(t, name = 'example', version = '1.0.0') {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-notices-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('fishfm-notices-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const packagePath = 'node_modules/' + name;
  const packageDirectory = join(directory, packagePath);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), prefix + '\n旧生成内容\n' + suffix);
  writeFileSync(join(directory, 'npm-shrinkwrap.json'), JSON.stringify({ packages: { [packagePath]: { version } } }));
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  return { directory, packageDirectory, target: join(directory, 'THIRD_PARTY_NOTICES.md') };
}

test('dependency notice regeneration preserves manual attribution and finds README and nested notices', t => {
  const { directory, packageDirectory, target } = fixture(t);
  writeFileSync(join(packageDirectory, 'README.md'), 'Copyright (c) fixture\nPermission is hereby granted, free of charge.\n');
  mkdirSync(join(packageDirectory, 'vendor'));
  writeFileSync(join(packageDirectory, 'vendor', 'LICENSE.txt'), 'Fixture vendor notice\n');
  assert.equal(updateDependencyNotices(directory), 1);
  const updated = readFileSync(target, 'utf8');
  assert.ok(updated.startsWith(prefix));
  assert.ok(updated.endsWith(suffix));
  assert.ok(updated.includes('node_modules/example/README.md'));
  assert.ok(updated.includes('node_modules/example/vendor/LICENSE.txt'));
  assert.equal(updateDependencyNotices(directory, { check: true }), 1);
  assert.equal(readFileSync(target, 'utf8'), updated);
});

test('missing upstream license text fails without overwriting copyright information', t => {
  const { directory, packageDirectory, target } = fixture(t);
  writeFileSync(join(packageDirectory, 'index.js'), 'export const example = true;\n');
  const original = readFileSync(target, 'utf8');
  assert.throws(() => updateDependencyNotices(directory), /Missing upstream license text/);
  assert.equal(readFileSync(target, 'utf8'), original);
});

test('placeholder exception stops applying when an implementation is added', t => {
  const { directory, packageDirectory, target } = fixture(t, 'gzip', '0.1.0');
  mkdirSync(join(packageDirectory, 'src'));
  writeFileSync(join(packageDirectory, 'src', 'gzip.js'), '');
  updateDependencyNotices(directory);
  const original = readFileSync(target, 'utf8');
  writeFileSync(join(packageDirectory, 'src', 'gzip.js'), 'export const implemented = true;\n');
  assert.throws(() => updateDependencyNotices(directory), /Missing upstream license text/);
  assert.equal(readFileSync(target, 'utf8'), original);
});

test('check mode detects stale inventories without changing the document', t => {
  const { directory, packageDirectory, target } = fixture(t);
  writeFileSync(join(packageDirectory, 'LICENSE'), 'Fixture license notice\n');
  const original = readFileSync(target, 'utf8');
  assert.throws(() => updateDependencyNotices(directory, { check: true }), /Dependency notices are stale/);
  assert.equal(readFileSync(target, 'utf8'), original);
});
