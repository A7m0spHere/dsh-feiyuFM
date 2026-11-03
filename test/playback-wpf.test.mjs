// Real WPF regression: no play command is sent, so this test cannot emit sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaybackSupervisor } from '../src/playback/supervisor.mjs';
import { PlaybackService } from '../src/playback/service.mjs';
import { wpfBackend, powerShellCandidates, WPF_HOST_SCRIPT } from '../src/playback/backends.mjs';

function silentWav(seconds = 2, sampleRate = 8000) {
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for ' + what);
}

test('WPF playback pump reports runtime failures and sustained stalls once, preserving pause and real progress',
  { skip: process.platform !== 'win32' }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fishfm-pump-'));
    const script = join(directory, 'pump.ps1');
    // Execute the actual host functions with a controlled timeline, rather than
    // depending on a codec/network failure to happen at a particular instant.
    writeFileSync(script, `param([string]$HostScript)
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($HostScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$names = @('Get-State', 'Get-Position', 'Step-Playback', 'Fail-Playback')
foreach ($function in $ast.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
}, $true)) { Invoke-Expression $function.Extent.Text }
$script:events = @()
function Send-Event($name, $extra) { $script:events += @{ event = $name; instance = $script:instance; version = $script:version; extra = $extra } }
function Write-Marker($text) { }
$script:player = [pscustomobject]@{ Position = [TimeSpan]::Zero }
$script:player | Add-Member ScriptMethod Stop { }
$script:player | Add-Member ScriptMethod Close { }
$script:instance = 'pump'; $script:version = 7
$script:durationMs = 10000; $script:muted = $true; $script:seekSupported = $true; $script:resource = 'fake:pump'
$script:progressWatch = [System.Diagnostics.Stopwatch]::new()
$script:stallTimeoutMs = 15000
$script:status = 'playing'; $script:failed = 'media_failed'; $script:failedMessage = 'stream failed'
$script:positionAtPlay = 0; $script:lastProgress = -1; $script:startedSent = $false
Step-Playback; Step-Playback
$failedState = Get-State
$failureEvents = @($script:events)
$script:events = @(); $script:failed = $null; $script:failedMessage = $null; $script:status = 'playing'
$script:progressWatch.Restart()
Step-Playback
$briefEvents = $script:events.Count
# Paused timelines never raise a stall, even with a stopped/expired clock.
$script:status = 'paused'; $script:stallTimeoutMs = 0
Step-Playback
$pausedEvents = $script:events.Count
# Real progress wins over an expired deadline.
$script:status = 'playing'; $script:player.Position = [TimeSpan]::FromMilliseconds(1000)
Step-Playback
$advancedStatus = $script:status
$advancedEvent = $script:events[-1].event
# The same frozen timeline must now fail once and remain discoverable in state.
$script:events = @()
Step-Playback; Step-Playback
$stalledState = Get-State
@{ failure = $failedState; failureEvents = $failureEvents; briefEvents = $briefEvents; pausedEvents = $pausedEvents;
 advancedStatus = $advancedStatus; advancedEvent = $advancedEvent; stall = $stalledState; stallEvents = @($script:events) } | ConvertTo-Json -Depth 8 -Compress
`, 'utf8');
    try {
      // Verify syntax and behavior in every installed product shell.
      let checked = 0;
      for (const candidate of powerShellCandidates().filter(item => item.source !== 'override')) {
        let output;
        try { output = await promisify(execFile)(candidate.command,
          [...candidate.args, script, '-HostScript', WPF_HOST_SCRIPT], { windowsHide: true, timeout: 15000 }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const result = JSON.parse(output.stdout.trim());
        checked++;
        assert.equal(result.failure.status, 'error', candidate.label);
        assert.equal(result.failure.errorCode, 'media_failed');
        assert.equal(result.failure.playInstanceId, 'pump');
        assert.equal(result.failureEvents.length, 1);
        assert.equal(result.failureEvents[0].extra.retryable, true);
        assert.equal(result.briefEvents, 0);
        assert.equal(result.pausedEvents, 0);
        assert.equal(result.advancedStatus, 'playing');
        assert.equal(result.advancedEvent, 'started');
        assert.equal(result.stall.errorCode, 'media_stalled');
        assert.equal(result.stallEvents.length, 1);
      }
      assert.ok(checked > 0, 'at least one PowerShell must execute the host functions');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

test('WPF accepts stop while a remote media open is stalled', { skip: process.platform !== 'win32' }, async () => {
  let requested;
  const received = new Promise(resolve => { requested = resolve; });
  const server = createServer(() => requested()); // Deliberately withhold HTTP headers.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const supervisor = new PlaybackSupervisor({ backend: wpfBackend() });
  const service = new PlaybackService({ supervisor, openTimeoutMs: 8000, commandTimeoutMs: 1500 });
  const controller = new AbortController();
  let loading;
  let cancelled;
  let guard;
  try {
    await supervisor.ensureHost();
    await service.setMuted({ muted: true, version: 1 });
    loading = service.load({ resource: { handle: `http://127.0.0.1:${server.address().port}/stalled.wav` }, playInstanceId: 'stalled-open', version: 1, signal: controller.signal });
    cancelled = assert.rejects(loading, error => error.code === 'cancelled');
    cancelled.catch(() => {});
    await Promise.race([received, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('WPF did not request the test media')), 5000); })]);
    clearTimeout(guard);
    controller.abort();
    await cancelled;
    const started = performance.now();
    await service.stop({ version: 2 });
    assert.ok(performance.now() - started < 1500, 'stop must not wait for the old media-open deadline');
    assert.equal(supervisor.connected, true);
    assert.equal((await service.hostSnapshot()).status, 'idle');
    assert.equal(supervisor.transport.pending.size, 0, 'superseded load must also receive an acknowledgement');
  } finally {
    clearTimeout(guard); controller.abort();
    await loading?.catch(() => {});
    await cancelled?.catch(() => {});
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await service.close({ gracefulTimeoutMs: 1500 });
    await closed;
  }
});

