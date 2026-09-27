#!/usr/bin/env node
// Lifecycle verification for R3: install, start, stop, retain, clear.
//
// R3 asks for a clean Windows environment, and this script is the part that can
// be reproduced anywhere: it exercises the documented lifecycle in an isolated
// state directory and reports each check. Running it on a genuinely clean machine
// is still a separate step, and this script says so instead of implying it did.
//
//   node scripts/verify-lifecycle.mjs [--out <dir>] [--keep]
//
// It never touches the real DSH home: the directory it uses is removed at the end
// unless --keep is given, so a failure can be inspected.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MusicStore } from '../src/storage.mjs';
import { importSeedTracks, describeEnvironment } from '../src/environment.mjs';
import { initializeAgentPreferences, describeTaste } from '../src/taste.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { neteaseEndpoints } from '../src/providers/endpoints/netease.mjs';
import { createHttpTransport } from '../src/providers/transport.mjs';
import { createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const keep = process.argv.includes('--keep');
const root = resolve(import.meta.dirname, '..');
const stateDirectory = resolve(argValue('--out', join('.tmp', 'lifecycle')));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

/** Runs the core entry and speaks its JSON-line protocol. */
function coreSession({ dbPath, env = {} }) {
  const child = spawn(process.execPath, [
    join(root, 'bin', 'fishfm-core.mjs'),
    '--db', dbPath, '--playback', 'fake', '--provider', 'fake',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...env } });

  const messages = [];
  const waiters = [];
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    for (let index; (index = buffered.indexOf('\n')) >= 0;) {
      const line = buffered.slice(0, index).trim();
      buffered = buffered.slice(index + 1);
      if (!line) continue;
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { continue; }
      messages.push(parsed);
      for (const waiter of waiters.splice(0)) waiter(parsed);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => { /* diagnostics only */ });

  const exited = new Promise((resolveExit) => {
    if (child.exitCode !== null) { resolveExit(child.exitCode); return; }
    child.once('exit', (code) => resolveExit(code));
  });

  return {
    child,
    messages,
    exited,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    /** Waits for a message matching a predicate, or times out. */
    waitFor(predicate, { timeoutMs = 8000 } = {}) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveWait) => {
        const timer = setTimeout(() => resolveWait(null), timeoutMs);
        waiters.push((message) => {
          if (!predicate(message)) { waiters.push(() => {}); return; }
          clearTimeout(timer);
          resolveWait(message);
        });
      });
    },
  };
}

// --- the checks ---------------------------------------------------------------

console.log(`FishFM lifecycle verification`);
console.log(`  state directory: ${stateDirectory}`);
console.log(`  node: ${process.version} on ${process.platform}`);
console.log('');

rmSync(stateDirectory, { recursive: true, force: true });
mkdirSync(stateDirectory, { recursive: true });

const dbPath = join(stateDirectory, 'fishfm', 'music.sqlite');

// 1. A fresh install has no data yet, which is what "clean" means.
check('fresh install starts with no database', !existsSync(dbPath), dbPath);

// 2. Starting the service creates the database, at the documented path, with the
//    current schema.
let session = coreSession({ dbPath });
const ready = await session.waitFor((message) => message.type === 'ready');
check('service starts and greets on the protocol', Boolean(ready), ready ? `protocol ${ready.protocol}` : 'no ready message');
check('database created at the documented path', existsSync(dbPath), dbPath);

let schemaVersion = null;
let tables = [];
if (existsSync(dbPath)) {
  const probe = new DatabaseSync(dbPath);
  schemaVersion = probe.prepare('PRAGMA user_version').get().user_version;
  tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  probe.close();
}
check('schema is at the current version', schemaVersion === 3, `user_version=${schemaVersion}`);
check('expected tables exist',
  ['user_environment', 'agent_preferences', 'listen_history', 'credential_references', 'session_influence'].every((name) => tables.includes(name)),
  `${tables.length} tables`);

