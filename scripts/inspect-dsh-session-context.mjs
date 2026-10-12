// Read only caller-selected DSH JSONL/Zstd sessions. Emit sizes and fingerprints,
// never prompt bodies, user messages, tool arguments or credentials.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';

const argumentsList = process.argv.slice(2);
const outputIndex = argumentsList.indexOf('--out');
const output = outputIndex >= 0 ? argumentsList.splice(outputIndex, 2)[1] : null;
if (!argumentsList.length) throw new Error('Pass explicit DSH session JSONL or JSONL.Zstd files');
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const musicNames = text => [...new Set(text.match(/fishfm_(?:status|control|request_track)/g) ?? [])].sort();

function readRecords(file) {
  const bytes = readFileSync(resolve(file));
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Session file exceeds the inspection limit');
  let text = '';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    // DSH appends independent frames. Decoding only the first frame sees the
    // session header and silently loses all subsequent requests and messages.
    let offset = 0, decodedBytes = 0;
    while (offset < bytes.length) {
      const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true });
      if (!decoded.engine.bytesWritten) throw new Error('Zstd decoder made no progress');
      decodedBytes += decoded.buffer.length;
      if (decodedBytes > 128 * 1024 * 1024) throw new Error('Decoded session exceeds the inspection limit');
      text += decoded.buffer.toString('utf8');
      offset += decoded.engine.bytesWritten;
    }
  } else text = bytes.toString('utf8');
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

const sessions = argumentsList.map(file => {
  const records = readRecords(file);
  const headers = records.filter(row => row.type === 'request/header').map(row => {
    const header = row.data?.header ?? {};
    const tools = Array.isArray(header.tools) ? header.tools : [];
    const music = tools.filter(tool => /^fishfm_(status|control|request_track)$/.test(tool?.name));
    return { at: row.time, toolCount: tools.length, musicToolCount: music.length,
      musicToolBytes: Buffer.byteLength(JSON.stringify(music)),
      musicToolFingerprint: fingerprint(JSON.stringify(music)) };
  });
  const messages = records.filter(row => ['system/message', 'developer/message', 'user/message'].includes(row.type)).map(row => {
    const message = row.data?.message ?? row.data;
    const content = JSON.stringify(message?.content ?? []);
    return { type: row.type, at: row.time, role: message?.role, source: message?.source?.kind,
      contentBytes: Buffer.byteLength(content), fingerprint: fingerprint(content), musicToolNames: musicNames(content),
      musicStateFieldMarkers: ['playInstanceId', 'agentEffectiveMs', 'candidateRevision'].filter(key => content.includes(key)) };
  });
  return { sessionId: records.find(row => row.type === 'session')?.id, recordCount: records.length,
    requestHeaders: headers, messages, completedTurns: records.filter(row => row.type === 'turn/end').length };
});
const result = { scope: 'selected_persisted_session_context_metadata', promptBodiesIncluded: false,
  tokenCostAttribution: 'sizes_and_fingerprints_only_not_a_token_or_billing_estimate', sessions };
if (output) writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
