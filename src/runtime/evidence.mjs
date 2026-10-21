// Evidence from actual production call sites. Unknown coverage stays unknown.
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const TEXT = new Set(['type', 'kind', 'role', 'event', 'phase', 'code', 'endReason', 'pool', 'provider', 'playInstanceId', 'decisionId', 'trackKey', 'selectedBy', 'progressSource', 'name', 'status', 'source']);
const NUMBERS = new Set(['positionMs', 'effectiveMs', 'effectiveDeltaMs', 'agentEffectiveMs', 'audibleMs', 'count', 'delta', 'before', 'after', 'version', 'discoveryRate', 'familiar', 'discovery', 'offered', 'durationMs']);
const FLAGS = new Set(['accepted', 'updated', 'fellBack', 'paused', 'audible', 'agentListening']);
/** Same shape rule as text fields: a recorded error is a code, not a message. */
const SAFE_CODE = /^[\w:.-]{1,100}$/;
export function safeEvidenceEvent(entry) {
  const result = {};
  for (const [key, value] of Object.entries(entry ?? {})) {
    if (TEXT.has(key) && typeof value === 'string' && /^[\w:.-]{1,100}$/.test(value)) result[key] = value;
    else if (NUMBERS.has(key) && Number.isFinite(value)) result[key] = value;
    else if (FLAGS.has(key) && typeof value === 'boolean') result[key] = value;
  }
  return result;
}
export function createRuntimeEvidence({ directory = null, component = 'core', mode = 'real', now = () => Date.now(), limit = 2000, intervalMs = 5000, metadata = {}, onWriteFailure = null } = {}) {
  const runId = randomUUID();
  const startedAt = now();
  const events = [], samples = [];
  const counts = {};
  const lastProgress = new Map();
  let seq = 0, dropped = 0, closed = false;
  let published = false;
  let hostCollector=null;
  // A dropped write is a fact worth keeping: a silently stale file is
  // indistinguishable from a wedged process when someone reads it later.
  const writeHealth = { attempts: 0, failures: 0, skipped: 0, lastError: null, lastFailureAt: null, lastSuccessAt: null };
  // A report can only carry its own failures after a LATER write lands. The
  // sidecar is the one channel that survives a permanent failure, and the
  // callback is what makes it visible to a live process at all.
  const failurePath = () => join(directory, `${component}.write-failure.json`);
  let reportedError = null, failureNoteWritten = false;
  // A run that dies without close() leaves its note behind. Clear a foreign one
  // once at startup so a later healthy run does not inherit a dead warning.
  if (directory) {
    try {
      const stale = JSON.parse(readFileSync(failurePath(), 'utf8'));
      if (stale?.runId !== runId) rmSync(failurePath(), { force: true });
      else failureNoteWritten = true;
    } catch { /* no note, or unreadable: the first flush reports the truth */ }
  }
  const noteFailure = () => {
    if (!onWriteFailure || reportedError === writeHealth.lastError) return;
    reportedError = writeHealth.lastError;
    try { onWriteFailure({ ...writeHealth }); } catch { /* a diagnostics consumer cannot break writing */ }
  };
  const report = () => ({ schema: 1, runId, component, mode, pid: process.pid, parentPid: process.ppid, node: process.versions.node, metadata, startedAt, updatedAt: now(), closed, sequence: seq, droppedEvents: dropped, writeHealth: { ...writeHealth }, counts: { ...counts }, events: structuredClone(events), samples: [...samples],
    coverage: { platformRequests: component === 'core' ? 'instrumented' : 'unknown', playbackEvents: component === 'core' ? mode : 'unknown', promptRegistration: component === 'adapter' ? 'instrumented' : 'unknown', musicModelRequests: null, dshModelRequests: hostCollector?.report().attachedAt?'llm_stream_service_calls':null, perTurnContextInjection: 'unknown' },
    host:hostCollector?.report()??null,
    a09: { holds: null, statement: 'A09 requires request/context comparison and source attribution; runtime samples alone are insufficient' } });
  const flush = () => {
    if (!directory) return;
    writeHealth.attempts++;
    try {
      mkdirSync(directory, { recursive: true });
      const target = join(directory, `${component}.json`), temporary = `${target}.${process.pid}.tmp`;
      if (published) {
        let existing = null;
        try { existing = JSON.parse(readFileSync(target, 'utf8')); }
        catch { /* missing or half-written: this run may publish */ }
        // Another run owns the file. Skipping is intentional, but it is still a
        // write that did not happen, so it is counted rather than passed over.
        if (existing && existing.runId !== runId) { writeHealth.skipped++; return; }
      }
      writeFileSync(temporary, `${JSON.stringify(report())}\n`, 'utf8');
      renameSync(temporary, target);
      published = true;
      writeHealth.lastSuccessAt = now();
      reportedError = null;
      // The failure note has served its purpose; a stale one would be a lie.
      // Guarded so the healthy path never pays an extra syscall.
      if (failureNoteWritten) {
        try { rmSync(failurePath(), { force: true }); failureNoteWritten = false; }
        catch { /* the next success retries */ }
      }
    } catch (error) {
      writeHealth.failures++;
      const code = (error?.code || error?.name || 'error').toString();
      writeHealth.lastError = SAFE_CODE.test(code) ? code.slice(0, 40) : 'error';
      writeHealth.lastFailureAt = now();
      // Best effort: if only the report path is broken, this still tells the truth.
      try { writeFileSync(failurePath(), `${JSON.stringify({ schema: 1, component, runId, at: now(), ...writeHealth })}\n`, 'utf8'); failureNoteWritten = true; }
      catch { /* the whole directory may be unwritable; the callback still fires */ }
      noteFailure();
    }
  };
  const event = (raw) => {
    const entry = safeEvidenceEvent(raw);
    if (!entry.type) return;
    const key = `${entry.type}:${entry.role ?? entry.event ?? entry.kind ?? ''}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (entry.event === 'progress') {
      const progressKey = `${entry.type}:${entry.playInstanceId}`;
      if (now() - (lastProgress.get(progressKey) ?? -Infinity) < 5000) return;
      lastProgress.set(progressKey, now());
      if (lastProgress.size > 32) lastProgress.delete(lastProgress.keys().next().value);
    }
    events.push({ seq: ++seq, at: now(), ...entry });
    if (events.length > limit) { events.shift(); dropped++; }
  };
  const sample = () => {
    const memory = process.memoryUsage();
    samples.push({ at: now(), rss: memory.rss, heapUsed: memory.heapUsed });
    if (samples.length > 720) samples.shift();
    flush();
  };
  const timer = directory ? setInterval(sample, intervalMs) : null;
  timer?.unref();
  flush();
  return { event, report, flush, writeHealth:()=>({ ...writeHealth }), setHostCollector(collector){hostCollector=collector;}, close() {
    clearInterval(timer);
    const before = writeHealth.failures + writeHealth.skipped;
    // The final report must carry the closed flag in the same atomic write.
    // A failed/refused write cannot publish it and is not a clean close.
    closed = true;
    sample();
    if (writeHealth.failures + writeHealth.skipped !== before) closed = false;
  } };
}
export function readRuntimeEvidence(directory, now = Date.now()) {
  const components = {}, writeFailures = {};
  for (const name of ['core', 'adapter']) {
    try {
      const value = JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8'));
      components[name] = { ...value, stale: value.closed || now - value.updatedAt > 20_000 };
    } catch { components[name] = null; }
    // A missing report is ambiguous on its own: never started, or started and
    // unable to write. This sidecar is what resolves it, so it is reported
    // separately and never folded into `stale`.
    try { writeFailures[name] = JSON.parse(readFileSync(join(directory, `${name}.write-failure.json`), 'utf8')); }
    catch { writeFailures[name] = null; }
  }
  return { schema: 1, observedAt: now, components, writeFailures, a09: { holds: null, statement: 'Missing DSH coverage is unknown, not zero' } };
}
