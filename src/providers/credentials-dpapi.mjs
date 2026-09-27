// A standalone credential store for the command-line path.
//
// The DSH plugin gets `ctx.credentials` (verified in P0-06). A login run outside
// DSH has no context, so this stores the same kind of thing the same way:
// **DPAPI CurrentUser ciphertext on disk, keyed by the credential reference**.
// SQLite keeps only the reference, never the secret.
//
// Verified in P0-06: the DPAPI helper protects/decrypts as the current user, and
// the stored record contains ciphertext only. Cross-device copies of the file are
// deliberately useless, which is the intended property.
//
// One environment detail matters: the helper needs PowerShell 7. Windows
// PowerShell 5.1 cannot load System.Security.Cryptography.ProtectedData by
// assembly name, which is a real failure observed while finishing this file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HELPER = join(import.meta.dirname, '..', '..', 'spikes', 'P0-06-dpapi.ps1');
const TIMEOUT_MS = 60_000;

/** `pwsh` first: 5.1 cannot load the ProtectedData assembly by name. */
function shellCandidates() {
  const configured = process.env.FISHFM_PS_SHELL;
  return configured ? [configured] : ['pwsh', 'powershell.exe'];
}

/**
 * Runs the DPAPI helper. Tries each shell in turn so a machine with only
 * Windows PowerShell fails with a clear reason instead of a silent null.
 */
export function runDpapiHelper(operation, { input = '', timeoutMs = TIMEOUT_MS, helper = HELPER } = {}) {
  const attempts = [];
  for (const shell of shellCandidates()) {
    const result = spawnSync(
      shell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Operation', operation],
      { input, encoding: 'utf8', windowsHide: true, timeout: timeoutMs },
    );
    if (result.error) {
      attempts.push(`${shell}: ${result.error.code ?? result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      attempts.push(`${shell}: ${(result.stderr ?? '').trim().split('\n')[0] || `exit ${result.status}`}`);
      continue;
    }
    return result.stdout;
  }
  throw new Error(`DPAPI ${operation} failed (${attempts.join(' | ') || 'no PowerShell available'})`);
}

/** True when a usable PowerShell with DPAPI is present on this machine. */
export function dpapiAvailable() {
  try {
    return String(runDpapiHelper('protect', { input: 'probe' }) ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

/** Reference names become file names, so they are restricted tightly. */
function safeName(reference) {
  const name = String(reference).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name || name.startsWith('.')) throw new Error(`Unsafe credential reference: ${reference}`);
  return name;
}

/**
 * @param {object} options
 * @param {string} options.directory Where ciphertext files live.
 * @param {string} [options.helper]  Path to the DPAPI PowerShell helper.
 * @param {Function} [options.run]   Injection point for tests.
 */
export function createDpapiCredentials({
  directory,
  helper = HELPER,
  run = (operation, options) => runDpapiHelper(operation, { ...options, helper }),
  now = () => Date.now(),
} = {}) {
  if (!directory) throw new Error('A credential directory is required');

  const fileFor = (reference) => join(directory, `${safeName(reference)}.dpapi`);
  const metaFor = (reference) => join(directory, `${safeName(reference)}.json`);

  return {
    kind: 'dpapi',

    /** @returns {string|null} the secret, or null when nothing is stored. */
    read(reference) {
      let cipher;
      try {
        cipher = readFileSync(fileFor(reference), 'utf8').trim();
      } catch {
        return null;
      }
      if (!cipher) return null;
      // The adapter path is synchronous, so the helper is invoked synchronously.
      const plain = String(run('unprotect', { input: cipher }) ?? '').trim();
      return plain || null;
    },

    write(reference, secret) {
      if (typeof secret !== 'string' || !secret) throw new Error('A non-empty secret is required');
      mkdirSync(directory, { recursive: true });
      const cipher = String(run('protect', { input: secret }) ?? '').trim();
      if (!cipher) throw new Error('DPAPI produced no ciphertext');
      writeFileSync(fileFor(reference), `${cipher}\n`, { encoding: 'utf8', mode: 0o600 });
      writeFileSync(metaFor(reference), `${JSON.stringify({ updatedAt: now(), kind: 'dpapi-current-user' }, null, 2)}\n`, 'utf8');
      return true;
    },

    delete(reference) {
      try { rmSync(fileFor(reference), { force: true }); } catch { /* already gone */ }
      try { rmSync(metaFor(reference), { force: true }); } catch { /* already gone */ }
      return true;
    },

    /** Diagnostics for the login command; never returns a secret. */
    describe(reference) {
      const path = fileFor(reference);
      try {
        return { reference, present: true, cipherBytes: readFileSync(path, 'utf8').trim().length, path };
      } catch {
        return { reference, present: false, cipherBytes: 0, path };
      }
    },
  };
}

/** Used by tests and by `--dry-run`; keeps nothing at all. */
export function createMemoryCredentials(initial = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    kind: 'memory',
    read: (reference) => secrets.get(reference) ?? null,
    write: (reference, secret) => { secrets.set(reference, secret); return true; },
    delete: (reference) => { secrets.delete(reference); return true; },
    describe: (reference) => ({ reference, present: secrets.has(reference), cipherBytes: 0, path: null }),
    secrets,
  };
}