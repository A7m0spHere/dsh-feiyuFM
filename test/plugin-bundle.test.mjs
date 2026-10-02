// The installable plugin bundle: its manifest shape, how it launches the core
// process in each environment, and that its entry really registers on a context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, coreCommand, defaultDatabase } from '../index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the package is an installable bundle: manifest, exports and patch row', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.exports['.'], './index.js');
  assert.ok(manifest.meta?.title, 'display metadata is required by the plugin manager');
  assert.ok(manifest.exports['./package.json'], 'the plugin manager reads the manifest through exports');

  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: fishfm/);
  assert.match(patch, new RegExp(`name: '${manifest.name}'`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('launches the core the way the desktop host launches Node work', () => {
  // Inside the Electron desktop host: reuse its binary as Node.
  const electron = coreCommand({ env: { DSH_DESKTOP_NODE_EXECUTABLE: 'D:\\dsh\\DeepSeek Harness.exe' } });
  assert.equal(electron.command, 'D:\\dsh\\DeepSeek Harness.exe');
  assert.equal(electron.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(electron.args[0], '--expose-internals');
  assert.ok(electron.args[1].endsWith('fishfm-core.mjs'));
  assert.deepEqual(electron.args.slice(2), ['--playback', 'real', '--provider', 'real']);

  // Outside Electron (tests, a plain CLI profile): the current Node runs it.
  const plain = coreCommand({ env: {} });
  assert.equal(plain.command, process.execPath);
  assert.equal(plain.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(plain.args[0].endsWith('fishfm-core.mjs'), true);

  // Config reaches the command line.
  const configured = coreCommand({ env: {}, playback: 'fake', provider: 'fake', database: 'C:\\tmp\\x.sqlite' });
  assert.deepEqual(configured.args.slice(1), ['--playback', 'fake', '--provider', 'fake', '--db', 'C:\\tmp\\x.sqlite']);
});

test('the database lives under the Harness home, never in the repository', () => {
  assert.equal(defaultDatabase({ DSH_HOME: 'C:\\Users\\x\\.dsh' }), join('C:\\Users\\x\\.dsh', 'fishfm', 'music.sqlite'));
  assert.equal(defaultDatabase({}), join(homedir(), '.dsh', 'fishfm', 'music.sqlite'));
  assert.equal(defaultDatabase({ DSH_HOME: '  ' }), defaultDatabase({}));
  assert.equal(defaultDatabase({ DSH_HOME: '~/.dsh-test' }), join(homedir(), '.dsh-test', 'fishfm', 'music.sqlite'));
  const databaseRelativeToRepo = relative(root, defaultDatabase({}));
  assert.ok(isAbsolute(databaseRelativeToRepo) || databaseRelativeToRepo.startsWith('..'),
    'the default database must be outside any repository checkout path');
  assert.equal(defaultDatabase({ DSH_HOME: 'C:\\Users\\x\\.dsh' }).startsWith(root), false);
});

test('apply registers the adapter and reports a core that cannot start', async () => {
  const registered = { tools: new Map(), commands: new Map(), logs: [] };
  const failure = Promise.withResolvers();
  const disposers = [];
  const ctx = {
    effect(fn) { const dispose = fn(); disposers.push(dispose); return () => dispose?.(); },
    on(name, handler) { registered.events = name; registered.handler = handler; return () => {}; },
    tools: { register: (definition) => { registered.tools.set(definition.name, definition); return () => registered.tools.delete(definition.name); } },
    commands: { register: (definition) => { registered.commands.set(definition.name, definition); return () => registered.commands.delete(definition.name); } },
    logger: () => ({ warn: (text) => { registered.logs.push(text); failure.resolve(); }, debug: () => {} }),
  };

  // Point at a core entry that exits immediately: apply must still succeed and
  // surface the failure instead of throwing into the Harness.
  const badEntry = join(root, 'scripts', 'fixtures', 'exits-immediately.mjs');
  const dispose = apply(ctx, { coreEntry: badEntry, playback: 'fake', provider: 'fake', database: ':memory:' });
  assert.equal(typeof dispose, 'function');
  assert.equal(registered.tools.size, 3, 'status, control and point-play must all register');
  assert.equal(registered.commands.size, 3);
  assert.equal(registered.events, 'session/event');

  const timer = setTimeout(() => failure.reject(new Error('Core startup failure was not reported within 5 seconds')), 5000);
  try { await failure.promise; } finally { clearTimeout(timer); }
  assert.ok(registered.logs.some((line) => /failed to start|exited/.test(line)), 'a dead core must be reported');

  dispose();
  assert.equal(registered.tools.size, 0, 'unload must remove the tools');
  assert.equal(registered.commands.size, 0, 'unload must remove the commands');
});

test('the plugin declares no Config schema and injects what it touches', async () => {
  const module = await import('../index.js');
  // A plain object here breaks cordis activation, so no Config is exported.
  assert.equal(module.Config, undefined, 'Config must be a schemastery schema or absent');
  assert.deepEqual(module.inject, ['tools']);
  assert.equal(module.name, 'fishfm');
});
