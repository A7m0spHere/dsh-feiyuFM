import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectLastError, readLastError } from '../scripts/read-last-error.mjs';

const script = fileURLToPath(new URL('../scripts/read-last-error.mjs', import.meta.url));
const temporary = async action => {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, 'fishfm-error-read-'));
  try { await action(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), parent);
    rmSync(directory, { recursive: true, force: true });
  }
};
function seed(path, state) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE core_state (id INTEGER PRIMARY KEY, value_json TEXT NOT NULL)');
  db.prepare('INSERT INTO core_state VALUES (1, ?)').run(JSON.stringify(state));
  return db;
}

test('error export reads only persisted fields and leaves database content and schema unchanged', async () => temporary(async directory => {
  const path = join(directory, 'music.sqlite');
  const db = seed(path, { lastError: { code: 'media_failed', message: 'Open() rejected the resource' },
    queue: [{ title: 'private-track' }], settings: { token: 'private-setting' } });
  db.close();
  const before = readFileSync(path), names = readdirSync(directory);
  const value = await readLastError(path);
  assert.equal(value.lastError.code, 'media_failed');
  assert.equal(value.mediaOpenStage.value, 'open-call');
  assert.match(value.mediaOpenStage.source, /^inferred/);
  assert.equal(JSON.stringify(value).includes('private-'), false);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readdirSync(directory), names);
}));

test('WAL reader sees committed errors without changing main database, WAL, rows or journal mode', async () => temporary(async directory => {
  const path = join(directory, 'music.sqlite');
  const db = seed(path, { lastError: null });
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    db.prepare('UPDATE core_state SET value_json=? WHERE id=1').run(JSON.stringify({
      lastError: { code: 'media_failed', message: 'Only site-of-origin pack URIs are supported for media.' },
    }));
    const before = [readFileSync(path), readFileSync(path + '-wal')];
    const rows = db.prepare('SELECT * FROM core_state').all();
    const value = await readLastError(path);
    assert.equal(value.lastError.code, 'media_failed');
    assert.equal(value.mediaOpenStage.value, 'media-failed-event');
    assert.deepEqual([readFileSync(path), readFileSync(path + '-wal')], before);
    assert.deepEqual(db.prepare('SELECT * FROM core_state').all(), rows);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally { db.close(); }
}));

test('downloaded single file runs without plugin dependencies and never treats override env as actual runtime', async () => temporary(async directory => {
  const path = join(directory, '有 空格.sqlite'), standalone = join(directory, '诊断助手.mjs');
  const db = seed(path, { lastError: { code: 'media_failed', message: 'Could not finish opening media' } }); db.close();
  copyFileSync(script, standalone);
  const before = readFileSync(path);
  const result = spawnSync(process.execPath, [standalone, path], { cwd: directory, encoding: 'utf8',
    env: { ...process.env, FISHFM_PLAYBACK_SHELL: 'private-unverified-shell.exe' } });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.lastError.code, 'media_failed');
  assert.equal(value.mediaOpenStage.value, 'open-finalize');
  assert.equal(value.runtime.selectedPowerShellExecutable, null);
  assert.equal(result.stdout.includes('private-unverified'), false);
  assert.deepEqual(readFileSync(path), before);
}));

test('unstructured messages and codes cannot leak URLs, credentials, paths or personal text', () => {
  for (const message of [
    'failed https://name:private-password@cdn.invalid/file?token=private-token',
    'Cookie: MUSIC_U=private-cookie; authorization Bearer private-bearer',
    'private-account C:\\Users\\private-name\\music.sqlite',
    'Only site-of-origin pack URIs are supported for media. private-suffix',
    '异常来自 HRESULT:0xc00d11b1; private-unlabelled-secret',
    'Open() rejected the resource' + ' '.repeat(2100) + 'private-secret',
  ]) {
    const value = projectLastError({ code: 'https://private-code.invalid', message });
    const text = JSON.stringify(value);
    assert.equal(value.lastError.code, null);
    assert.equal(value.lastError.messageStatus, 'withheld');
    assert.equal(text.includes('private-'), false);
    assert.equal(text.includes('https://'), false);
    assert.equal(value.mediaOpenStage.value, 'unknown');
  }
  assert.deepEqual(projectLastError({ code: 'media_failed', message: '0xc00d11b1 secret' }).lastError.hresults, ['0xC00D11B1']);
});

test('generic errors do not invent an open phase or loaded runtime, including when error is absent', () => {
  for (const error of [null, { code: 'media_failed', message: 'Media playback failed' },
    { code: 'media_stalled', message: '0xC00D11B1' }]) {
    const value = projectLastError(error);
    assert.equal(value.mediaOpenStage.value, 'unknown');
    for (const [key, field] of Object.entries(value.runtime)) if (key !== 'status') assert.equal(field, null);
  }
});

test('UNC paths and URLs are rejected before opening a filesystem or database connection', async () => {
  for (const path of ['\\\\server.invalid\\share\\music.sqlite', '//server.invalid/share/music.sqlite',
    'https://server.invalid/music.sqlite', 'file:///C:/music.sqlite']) {
    await assert.rejects(readLastError(path), /local-file-required/);
  }
});

test('missing or malformed input never creates a database or prints paths, raw errors or state', async () => temporary(async directory => {
  const missing = join(directory, 'private-missing.sqlite');
  const result = spawnSync(process.execPath, [script, missing], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'read_failed');
  assert.equal((result.stdout + result.stderr).includes('private-missing'), false);
  assert.deepEqual(readdirSync(directory), []);
  const path = join(directory, 'invalid.sqlite');
  const db = seed(path, { lastError: null });
  db.prepare('UPDATE core_state SET value_json=?').run('private-malformed-json'); db.close();
  const before = readFileSync(path);
  const malformed = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
  assert.equal(malformed.status, 1);
  assert.equal((malformed.stdout + malformed.stderr).includes('private-malformed'), false);
  assert.deepEqual(readFileSync(path), before);
}));
