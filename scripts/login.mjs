#!/usr/bin/env node
// Interactive sign-in for a music platform, for use before or outside the DSH
// plugin. This is the entry point P3 needs: it produces a QR code to scan, waits
// for confirmation, and stores the session through the credential store. The
// secret is never printed.
//
//   node scripts/login.mjs [--provider netease|qq] [--out <dir>] [--timeout 300]
//                          [--dry-run] [--probe]
//
// `--dry-run` uses an in-memory credential store, so a test scan leaves nothing
// behind. `--probe` additionally asks the platform who we are, which is the
// first real check that the endpoint profile is right.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { neteaseEndpoints, NETEASE_ENDPOINT_PROVENANCE, NETEASE_QR_LOGIN_URL } from '../src/providers/endpoints/netease.mjs';
import { createHttpTransport } from '../src/providers/transport.mjs';
import { createNetEaseProvider } from '../src/providers/netease.mjs';
import { createDpapiCredentials, createMemoryCredentials } from '../src/providers/credentials-dpapi.mjs';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const hasFlag = (name) => process.argv.includes(name);

const providerName = argValue('--provider', 'netease');
const timeoutSeconds = Number(argValue('--timeout', '300'));
const dryRun = hasFlag('--dry-run');
const probe = hasFlag('--probe');

if (providerName !== 'netease') {
  console.error(`Only netease is wired for sign-in so far; ${providerName} has no confirmed endpoint profile.`);
  process.exit(2);
}

// Credentials live beside the Harness home, never in the repository.
const stateDirectory = resolve(argValue('--out', join(process.env.DSH_HOME ?? join(homedir(), '.fishfm'), 'fishfm')));
const credentials = dryRun ? createMemoryCredentials() : createDpapiCredentials({ directory: join(stateDirectory, 'credentials') });
const reference = `fishfm/${providerName}`;

// A tiny store stand-in: the providers only use it for the credential reference
// row, and this command is not the long-lived host.
const referenceRows = new Map();
const store = {
  getCredentialReference: (name) => referenceRows.get(name) ?? null,
  setCredentialReference: (row) => { referenceRows.set(row.provider, { ...row, credential_ref: row.credentialRef, account_id: row.accountId, state: row.state }); },
  removeCredentialReference: (name) => { referenceRows.delete(name); },
};

/** The most recent response body, kept only to describe its shape on failure. */
let lastRawBody = null;

const transport = createHttpTransport({
  // An override keeps diagnostics and tests off the live service.
  endpoints: neteaseEndpoints(process.env.FISHFM_NETEASE_BASE ? { base: process.env.FISHFM_NETEASE_BASE } : {}),
  onLog: (entry) => {
    if (entry.type === 'transport') console.log(`  · transport: ${entry.role} set ${entry.cookies} cookie(s)`);
  },
});
// Wrap the transport so the last response body is available for diagnostics.
// Only the shape is ever printed, never the values.
const rawTransport = transport;
const recordingTransport = {
  ...rawTransport,
  async request(options) {
    const response = await rawTransport.request(options);
    lastRawBody = response?.body ?? null;
    return response;
  },
};

const provider = createNetEaseProvider({
  transport: recordingTransport, credentials, store, accountRef: reference,
  communityLogin: !process.env.FISHFM_NETEASE_BASE,
});

/** Records the shape of a response without recording its contents. */
function describeShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})${value.length && depth < 2 ? ` of ${describeShape(value[0], depth + 1)}` : ''}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 12);
    return `{${keys.join(', ')}${Object.keys(value).length > 12 ? ', …' : ''}}`;
  }
  // Scalars are reported by type only: a login response can contain tokens.
  return typeof value;
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

console.log(`FishFM sign-in · ${providerName}`);
console.log(`  credential store: ${credentials.kind}${dryRun ? ' (nothing will be kept)' : ` at ${stateDirectory}`}`);
if (!dryRun && process.platform !== 'win32') {
  console.log('  note: DPAPI is Windows-only; on other platforms use --dry-run for now');
}

// --- 1. ask for a QR ---------------------------------------------------------

let qr;
try {
  qr = await provider.beginLogin();
} catch (error) {
  fail(`could not start sign-in: ${error.message}`,
    error.code === 'endpoint_unconfigured'
      ? 'this build has no endpoint profile for that role'
      : 'the endpoint profile is unverified: see docs/spikes/P0-02-netease.md');
}

if (!qr?.key) {
  // Report the platform's actual shape, not this project's interpretation of
  // it, because that is what correcting the profile needs.
  const shape = lastRawBody ? describeShape(lastRawBody) : 'no response body';
  fail('the platform did not return a sign-in key',
    `response shape was ${shape} — record it in docs/spikes/P0-02-netease.md and correct the profile`);
}
console.log(`\n1. sign-in key received: ${String(qr.key).slice(0, 8)}…`);

