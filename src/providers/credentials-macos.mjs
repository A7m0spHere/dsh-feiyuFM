// Stores platform sessions as generic-password items in the logged-in user's
// macOS Keychain. The secret is sent to the native helper over stdin, not argv.
import { spawnSync } from 'node:child_process';
import { ensureMacHelper } from '../runtime/macos-helper.mjs';

function invoke(helper, request, run = spawnSync) {
  const result = run(helper, ['credential'], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || `helper exited ${result.status}`).trim().split('\n')[0];
    throw new Error(`macOS Keychain ${request.operation} failed: ${detail}`);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('macOS Keychain helper returned an invalid response'); }
}

export function createMacKeychainCredentials({
  helper = null,
  ensureHelper = ensureMacHelper,
  run = spawnSync,
} = {}) {
  let binary = helper;
  const getHelper = () => binary ??= ensureHelper();
  const invokeOne = (operation, reference, secret) => invoke(getHelper(), {
    operation, reference, ...(secret === undefined ? {} : { secret }),
  }, run);

  return {
    kind: 'macos-keychain',
    read(reference) {
      const result = invokeOne('read', reference);
      return typeof result.value === 'string' && result.value ? result.value : null;
    },
    write(reference, secret) {
      if (typeof secret !== 'string' || !secret) throw new Error('A non-empty secret is required');
      invokeOne('write', reference, secret);
      return true;
    },
    delete(reference) {
      invokeOne('delete', reference);
      return true;
    },
    describe(reference) {
      return { reference, present: invokeOne('exists', reference).present === true, path: null };
    },
  };
}
