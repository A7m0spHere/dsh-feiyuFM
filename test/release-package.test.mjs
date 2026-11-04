import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeBundledFtpOverride, verifyLockedRuntime } from '../scripts/pack-release.mjs';

test('bundled FTP metadata describes the existing override without changing runtime code or versions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feiyufm-pack-override-'));
  const json = (path, value) => writeFileSync(join(dir, path), JSON.stringify(value));
  try {
    mkdirSync(join(dir, 'node_modules/get-uri'), { recursive: true }); mkdirSync(join(dir, 'node_modules/basic-ftp'));
    json('package.json', { overrides: { 'basic-ftp': '6.2.2' } });
    json('node_modules/get-uri/package.json', { name: 'get-uri', version: '6.0.5', license: 'MIT', dependencies: { 'basic-ftp': '^5.0.2', debug: '^4' } });
    json('node_modules/basic-ftp/package.json', { version: '6.2.2' });
    json('npm-shrinkwrap.json', { packages: { 'node_modules/get-uri': { version: '6.0.5', dependencies: { 'basic-ftp': '^5.0.2' } } } });
    writeFileSync(join(dir, 'node_modules/get-uri/index.js'), 'UNTOUCHED_RUNTIME');
    assert.equal(normalizeBundledFtpOverride(dir)[0].from, '^5.0.2');
    const uri = JSON.parse(readFileSync(join(dir, 'node_modules/get-uri/package.json')));
    assert.deepEqual(uri, { name: 'get-uri', version: '6.0.5', license: 'MIT', dependencies: { 'basic-ftp': '6.2.2', debug: '^4' } });
    assert.equal(readFileSync(join(dir, 'node_modules/get-uri/index.js'), 'utf8'), 'UNTOUCHED_RUNTIME');
    json('node_modules/basic-ftp/package.json', { version: '5.3.1' });
    assert.throws(() => normalizeBundledFtpOverride(dir), /no longer matches/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release integrity rejects a missing transitive dependency and version drift before packing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feiyufm-pack-tree-'));
  const json = (path, value) => writeFileSync(join(dir, path), JSON.stringify(value));
  try {
    mkdirSync(join(dir, 'node_modules/parent'), { recursive: true });
    json('package.json', { name: 'fixture', version: '0.1.1', dependencies: { parent: '1.0.0' } });
    const lock = { version: '0.1.1', packages: { '': { version: '0.1.1', dependencies: { parent: '1.0.0' } }, 'node_modules/parent': { version: '1.0.0' }, 'node_modules/child': { version: '2.0.0' } } };
    json('npm-shrinkwrap.json', lock);
    json('node_modules/parent/package.json', { version: '1.0.0', dependencies: { child: '2.0.0' } });
    assert.throws(() => verifyLockedRuntime(dir), /Missing locked runtime dependency: node_modules\/child/);
    mkdirSync(join(dir, 'node_modules/child'));
    json('node_modules/child/package.json', { version: '2.0.1' });
    assert.throws(() => verifyLockedRuntime(dir), /Locked runtime version differs/);
    json('node_modules/child/package.json', { version: '2.0.0' });
    assert.equal(verifyLockedRuntime(dir).length, 2);
    json('package.json', { version: '0.1.1', dependencies: { parent: '1.1.0' } });
    assert.throws(() => verifyLockedRuntime(dir), /Release dependencies and shrinkwrap differ/);
    json('package.json', { version: '0.1.2' });
    assert.throws(() => verifyLockedRuntime(dir), /Release version and shrinkwrap version differ/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
