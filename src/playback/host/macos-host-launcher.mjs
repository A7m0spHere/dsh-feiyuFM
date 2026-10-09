#!/usr/bin/env node
// Resolve the compiled AVFoundation helper on demand, then keep a thin Node
// parent so the existing supervisor can forward shutdown signals and logs.
import { spawn } from 'node:child_process';
import { ensureMacHelper } from '../../runtime/macos-helper.mjs';

let helper;
try {
  helper = ensureMacHelper();
} catch (error) {
  process.stderr.write(`fishfm-macos-host: ${error.message}\n`);
  process.exit(1);
}

const child = spawn(helper, ['playback', ...process.argv.slice(2)], { stdio: 'inherit' });
let finished = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}
child.once('error', error => {
  process.stderr.write(`fishfm-macos-host: could not start native helper (${error.code ?? error.message})\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (finished) return;
  finished = true;
  process.exitCode = code ?? (signal ? 1 : 0);
});
