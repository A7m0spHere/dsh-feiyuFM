// The A09/R2 evidence recorder.
//
// A09 claims two hours of autonomous listening adds zero model requests and no
// per-turn music context. That is only meaningful if it is measured, so these
// tests check the measurement itself: the counters count, the prompt surface is
// recorded once, and a trend can tell "stable" from "growing".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunRecorder, summarizeTrend, REQUEST_KINDS } from '../src/runtime/recorder.mjs';

test('the recorder counts requests by kind and proves a zero model count', () => {
  let clock = 0;
  const recorder = createRunRecorder({ now: () => clock });
  recorder.request('local', 'snapshot');
  recorder.request('local', 'snapshot');
  recorder.request('local', 'command');
  recorder.request('platform', 'transport');
  recorder.request('computation', 'selection');
  clock += 7_200_000; // two hours

  const report = recorder.report();
  assert.equal(report.modelRequests, 0, 'the music layer made no model request');
  assert.equal(report.a09.holds, true);
  assert.match(report.a09.statement, /no model requests/);
  assert.equal(report.counts.local.snapshot, 2);
  assert.equal(report.counts.platform.transport, 1);
  assert.equal(report.elapsedMs, 7_200_000);
});

test('a model request would be recorded loudly rather than hidden', () => {
  const recorder = createRunRecorder({ now: () => 0 });
  recorder.request('model', 'llm');
  const report = recorder.report();
  assert.equal(report.modelRequests, 1);
  assert.equal(report.a09.holds, false);
  assert.match(report.a09.statement, /1 model request/);
  assert.equal(report.events.some((event) => event.type === 'model-request'), true);
});

test('the prompt surface is recorded once and stays static', () => {
  let clock = 0;
  const recorder = createRunRecorder({ now: () => clock });
  const first = recorder.registerPromptSurface({ tools: ['fishfm_status', 'fishfm_control', 'fishfm_request_track'], commands: ['fishfm', 'fishfm-pause', 'fishfm-next'] });
  assert.equal(first.registrations, 1);
  clock += 60_000;
  // Nothing in a turn may re-register it; this is what "no per-turn injection"
  // means in practice.
  const report = recorder.report();
  assert.equal(report.promptSurface.registrations, 1);
  assert.equal(report.promptSurface.tools.length, 3, 'three tools, the fixed surface');
  assert.equal(report.promptSurface.commands.length, 3);
  assert.equal(report.promptSurface.registeredAt, 0, 'registered at load, not later');
});

test('samples are bounded and keep their shape', () => {
  let clock = 0;
  const recorder = createRunRecorder({ now: () => clock, keepSamples: 5, memoryProbe: () => ({ rss: 100 + clock, heapUsed: 50, external: 5 }) });
  for (let index = 0; index < 20; index += 1) {
    clock += 1000;
    recorder.sample({ label: index % 2 ? 'playing' : 'idle' });
  }
  const report = recorder.report();
  assert.equal(report.sampleCount, 5, 'the sample buffer stays bounded over a long run');
  assert.equal(report.samples.length, 5, 'and the retained samples are reported');
  // The window starts at the oldest retained sample: with 20 taken and 5 kept,
  // that is the 16th, whose rss is 100 + 16000.
  assert.equal(report.memory.firstRss, 16_100);
  assert.equal(report.memory.lastRss, 20_100, 'and ends at the newest');
});

test('the trend tells stable from growing, and refuses to judge too little data', () => {
  const flat = Array.from({ length: 10 }, (_, index) => ({ at: index, rss: 100_000_000 + (index % 2 ? 500_000 : -500_000) }));
  const stable = summarizeTrend(flat);
  assert.equal(stable.sufficient, true);
  assert.equal(stable.verdict, 'stable');

  const climbing = Array.from({ length: 10 }, (_, index) => ({ at: index, rss: 100_000_000 + index * 5_000_000 }));
  const growing = summarizeTrend(climbing);
  assert.equal(growing.verdict, 'growing');
  assert.match(growing.reason, /investigate/);

  assert.equal(summarizeTrend([{ rss: 1 }]).sufficient, false);
  assert.match(summarizeTrend([]).reason, /not enough samples/);
  assert.match(summarizeTrend([{ at: 1 }, { at: 2 }, { at: 3 }]).reason, /no memory figures/);
});

test('the report is written sanitized: counts and sizes only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fishfm-report-'));
  try {
    const recorder = createRunRecorder({ now: () => 0, memoryProbe: () => ({ rss: 1, heapUsed: 2 }) });
    recorder.request('platform', 'transport');
    recorder.sample({ label: 'playing' });
    const { path, report } = recorder.write(directory, { name: 'run-report.json' });
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text);
    assert.equal(parsed.counts.platform.transport, 1);
    assert.equal(parsed.modelRequests, 0);
    // Nothing that could be a secret, a handle or a URL may appear.
    for (const forbidden of ['MUSIC_U', 'http://', 'https://', 'cookie', 'token', 'handle:']) {
      assert.equal(text.includes(forbidden), false, `the report must not contain ${forbidden}`);
    }
    assert.equal(report.a09.holds, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a recorder without a directory refuses to write rather than writing somewhere surprising', () => {
  const recorder = createRunRecorder();
  assert.throws(() => recorder.write(), /directory is required/);
});

test('the declared request kinds cover what the layer actually does', () => {
  // The model kind is the one A09 cares about; the others must exist so that
  // local and platform work is never miscounted as model work.
  assert.deepEqual(Object.keys(REQUEST_KINDS).sort(), ['computation', 'local', 'model', 'platform']);
  assert.deepEqual([...REQUEST_KINDS.model], ['llm']);
  assert.ok(REQUEST_KINDS.local.includes('session-event'));
  assert.ok(REQUEST_KINDS.platform.includes('transport'));
});