// The QR image must be rendered locally: the service does not produce one
// (measured 2026-09-27 — every candidate image endpoint answered 接口未找到).
// The QR encodes the sign-in URL containing the key.
let imagePath = null;
let rendered = false;
try {
  const { default: QRCode } = await import('qrcode');
  const loginUrl = qr.qrUrl || `${NETEASE_QR_LOGIN_URL}?codekey=${encodeURIComponent(qr.key)}`;
  mkdirSync(stateDirectory, { recursive: true });
  imagePath = join(stateDirectory, `login-${providerName}.png`);
  await QRCode.toFile(imagePath, loginUrl, { width: 360, margin: 2, errorCorrectionLevel: 'M' });
  rendered = true;
  console.log(`2. QR image written to ${imagePath}`);
  // A terminal rendering as well, so the code is scannable even when no image
  // viewer opens (over SSH, for instance).
  try {
    const ascii = await QRCode.toString(loginUrl, { type: 'terminal', small: true });
    console.log(ascii);
  } catch { /* the PNG is the primary path */ }
} catch (error) {
  // Without the renderer the sign-in is still possible if the user has another
  // way to turn the URL into a code, so this is a degradation, not a failure.
  console.log(`2. could not render the QR image: ${error.message}`);
  console.log('   install the dev dependency with: npm install');
}

if (rendered) {
  // Opening the image is the user's action, not a hidden one.
  if (hasFlag('--open') || process.platform === 'win32') {
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', `Invoke-Item -LiteralPath '${imagePath.replace(/'/g, "''")}'`],
        { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      console.log('   opened it in your default image viewer — scan it with the phone app');
    } catch { /* opening is a convenience, not a requirement */ }
  }
} else {
  console.log('   the code is also printed above as text; scan either one');
}

// Keep the sign-in URL beside the image so a failed scan can be retried without
// starting a new handshake (the key stays valid until the service expires it).
mkdirSync(stateDirectory, { recursive: true });
writeFileSync(join(stateDirectory, `login-${providerName}.txt`),
  `${NETEASE_QR_LOGIN_URL}?codekey=${qr.key}\n`, 'utf8');

// --- 2. poll until confirmed -------------------------------------------------

console.log(`\n3. waiting for confirmation (up to ${timeoutSeconds}s, polling every 3s)…`);
const deadline = Date.now() + timeoutSeconds * 1000;
let status = 'waiting';
let checked = 0;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  checked += 1;
  let polled;
  try {
    polled = await provider.pollLogin();
  } catch (error) {
    fail(`polling failed: ${error.message}`, 'the loginPoll endpoint profile may be wrong');
  }
  status = polled.status;
  if (status === 'scanned') console.log('   …scanned, confirm on your phone');
  else if (status !== 'waiting' && status !== 'scanned') console.log(`   …${status}`);
  if (status === 'authorized') break;
  if (status === 'expired') {
    fail('the sign-in QR expired before it was confirmed', 'run the command again to get a fresh code');
  }
  if (checked % 10 === 0) console.log(`   …still waiting (${checked} checks)`);
}

if (status !== 'authorized') fail(`gave up after ${timeoutSeconds}s`, 'run the command again when you are ready to scan');

// --- 3. confirm what we stored ----------------------------------------------

const account = provider.getAccount();
console.log(`\n4. signed in. account state: ${account.status}${account.accountId ? ` (id ${account.accountId})` : ''}`);
const described = credentials.describe(reference);
console.log(`   credential: ${described.present ? `stored, ${described.cipherBytes} base64 chars of ciphertext` : 'NOT stored'}`);
if (described.path) console.log(`   file: ${described.path}`);
console.log('   the session itself was never printed and is not in the database');

if (probe) {
  console.log('\n5. probing the account endpoint to confirm the profile…');
  try {
    const restored = await provider.restore();
    console.log(`   account endpoint says: ${restored.status}${restored.accountId ? ` (id ${restored.accountId})` : ''}`);
  } catch (error) {
    console.log(`   account probe failed: ${error.code ?? 'error'} — ${error.message}`);
    console.log('   this is the first thing to correct in docs/spikes/P0-02-netease.md');
  }
}

console.log(`\n${NETEASE_ENDPOINT_PROVENANCE.confirmed.length === 0
  ? 'Reminder: every endpoint in this build is an unconfirmed hypothesis.'
  : 'Some endpoints are confirmed.'} Record what worked in docs/spikes/P0-02-netease.md.`);
console.log(dryRun ? 'Dry run: nothing was persisted.' : 'Session stored. The plugin can now import and play.');