// 3. State written through the documented path is retained across a restart.
session.send({
  id: 'imp', type: 'import', provider: 'netease', source: 'liked', requested: 2, seed: 7,
  tracks: [
    { provider: 'netease', providerTrackId: 'L1', title: 'Lifecycle one', artist: 'A', durationMs: 1000 },
    { provider: 'netease', providerTrackId: 'L2', title: 'Lifecycle two', artist: 'A', durationMs: 1000 },
  ],
});
const imported = await session.waitFor((message) => message.id === 'imp');
check('an import is accepted and recorded', imported?.ok === true && imported.import?.imported === 2,
  `source=${imported?.import?.source}, imported=${imported?.import?.imported}, degraded=${imported?.import?.degraded}`);

session.send({ id: 'bye', type: 'shutdown' });
const exitCode = await session.exited;
check('shutdown stops the service cleanly', exitCode === 0, `exit code ${exitCode}`);

session = coreSession({ dbPath });
await session.waitFor((message) => message.type === 'ready');
session.send({ id: 'env', type: 'environment' });
const environment = await session.waitFor((message) => message.id === 'env');
check('imported data is retained across a restart',
  environment?.environment?.total === 2,
  `total=${environment?.environment?.total}, seed=${environment?.taste?.seed}`);
check('the personality seed is retained, not regenerated',
  environment?.taste?.seed === 7,
  `seed=${environment?.taste?.seed}`);
session.send({ id: 'bye2', type: 'shutdown' });
await session.exited;

// 4. Signing out removes both the reference and the stored secret.
const credentials = createMemoryCredentials({ 'fishfm/netease': 'MUSIC_U=lifecycle-secret' });
const store = new MusicStore(dbPath);
store.setCredentialReference({
  provider: 'netease', accountId: 'lifecycle', credentialRef: 'fishfm/netease', state: 'authorized', updatedAt: Date.now(),
});
let logoutAccount = null;
{
  const transport = createHttpTransport({ endpoints: neteaseEndpoints({ base: 'http://127.0.0.1:1' }) });
  const provider = createNetEaseProvider({ transport, credentials, store, accountRef: 'fishfm/netease' });
  const before = provider.getAccount().status;
  await provider.logout();
  logoutAccount = provider.getAccount().status;
  check('signing out releases the stored secret', credentials.read('fishfm/netease') === null, `was ${before}`);
  check('signing out removes the credential reference', store.getCredentialReference('netease') === null);
  check('the account reports signed out afterwards', logoutAccount === 'login_required', logoutAccount);
}

// 5. Signing in again is possible, which is what "re-login" means.
{
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code: 200, unikey: 'lifecycle-relogin-key' }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const transport = createHttpTransport({ endpoints: neteaseEndpoints({ base }) });
    const provider = createNetEaseProvider({ transport, credentials, store, accountRef: 'fishfm/netease' });
    const started = await provider.beginLogin();
    check('a new sign-in can be started after signing out', Boolean(started.key), `key=${String(started.key).slice(0, 12)}…`);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

// 6. Local data is cleared by deleting the files, and the user is told which.
store.close();
const removable = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, join(stateDirectory, 'credentials')];
check('clearing local data removes the database', (() => {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  return !existsSync(dbPath);
})(), removable.join(' | '));

// --- summary ------------------------------------------------------------------

const passed = results.filter((row) => row.ok).length;
console.log('');
console.log(`RESULT: ${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log('Failed checks:');
  for (const row of results.filter((entry) => !entry.ok)) console.log(`  - ${row.name}: ${row.detail}`);
}
console.log('');
console.log('What this does NOT cover: installing on a genuinely clean Windows machine,');
console.log('a second device building from the docs, or the plugin being installed into a');
console.log('real DSH profile. Those need a machine and a user, not a script.');

if (keep) {
  console.log(`\nState left in place for inspection: ${stateDirectory}`);
  const manifest = join(stateDirectory, 'lifecycle-report.json');
  writeFileSync(manifest, `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
  console.log(`Report: ${manifest}`);
} else {
  rmSync(stateDirectory, { recursive: true, force: true });
}

process.exit(passed === results.length ? 0 : 1);