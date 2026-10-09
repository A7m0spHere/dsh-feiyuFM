// Compiles the small native helper once and keeps it in DSH's private data
// directory. The helper source ships with the plugin; generated binaries and
// Keychain records never live in the repository or npm package cache.
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SOURCE = fileURLToPath(new URL('../playback/host/fishfm-macos-host.swift', import.meta.url));

function dshHome(env = process.env) {
  let value = env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  if (value === '~') value = homedir();
  else if (/^~[\\/]/.test(value)) value = join(homedir(), value.slice(2));
  return resolve(value);
}

export function ensureMacHelper({
  platform = process.platform,
  source = SOURCE,
  cacheDirectory = join(dshHome(), 'fishfm', 'hosts'),
  swiftc = process.env.FISHFM_SWIFTC || '/usr/bin/swiftc',
  compile = spawnSync,
} = {}) {
  if (platform !== 'darwin') throw new Error(`The FishFM native helper is macOS-only (got ${platform})`);
  const sourceBytes = readFileSync(source);
  const digest = createHash('sha256').update(sourceBytes).update(process.arch).digest('hex').slice(0, 20);
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
  chmodSync(cacheDirectory, 0o700);
  const binary = join(cacheDirectory, `fishfm-macos-${process.arch}-${digest}`);
  if (existsSync(binary)) return binary;

  const temporary = `${binary}.${process.pid}.${randomUUID()}.tmp`;
  const result = compile(swiftc, [
    '-swift-version', '5', '-parse-as-library', '-O', source, '-o', temporary,
  ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    try { unlinkSync(temporary); } catch { /* no temporary output was created */ }
    const detail = (result.stderr || result.error?.message || `swiftc exited ${result.status}`).trim().split('\n').slice(-5).join('\n');
    throw new Error(`Could not build the FishFM macOS helper. Install Xcode Command Line Tools and retry. ${detail}`);
  }
  try {
    chmodSync(temporary, 0o700);
    renameSync(temporary, binary);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the original filesystem error */ }
    throw error;
  }
  return binary;
}

export function macHelperSourcePath() { return SOURCE; }
