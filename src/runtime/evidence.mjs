// Evidence from actual production call sites. Unknown coverage stays unknown.
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const TEXT = new Set(['type', 'kind', 'role', 'event', 'phase', 'code', 'endReason', 'pool', 'provider', 'playInstanceId', 'decisionId', 'trackKey', 'selectedBy', 'progressSource', 'name', 'status', 'source']);
const NUMBERS = new Set(['positionMs', 'effectiveMs', 'effectiveDeltaMs', 'agentEffectiveMs', 'audibleMs', 'count', 'delta', 'before', 'after', 'version', 'discoveryRate', 'familiar', 'discovery', 'offered']);
const FLAGS = new Set(['accepted', 'updated', 'fellBack', 'paused', 'audible', 'agentListening']);
export function safeEvidenceEvent(entry) {
  const result = {};
  for (const [key, value] of Object.entries(entry ?? {})) {
    if (TEXT.has(key) && typeof value === 'string' && /^[\w:.-]{1,100}$/.test(value)) result[key] = value;
    else if (NUMBERS.has(key) && Number.isFinite(value)) result[key] = value;
    else if (FLAGS.has(key) && typeof value === 'boolean') result[key] = value;
  }
  return result;
}
export function createRuntimeEvidence({ directory = null, component = 'core', mode = 'real', now = () => Date.now(), limit = 2000, intervalMs = 5000, metadata = {} } = {}) {
  const runId = randomUUID();
  const startedAt = now();
  const events = [], samples = [];
  const counts = {};
  const lastProgress = new Map();
  let seq = 0, dropped = 0, closed = false;
  let published = false;
  const report = () => ({ schema: 1, runId, component, mode, pid: process.pid, parentPid: process.ppid, node: process.versions.node, metadata, startedAt, updatedAt: now(), closed, sequence: seq, droppedEvents: dropped, counts: { ...counts }, events: structuredClone(events), samples: [...samples],
    coverage: { platformRequests: component === 'core' ? 'instrumented' : 'unknown', playbackEvents: component === 'core' ? mode : 'unknown', promptRegistration: component === 'adapter' ? 'instrumented' : 'unknown', musicModelRequests: null, dshModelRequests: null, perTurnContextInjection: 'unknown' },
    a09: { holds: null, statement: 'DSH request/context coverage requires a verified host collector' } });
  const flush = () => {
    if (!directory) return;
    try {
      mkdirSync(directory, { recursive: true });
      const target = join(directory, `${component}.json`), temporary = `${target}.${process.pid}.tmp`;
      if (published) {
        try {
          if (JSON.parse(readFileSync(target, 'utf8')).runId !== runId) return;
        } catch { /* retry a missing report, never publish another run's data */ }
      }
      writeFileSync(temporary, `${JSON.stringify(report())}\n`, 'utf8');
      renameSync(temporary, target);
      published = true;
    } catch { /* Diagnostics must not interrupt music. */ }
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
  return { event, report, flush, close() { closed = true; clearInterval(timer); sample(); } };
}
export function readRuntimeEvidence(directory, now = Date.now()) {
  const components = {};
  for (const name of ['core', 'adapter']) {
    try {
      const value = JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8'));
      components[name] = { ...value, stale: value.closed || now - value.updatedAt > 20_000 };
    } catch { components[name] = null; }
  }
  return { schema: 1, observedAt: now, components, a09: { holds: null, statement: 'Missing DSH coverage is unknown, not zero' } };
}
