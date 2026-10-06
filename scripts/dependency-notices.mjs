// Generate an inventory for the exact bundled runtime, preserving upstream files.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const lock = JSON.parse(readFileSync(new URL('../npm-shrinkwrap.json', import.meta.url), 'utf8'));
const rows = Object.keys(lock.packages).filter(Boolean).map(path => {
  const directory = new URL(`../${path}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8'));
  const license = manifest.license ?? manifest.licenses;
  if (!license) throw new Error(`Missing upstream license: ${path}`);
  const licenseFiles = readdirSync(directory).filter(name => /^(?:license|licence|copying|notice)(?:[._-]|$)/i.test(name));
  return { name: manifest.name, version: manifest.version,
    license: typeof license === 'string' ? license : JSON.stringify(license), path, licenseFiles };
}).sort((a, b) => a.name.localeCompare(b.name));
const body = '# Bundled runtime dependencies\n\n'
  + 'Generated from npm-shrinkwrap.json. These packages retain their own licenses; the FishFM MIT license does not replace them. Original source and license notices are included under node_modules/.\n\n'
  + 'node-forge is distributed under its BSD-3-Clause option. @unblockneteasemusic/server is LGPL-3.0-only; its JavaScript source, COPYING and COPYING.LESSER are retained and may be replaced by the user. FishFM does not modify that library.\n\n'
  + '| Package | Version | Declared license | License files |\n|---|---|---|---|\n'
  + rows.map(row => `| ${row.name} | ${row.version} | ${row.license.replaceAll('|', '/')} | ${row.licenseFiles.map(name => `[${name}](${row.path}/${name})`).join(', ') || 'See package metadata/source notices'} |`).join('\n') + '\n';
writeFileSync(new URL('../DEPENDENCY_LICENSES.md', import.meta.url), body);
console.log(`Recorded ${rows.length} bundled dependency licenses`);
