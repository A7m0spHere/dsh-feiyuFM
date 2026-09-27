// Evidence recorder for a long run (A09 / R2).
//
// A09 claims that two hours of autonomous listening adds **zero** LLM requests
// and injects no music context into the conversation. That claim needs to be
// measurable, not asserted, so this records:
//
//   - every request the music layer makes, by kind, so "no model request" is a
//     count of zero rather than an opinion;
//   - the registered prompt surface (tools, commands) so it can be checked to be
//     static: registered once at load and never per turn;
//   - resource samples (process memory, open handles, child processes) so a slow
//     leak is visible instead of invisible.
//
// Everything written here is sanitized: counts, sizes and timings only. Session
// material, resolved handles and media URLs never enter a sample.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Request kinds the music layer is allowed to make. Anything that would reach a
 * model is listed so its count is expected to stay at zero.
 */
export const REQUEST_KINDS = Object.freeze({
  // Local work: no network, no model.
  local: ['snapshot', 'command', 'session-event', 'core-ipc'],
  // Platform work: reaches a music service, never a model.
  platform: ['transport'],
  // Growth and selection are pure local computation.
  computation: ['selection', 'growth', 'decay'],
  // The one kind that must remain at zero for A09.
  model: ['llm'],
});

export function createRunRecorder({
  now = () => Date.now(),
  memoryProbe = () => process.memoryUsage(),
  handleProbe = null,
  outputDirectory = null,
  keepSamples = 720,
} = {}) {
  const startedAt = now();
  const counts = new Map();
  const samples = [];
  const events = [];
  let promptSurface = { tools: [], commands: [], registeredAt: null, registrations: 0 };

  const bump = (kind, name, amount = 1) => {
    const key = `${kind}:${name}`;
    counts.set(key, (counts.get(key) ?? 0) + amount);
  };

  return {
    startedAt,

    /** Records one request the music layer made. */
    request(kind, name) {
      bump(kind, name);
      if (kind === 'model') {
        // Loud on purpose: a single model request from the music layer breaks
        // the A09 promise and should be impossible to miss.
        events.push({ at: now(), type: 'model-request', name });
      }
      return this;
    },

    /** Records the prompt surface once, at load. */
    registerPromptSurface({ tools = [], commands = [] } = {}) {
      promptSurface = {
        tools: [...tools],
        commands: [...commands],
        registeredAt: now(),
        registrations: promptSurface.registrations + 1,
      };
      events.push({ at: now(), type: 'prompt-surface', tools: tools.length, commands: commands.length });
      return promptSurface;
    },

    /** One resource sample: memory plus, where possible, handle counts. */
    sample({ label = 'idle', extra = {} } = {}) {
      const memory = memoryProbe();
      const sample = {
        at: now(),
        elapsedMs: now() - startedAt,
        label,
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        external: memory.external ?? 0,
        ...(handleProbe ? { handles: handleProbe() } : {}),
        ...extra,
      };
      samples.push(sample);
      if (samples.length > keepSamples) samples.shift();
      return sample;
    },

    report() {
      const byKind = {};
      for (const [key, value] of counts) {
        const [kind, name] = key.split(':');
        byKind[kind] ??= {};
        byKind[kind][name] = value;
      }
      const modelRequests = byKind.model
        ? Object.values(byKind.model).reduce((sum, value) => sum + value, 0)
        : 0;
      const first = samples[0] ?? null;
      const last = samples.at(-1) ?? null;
      return {
        startedAt,
        elapsedMs: now() - startedAt,
        // A09 is exactly this number.
        modelRequests,
        counts: byKind,
        promptSurface,
        sampleCount: samples.length,
        // The samples themselves are kept: a trend cannot be judged from a
        // count, and they contain no secrets (sizes and labels only).
        samples,
        memory: first && last
          ? {
            firstRss: first.rss,
            lastRss: last.rss,
            growthBytes: last.rss - first.rss,
            firstHeapUsed: first.heapUsed,
            lastHeapUsed: last.heapUsed,
            heapGrowthBytes: last.heapUsed - first.heapUsed,
          }
          : null,
        events,
        // The claim, stated as a verdict rather than left to the reader.
        a09: {
          holds: modelRequests === 0,
          statement: modelRequests === 0
            ? 'the music layer added no model requests during this run'
            : `${modelRequests} model request(s) came from the music layer`,
        },
      };
    },

    /** Writes the sanitized report; safe to keep and to share. */
    write(directory = outputDirectory, { name = 'run-report.json' } = {}) {
      if (!directory) throw new Error('A directory is required to write the report');
      const report = this.report();
      const path = join(directory, name);
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return { path, report };
    },
  };
}

/**
 * Counts a child process's working set and handles on Windows.
 *
 * Best effort by design: a platform without these tools yields null rather than
 * a fabricated number, because an invented resource figure is worse than none.
 */
export function processProbe({ pid = process.pid, run = null } = {}) {
  const runner = run ?? ((command, args) => {
    try {
      return spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    } catch {
      return null;
    }
  });

  return () => {
    if (process.platform !== 'win32') return null;
    const result = runner('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.WorkingSet64),$($p.HandleCount)" }`,
    ]);
    if (!result || result.status !== 0) return null;
    const [workingSet, handles] = String(result.stdout).trim().split(',');
    const memory = Number(workingSet);
    const handleCount = Number(handles);
    if (!Number.isFinite(memory) || !Number.isFinite(handleCount)) return null;
    return { workingSetBytes: memory, handleCount };
  };
}

/** Counts the core child processes currently alive, which must not accumulate. */
export function childProcessProbe({ directory = null } = {}) {
  return () => {
    if (process.platform !== 'win32') return null;
    try {
      const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*fishfm*' }).Count",
      ], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      if (result.status !== 0) return null;
      const value = Number(String(result.stdout).trim());
      return Number.isFinite(value) ? { fishfmProcesses: value } : null;
    } catch {
      return null;
    }
  };
}

/**
 * Summarizes a long run for the record: how memory and handles moved between the
 * first and last sample, and whether anything looks like a steady climb.
 */
export function summarizeTrend(samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    return { sufficient: false, reason: 'not enough samples to judge a trend' };
  }
  const withMemory = samples.filter((sample) => Number.isFinite(sample.rss));
  if (withMemory.length < 3) return { sufficient: false, reason: 'samples carry no memory figures' };

  // Split the run in halves and compare, which is more robust than endpoints.
  const middle = Math.floor(withMemory.length / 2);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstHalf = mean(withMemory.slice(0, middle).map((sample) => sample.rss));
  const secondHalf = mean(withMemory.slice(middle).map((sample) => sample.rss));
  const growth = secondHalf - firstHalf;
  const growthRatio = firstHalf > 0 ? growth / firstHalf : 0;

  return {
    sufficient: true,
    samples: withMemory.length,
    firstHalfMeanBytes: Math.round(firstHalf),
    secondHalfMeanBytes: Math.round(secondHalf),
    growthBytes: Math.round(growth),
    growthRatio,
    // 10% between halves over a long run is worth looking at; a little noise is not.
    verdict: growthRatio > 0.1 ? 'growing' : 'stable',
    reason: growthRatio > 0.1
      ? `memory grew ${(growthRatio * 100).toFixed(1)}% between halves; investigate before shipping`
      : 'memory did not grow meaningfully between halves',
  };
}