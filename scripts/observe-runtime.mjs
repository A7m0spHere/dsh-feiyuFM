#!/usr/bin/env node
// Observe the existing plugin; never open its database or launch a second Core.
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readRuntimeEvidence } from '../src/runtime/evidence.mjs';
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const directory = resolve(value('--directory', join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'fishfm', 'runtime')));
const seconds = Number(value('--seconds', '0'));
if (!Number.isFinite(seconds) || seconds < 0) throw new Error('--seconds must be nonnegative');
const startedAt = Date.now(), initial = readRuntimeEvidence(directory);
if (!initial.components.core || initial.components.core.stale) throw new Error('No fresh Core evidence; restart/enable the plugin first');
const deadline = startedAt + seconds * 1000;
while (Date.now() < deadline) await delay(Math.min(5000, deadline - Date.now()));
const final = readRuntimeEvidence(directory);
const result = { mode: 'real-observation', startedAt, elapsedMs: Date.now() - startedAt, initial, final, sameRun: initial.components.core.runId === final.components.core?.runId };
const out = value('--out', null);
if (out) writeFileSync(resolve(out), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ mode: result.mode, elapsedMs: result.elapsedMs, sameRun: result.sameRun, coreFresh: !final.components.core?.stale, counts: final.components.core?.counts, dshModelRequests: null, a09Passed: null, ...(out ? { report: resolve(out) } : {}) }, null, 2));