test('WPF re-opens the same source after a resume-style reload', { skip: process.platform !== 'win32' }, async () => {
  // The reuse-player path must not assume Open() on the same source fires
  // MediaOpened again: a resume/recovery reload has to tear the old media down.
  const wav = silentWav(2);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length });
    response.end(wav);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/same.wav';
  const supervisor = new PlaybackSupervisor({ backend: wpfBackend({ warmHolders: 0 }) });
  const service = new PlaybackService({ supervisor, openTimeoutMs: 8000, commandTimeoutMs: 3000 });
  const events = [];
  service.onEvent((event) => events.push(event));
  try {
    await supervisor.ensureHost();
    await service.setMuted({ muted: true, version: 1 });
    await service.load({ resource: { handle: url }, playInstanceId: 'same-1', version: 2 });
    await service.play({ playInstanceId: 'same-1', version: 2 });
    await waitFor(() => events.some((event) => event.type === 'started' && event.playInstanceId === 'same-1'), 8000, 'first start');

    // A pause result must refresh the cached host state, or a resume can never
    // be recognised as directly resumable.
    await service.pause({ version: 2 });
    assert.equal(service.canResume({ playInstanceId: 'same-1' }), true, 'a paused host must be directly resumable');
    await service.play({ playInstanceId: 'same-1', version: 2 });

    const started = performance.now();
    await service.load({ resource: { handle: url }, playInstanceId: 'same-2', version: 3 });
    await service.play({ playInstanceId: 'same-2', version: 3 });
    await waitFor(() => events.some((event) => event.type === 'started' && event.playInstanceId === 'same-2'), 8000, 'second start');
    assert.ok(performance.now() - started < 6000, 're-opening the same handle must not wait out the open timeout');
  } finally {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await service.close({ gracefulTimeoutMs: 3000 });
    await closed;
  }
});
