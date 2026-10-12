// Real DPAPI acceptance against an installed package. Uses synthetic data only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'win32') {
  console.log('NOT APPLICABLE: Windows DPAPI acceptance requires Windows');
  process.exit(0);
}
assert.ok(process.argv[2], 'Usage: node scripts/verify-windows-credentials.mjs <installed-package-root>');
const moduleUrl = pathToFileURL(join(resolve(process.argv[2]), 'src/providers/credentials-dpapi.mjs')).href;
const directory = mkdtempSync(join(tmpdir(), 'fishfm-dpapi-accept-'));
const fixture = 'MUSIC_U=synthetic-beta3-acceptance; __csrf=fixture';
const windowsShellPath = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
try {
  for (const scenario of [
    { name: 'PowerShell 7', env: { FISHFM_PS_SHELL: 'pwsh' } },
    { name: 'Windows PowerShell 5.1', env: { FISHFM_PS_SHELL: 'powershell.exe' } },
    { name: '5.1-only PATH fallback', env: { FISHFM_PS_SHELL: '', PATH: windowsShellPath } },
  ]) {
    const env = { ...process.env, ...scenario.env };
    const reference = 'fishfm/synthetic-acceptance';
    // Every operation runs in a new Node process. Read proves persistence across
    // restart; no account, secret value or ciphertext is written to the log.
    for (const operation of ['write', 'read', 'delete', 'absent']) {
      const source = `
        import assert from 'node:assert/strict';
        import { createDpapiCredentials, dpapiAvailable } from ${JSON.stringify(moduleUrl)};
        assert.equal(dpapiAvailable(), true, 'Required DPAPI helper is unavailable');
        const store = createDpapiCredentials({directory: ${JSON.stringify(directory)}});
        const reference = ${JSON.stringify(reference)};
        const fixture = ${JSON.stringify(fixture)};
        const operation = ${JSON.stringify(operation)};
        if (operation === 'write') store.write(reference, fixture);
        if (operation === 'read') assert.equal(store.read(reference), fixture);
        if (operation === 'delete') store.delete(reference);
        if (operation === 'absent') assert.equal(store.read(reference), null);
      `;
      const result = spawnSync(process.execPath, ['--input-type=module'], {
        input: source, env, encoding: 'utf8', windowsHide: true, timeout: 90_000,
      });
      assert.equal(result.status, 0, `${scenario.name} ${operation} failed: ${result.error?.message ?? result.stderr}`);
      if (operation === 'write') {
        const cipher = readFileSync(join(directory, 'fishfm_synthetic-acceptance.dpapi'), 'utf8');
        assert.ok(cipher.trim().length > 0);
        assert.equal(cipher.includes(fixture), false, 'Plaintext leaked to the credential file');
      }
    }
    console.log(`PASS ${scenario.name}: available/write/ciphertext/restart-read/delete/absent`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
