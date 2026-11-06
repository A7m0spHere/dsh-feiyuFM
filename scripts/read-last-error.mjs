#!/usr/bin/env node
// Standalone Node 24 helper for npm 0.1.1. No plugin imports, network or process control.
import { statSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_CODES = new Set([
  'media_failed', 'media_download_failed', 'media_open_timeout', 'media_stalled', 'media_unavailable',
  'playback_error', 'playback_host_lost', 'playback_closed', 'host_error', 'host_unavailable',
  'resource_missing', 'resource_unavailable', 'unsupported_resource', 'no_media',
  'provider_failure', 'provider_timeout', 'provider_unavailable', 'login_required',
  'cancelled', 'internal', 'no_candidates', 'pipe_closed', 'pipe_timeout',
  'invalid_playback_position', 'stale_version', 'protocol_error', 'protocol_mismatch',
]);
const KNOWN_MESSAGES = new Map([
  ['Open() rejected the resource', 'open-call'],
  ['Could not finish opening media', 'open-finalize'],
  ['Only site-of-origin pack URIs are supported for media.', 'media-failed-event'],
  ['对于媒体仅支持源站点包 URI。', 'media-failed-event'],
  ['Media playback failed', 'unknown'],
  ['找不到媒体文件。', 'unknown'],
]);

export function projectLastError(error) {
  const rawMessage = typeof error?.message === 'string' ? error.message.slice(0, 2048) : '';
  const known = typeof error?.message === 'string' && error.message.length <= 2048 && KNOWN_MESSAGES.has(rawMessage);
  const hresults = [...new Set(rawMessage.match(/\b0x[89a-f][0-9a-f]{7}\b/gi) ?? [])]
    .slice(0, 3).map(value => `0x${value.slice(2).toUpperCase()}`);
  const codeKnown = SAFE_CODES.has(error?.code);
  const stage = error?.code === 'media_failed' && known ? KNOWN_MESSAGES.get(rawMessage) : 'unknown';
  return {
    schema: 1,
    source: 'persisted-core-state-not-live-rpc',
    lastError: error ? {
      code: codeKnown ? error.code : null,
      codeStatus: codeKnown ? 'known-code' : 'unrecognized-withheld',
      message: known ? rawMessage : '[自由文本已隐藏，仅保留 HRESULT]',
      messageStatus: known ? 'known-fixed-message' : 'withheld',
      hresults,
    } : null,
    mediaOpenStage: {
      value: stage,
      source: stage === 'unknown' ? 'not-recorded' : 'inferred-from-npm-0.1.1-message-not-recorded-phase',
    },
    runtime: {
      selectedPowerShellExecutable: null,
      powerShellVersion: null,
      frameworkDescription: null,
      presentationCoreFileVersion: null,
      status: 'unknown-not-persisted-by-npm-0.1.1',
    },
  };
}

export async function readLastError(databasePath) {
  // Require an existing file. Never create a database, migrate schema or change journal mode.
  if (typeof databasePath !== 'string' || /^(?:\\\\|\/\/|file:|https?:)/i.test(databasePath)) throw new Error('local-file-required');
  if (!statSync(databasePath).isFile()) throw new Error('not-a-file');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 1000 });
  try {
    // Fetch only the bounded error fields, not the queue, track identities or settings.
    const row = db.prepare(`SELECT json_type(value_json, '$.lastError') AS error_type,
      substr(json_extract(value_json, '$.lastError.code'), 1, 128) AS code,
      substr(json_extract(value_json, '$.lastError.message'), 1, 2049) AS message
      FROM core_state WHERE id = 1`).get();
    if (row && ![null, 'null', 'object'].includes(row.error_type)) throw new Error('invalid-state');
    return projectLastError(row?.error_type === 'object' ? { code: row.code, message: row.message } : null);
  } finally { db.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('用法：node read-last-error.mjs "实际的 fishfm/music.sqlite 路径"\n只读查询已保存的 lastError；运行时信息缺失时输出 unknown。');
    return;
  }
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major !== 24 || minor < 14) throw new Error('unsupported-node');
    if (args.length !== 1 || args[0].startsWith('--')) throw new Error('invalid-arguments');
    console.log(JSON.stringify(await readLastError(args[0]), null, 2));
  } catch {
    // Exceptions may contain paths, SQL or user data. Do not print them or their stacks.
    console.log(JSON.stringify({ schema: 1, error: 'read_failed',
      message: '无法只读提取；请核对 Node 24.14+、实际数据库路径及文件可读性。不要上传数据库或原始异常。' }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) await main();
