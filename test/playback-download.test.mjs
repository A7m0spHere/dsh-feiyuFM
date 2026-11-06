// Exercise the production C# downloader and PowerShell command pump without an
// audio device. Windows runs both installed shells; other hosts may opt in to a
// portable pwsh with FISHFM_TEST_PWSH. This does not prove WPF decoding/audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { powerShellCandidates, WPF_HOST_SCRIPT } from '../src/playback/backends.mjs';

const shells = process.platform === 'win32'
  ? powerShellCandidates().filter(item => item.source !== 'override')
  : process.env.FISHFM_TEST_PWSH ? [{ command: process.env.FISHFM_TEST_PWSH, label: 'portable pwsh' }] : [];
const fixture = Buffer.from('synthetic audio fixture: never decoded or played');

test('anonymous WPF staging handles redirects, cancellation, limits and only opens completed local files',
  { skip: !shells.length, timeout: 60000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fishfm-download-test-'));
    const requests = [];
    const server = createServer((request, response) => {
      requests.push({ path: request.url, headers: request.headers });
      const path = request.url.split('?')[0];
      if (path === '/redirect') {
        response.writeHead(302, { location: '/ok.wav', 'set-cookie': 'private-cookie=synthetic' }); response.end();
      } else if (path === '/ok.wav') {
        response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': fixture.length }); response.end(fixture);
      } else if (path === '/auth') {
        response.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"' }); response.end();
      } else if (path === '/large') {
        response.writeHead(200, { 'content-length': 65 * 1024 * 1024 }); response.end();
      } else if (path === '/chunked-large') {
        response.writeHead(200, { 'transfer-encoding': 'chunked' }); response.end(Buffer.alloc(64 * 1024 * 1024 + 1));
      } else if (path === '/empty') {
        response.writeHead(200, { 'content-length': 0 }); response.end();
      } else if (path === '/bad-redirect') {
        response.writeHead(302, { location: 'file:///private-synthetic-file.wav' }); response.end();
      } else if (path === '/loop') {
        response.writeHead(302, { location: '/loop' }); response.end();
      } else if (path === '/truncated') {
        response.writeHead(200, { 'content-length': fixture.length * 2 });
        response.write(fixture); setTimeout(() => response.destroy(), 20);
      } else if (path === '/stall') {
        response.writeHead(200); response.write(fixture); // Keep body pending.
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const script = join(directory, 'download.ps1');
    writeFileSync(script, `param([string]$HostScript, [string]$BaseUrl, [string]$Directory)
$ErrorActionPreference = 'Stop'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($HostScript,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors|Out-String) }
$names=@('Initialize-MediaDownload','Start-MediaDownload','Step-MediaCleanup',
 'Invoke-Command','Step-MediaOpen','Step-Preload','Stop-Playback','Stop-Preload',
 'Reset-PlaybackState','Get-Position','Cancel-Seek','Resolve-Resource')
foreach ($f in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$true)) {
 Invoke-Expression $f.Extent.Text
}
Initialize-MediaDownload
$script:mediaDirectory=Join-Path $Directory 'media'; $script:mediaDownloads=@()
$script:playerDownload=$null; $script:preloadDownload=$null
$script:pendingOpen=$null; $script:preload=$null; $script:preloadReady=$null; $script:pendingSeek=$null
$script:acceptedVersion=-1; $script:reusePlayer=$true; $script:volume=0; $script:muted=$true
$script:progressWatch=[System.Diagnostics.Stopwatch]::new()
$script:results=@(); $script:opens=@()
function Write-Marker($text) { }
function Send-Result($id,$extra) { $script:results+=@{id=$id;ok=$true;extra=$extra} }
function Send-ResultError($id,$code,$message,$retryable=$false,$extra=$null) { $script:results+=@{id=$id;ok=$false;code=$code;message=$message} }
function New-Player {
 $p=[pscustomobject]@{ Position=[TimeSpan]::Zero; IsMuted=$true; Volume=0; NaturalDuration=[pscustomobject]@{HasTimeSpan=$false} }
 $p|Add-Member ScriptMethod Open { param($uri)
   if (-not $uri.IsFile) { throw 'remote URI reached player' }
   if (-not [System.IO.File]::Exists($uri.LocalPath)) { throw 'missing staging file' }
   $script:opens+=@{file=$uri.IsFile;content=[System.IO.File]::ReadAllText($uri.LocalPath)}
   if ($this -eq $script:player) { $script:opened=$true } else { $script:preload.opened=$true }
 }
 foreach ($name in @('Stop','Close','Pause','Play')) { $p|Add-Member ScriptMethod $name { } }
 return $p
}
$script:player=New-Player; $script:preloadPlayer=New-Player
Reset-PlaybackState
function Command($type,$id,$resource='',$version=1,$timeout=5000,$usePreload=$false) {
 $script:commandWatch=[System.Diagnostics.Stopwatch]::StartNew()
 Invoke-Command ([pscustomobject]@{type=$type;id=$id;resource=$resource;version=$version;playInstanceId=$id;openTimeoutMs=$timeout;usePreload=$usePreload})
}
function Wait-Result($id) {
 $deadline=(Get-Date).AddSeconds(8)
 while (-not ($script:results|Where-Object {$_.id -eq $id}) -and (Get-Date) -lt $deadline) {
   Step-MediaOpen; Step-Preload; Step-MediaCleanup; Start-Sleep -Milliseconds 10
 }
 if (-not ($script:results|Where-Object {$_.id -eq $id})) { throw "unsettled $id" }
}
function Wait-Cleanup {
 $deadline=(Get-Date).AddSeconds(3)
 while ($script:mediaDownloads.Count -and (Get-Date) -lt $deadline) { Step-MediaCleanup; Start-Sleep -Milliseconds 10 }
 if ($script:mediaDownloads.Count) { throw 'download not cleaned' }
}
Command 'load' 'first' "$BaseUrl/redirect?token=synthetic"
Wait-Result 'first'
# A completed preload swaps the same local file without fetching it again.
Command 'preload' 'standby' "$BaseUrl/ok.wav"
Wait-Result 'standby'
$staged=$script:preloadDownload.FilePath
Command 'load' 'swapped' "$BaseUrl/ok.wav" 2 5000 $true
Wait-Result 'swapped'
$swapPreserved=$script:playerDownload.FilePath -eq $staged -and (Test-Path -LiteralPath $staged)
Command 'stop' 'stop' '' 3
Stop-Preload
Wait-Cleanup
# Fetch/HTTP failures never invoke the decoder or leak exception details.
foreach ($path in @('auth','large','chunked-large','empty','bad-redirect','loop','truncated')) {
 Command 'load' $path "$BaseUrl/$path" 4
 Wait-Result $path
}
Command 'load' 'timed' "$BaseUrl/stall" 5 150
Wait-Result 'timed'
# pause and preloadCancel settle the original command during a body stall.
Command 'load' 'cancel-active' "$BaseUrl/stall" 6
Start-Sleep -Milliseconds 100
$script:opened=$true # A stale event cannot finish a new download.
Step-MediaOpen
$watch=[System.Diagnostics.Stopwatch]::StartNew()
Command 'pause' 'pause' '' 7
$pauseMs=$watch.ElapsedMilliseconds
Command 'preload' 'cancel-standby' "$BaseUrl/stall" 7
Start-Sleep -Milliseconds 100
$script:preload.opened=$true
Step-Preload
Command 'preloadCancel' 'cancel' '' 7
Command 'load' 'old' "$BaseUrl/stall" 8
Command 'load' 'new' "$BaseUrl/ok.wav" 9
Wait-Result 'new'
Command 'stop' 'final-stop' '' 10
Stop-Preload
Wait-Cleanup
@{results=$script:results;opens=$script:opens;swapPreserved=$swapPreserved;pauseMs=$pauseMs;
remaining=@(Get-ChildItem -LiteralPath $script:mediaDirectory -File).Count} | ConvertTo-Json -Depth 8 -Compress
`, 'utf8');
    try {
      let checked = 0;
      for (const shell of shells) {
        let output;
        try {
          output = await promisify(execFile)(shell.command, ['-NoProfile', '-File', script,
            '-HostScript', WPF_HOST_SCRIPT, '-BaseUrl', `http://127.0.0.1:${server.address().port}`, '-Directory', directory],
          { windowsHide: true, timeout: 25000 });
        } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        checked++;
        const result = JSON.parse(output.stdout.trim());
        const answers = new Map(result.results.map(item => [item.id, item]));
        for (const id of ['first', 'standby', 'swapped', 'new']) assert.equal(answers.get(id).ok, true, `${shell.label}: ${id}`);
        for (const id of ['auth', 'large', 'chunked-large', 'empty', 'bad-redirect', 'loop', 'truncated']) {
          assert.equal(answers.get(id).ok, false, id);
          assert.equal(answers.get(id).code, 'media_download_failed', id);
          assert.equal(answers.get(id).message, 'Anonymous media download failed', id);
        }
        assert.ok(['media_open_timeout', 'media_download_failed'].includes(answers.get('timed').code));
        for (const id of ['cancel-active', 'cancel-standby', 'old']) assert.equal(answers.get(id).code, 'cancelled', id);
        assert.equal(result.opens.length, 3, 'only completed foreground, standby, replacement files open');
        assert.ok(result.opens.every(item => item.file && item.content === fixture.toString()));
        assert.equal(result.swapPreserved, true);
        assert.ok(result.pauseMs < 1000, 'pause does not await the body timeout');
        assert.equal(result.remaining, 0, 'success, failure and cancellation all clean up files');
        assert.equal(output.stdout.includes('http://'), false);
      }
      assert.ok(checked > 0);
      for (const { headers } of requests) {
        assert.equal(headers.cookie, undefined);
        assert.equal(headers.authorization, undefined);
        assert.equal(headers['proxy-authorization'], undefined);
      }
      assert.equal(requests.filter(item => item.path === '/auth').length, checked, 'no default-credential auth retry');
      assert.equal(requests.filter(item => item.path === '/loop').length, checked * 6, 'redirects are bounded');
    } finally {
      const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed;
      rmSync(directory, { recursive: true, force: true });
    }
  });
