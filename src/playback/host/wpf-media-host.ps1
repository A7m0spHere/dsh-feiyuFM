# FishFM audio host: a hidden STA PowerShell process driving WPF MediaPlayer.
#
# It owns sound only. It never decides what to play, never selects the next
# track, and never touches the database. The music core talks to it over a
# same-user named pipe using the protocol in ../protocol.mjs.
#
# Verified behaviours this script must preserve (P0-04 findings):
#   - MediaOpened/MediaFailed arrive asynchronously: a load command must wait
#     for one of them, bounded by openTimeoutMs, and never report success just
#     because Open()/Play() returned.
#   - A late MediaOpened must not overwrite a newer status.
#   - Reading Position immediately after a resume can transiently report 0, so
#     progress is only ever reported forward, and 'started' requires the
#     timeline to actually advance past where playback began.
#   - Muting keeps the audio timeline running, so a silent track still ends.
#   - The player survives the client disconnecting: it keeps playing and a new
#     client gets a fresh greeting plus a state snapshot.
#   - When the owning process disappears, the host stops and exits so no audio
#     is left behind.
param(
  [Parameter(Mandatory = $true)][string]$PipeName,
  [int]$OwnerPid = 0,
  [int]$ProtocolVersion = 1,
  [double]$Volume = 0.35,
  # How many silent resources to hold open, so the audio engine stays warm.
  # 0 disables warming. The 2026-10-06 recheck needed five holders to keep
  # subsequent loads under 1 s; four no longer reached the fast path on this
  # machine. See docs/spikes/N20-review-fixes.md. The threshold can vary.
  [int]$WarmHolders = 5,
  # Default pools may grow to eight until an actual holder opens quickly.
  # Explicit Node/backend pool sizes disable this unless requested otherwise.
  [int]$AdaptiveWarm = 1,
  # Overrides the silent resource the warm holders keep open. Left empty, the host
  # writes its own into the temp directory: audio must never be committed to this
  # repository (AGENTS.md), so the resource is generated rather than shipped.
  [string]$WarmResource = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$script:protocol = 1
$script:tickMs = 200
$script:ownerPid = $OwnerPid
$script:running = $true
$script:volume = [Math]::Max(0.0, [Math]::Min(1.0, $Volume))

$script:player = [System.Windows.Media.MediaPlayer]::new()
$script:player.Volume = $script:volume
$script:pendingOpen = $null

# Warm-up state. WPF's media stack is only fast once enough resources are open
# in the process: the first Open after idle costs several seconds. The current
# default holds five open resources (N20). Warming therefore fills a pool of
# muted, never-played holder players, one at a time, and only while a track is
# playing: a load issued while a holder Open is in flight pays 6.5-8.5 s instead
# of 4.6 s, so warming yields to real work and starts only after the first track
# has been served.
$script:warmTarget = [Math]::Max(0, [Math]::Min(8, $WarmHolders))
$script:warmPool = @()
$script:warmPath = $null
$script:warmArmed = $false
$script:warmPending = $null
$script:warmFailures = 0
$script:warmGenerated = $null
$script:warmComplete = $false
$script:warmAdaptive = $AdaptiveWarm -ne 0

# Playback facts. Status is host-owned; the core has its own richer state.
$script:status = 'idle'
$script:instance = $null
$script:version = $null
$script:acceptedVersion = -1
$script:muted = $false
$script:resource = $null
$script:durationMs = $null
$script:opened = $false
$script:failed = $null
$script:failedMessage = $null
$script:startedSent = $false
$script:positionAtPlay = 0
$script:lastProgress = -1
$script:seekSupported = $null

# Pipe server state; at most one client at a time.
$script:server = $null
$script:writer = $null
$script:reader = $null
$script:connectTask = $null
$script:readTask = $null

function Write-Marker([string]$text) {
  Write-Output "FISHFM_PLAYBACK_$text"
}

function Get-Position {
  try {
    $value = [int][Math]::Round($script:player.Position.TotalMilliseconds)
    if ($value -lt 0) { return 0 }
    return $value
  } catch {
    return 0
  }
}

function Get-State {
  return @{
    status = $script:status
    playInstanceId = $script:instance
    version = $script:version
    positionMs = (Get-Position)
    durationMs = $script:durationMs
    muted = $script:muted
    seek = $script:seekSupported
    resource = $script:resource
  }
}

function Send-Message($value) {
  if ($null -eq $script:writer) { return }
  $value['v'] = $script:protocol
  try {
    $script:writer.WriteLine(($value | ConvertTo-Json -Compress -Depth 8))
  } catch {
    # A broken client must not take the audio down; the next client reconnects.
    # This is safe because connections are strictly serialized below: a new
    # server (and writer) is only created after the previous client's EOF has
    # been observed, so a late failure can never clear a newer client's writer.
    $script:writer = $null
  }
}

function Send-Event([string]$eventName, [hashtable]$extra) {
  $payload = @{ type = 'event'; event = $eventName; playInstanceId = $script:instance; version = $script:version }
  if ($null -ne $extra) {
    foreach ($key in $extra.Keys) { $payload[$key] = $extra[$key] }
  }
  Send-Message $payload
}

function Send-Result([string]$id, $extra) {
  $payload = @{ type = 'result'; id = $id; ok = $true; state = (Get-State) }
  if ($null -ne $extra) {
    foreach ($key in $extra.Keys) { $payload[$key] = $extra[$key] }
  }
  Send-Message $payload
}

function Send-ResultError([string]$id, [string]$code, [string]$message, [bool]$retryable = $false) {
  Send-Message @{
    type = 'result'
    id = $id
    ok = $false
    error = @{ code = $code; message = $message; retryable = $retryable }
    state = (Get-State)
  }
}

function Pump {
  [System.Windows.Forms.Application]::DoEvents()
}

# Returns the position actually reached, or 0 when the seek did not take.
function Set-PlaybackPosition([int]$targetMs) {
  if ($targetMs -le 0) { return 0 }
  try {
    $script:player.Position = [TimeSpan]::FromMilliseconds($targetMs)
  } catch {
    return 0
  }
  $deadline = (Get-Date).AddMilliseconds(1200)
  while ((Get-Date) -lt $deadline) {
    $position = Get-Position
    if ($position -gt 0 -and [Math]::Abs($position - $targetMs) -le 1500) { return $position }
    Pump
    Start-Sleep -Milliseconds 25
  }
  $position = Get-Position
  if ($position -gt 0 -and [Math]::Abs($position - $targetMs) -le 3000) { return $position }
  try { $script:player.Position = [TimeSpan]::Zero } catch { }
  return 0
}

function Resolve-Resource([string]$value) {
  if ($value -match '^(https?|file)://') { return [System.Uri]::new($value) }
  if (-not (Test-Path -LiteralPath $value -PathType Leaf)) {
    throw "Resource is not a readable local file or URL"
  }
  return [System.Uri]::new((Resolve-Path -LiteralPath $value).Path)
}

# Writes the silent WAV the warm holders keep open: 8 kHz mono 16-bit, 0.5 s, every
# sample zero (8044 bytes). It is generated here rather than committed because audio
# must never enter the repository (AGENTS.md), and generating it means a fresh clone
# works with no build step. Zero samples plus Volume 0 plus IsMuted make the holders
# inaudible even if one were ever played, which it is not.
function Write-SilentWav([string]$path) {
  $frames = 4000
  $dataBytes = $frames * 2
  $buffer = New-Object byte[] (44 + $dataBytes)
  [System.Text.Encoding]::ASCII.GetBytes('RIFF').CopyTo($buffer, 0)
  [BitConverter]::GetBytes([uint32](36 + $dataBytes)).CopyTo($buffer, 4)
  [System.Text.Encoding]::ASCII.GetBytes('WAVE').CopyTo($buffer, 8)
  [System.Text.Encoding]::ASCII.GetBytes('fmt ').CopyTo($buffer, 12)
  [BitConverter]::GetBytes([uint32]16).CopyTo($buffer, 16)
  [BitConverter]::GetBytes([uint16]1).CopyTo($buffer, 20)   # PCM
  [BitConverter]::GetBytes([uint16]1).CopyTo($buffer, 22)   # mono
  [BitConverter]::GetBytes([uint32]8000).CopyTo($buffer, 24)
  [BitConverter]::GetBytes([uint32]16000).CopyTo($buffer, 28)
  [BitConverter]::GetBytes([uint16]2).CopyTo($buffer, 32)
  [BitConverter]::GetBytes([uint16]16).CopyTo($buffer, 34)
  [System.Text.Encoding]::ASCII.GetBytes('data').CopyTo($buffer, 36)
  [BitConverter]::GetBytes([uint32]$dataBytes).CopyTo($buffer, 40)
  [System.IO.File]::WriteAllBytes($path, $buffer)
  return $buffer.Length
}

# Resolves the silent resource the warm holders keep open.
#
# It is generated here rather than shipped as an asset for two reasons: audio must
# never enter the repository (AGENTS.md), and a file the host makes itself works
# identically from src/ and from a built dist/ with no build step. A per-process
# name means concurrent hosts cannot race over one file. Anything that fails here
# means warming is off: a cold engine is slower, never broken.
function Resolve-WarmResource {
  if ($script:warmTarget -le 0) { return $null }
  $candidate = $WarmResource
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    # Per-process name: two hosts starting at once cannot race over one file, and
    # Stop-WarmHolders removes it. A crash leaves an 8 KB file in the temp dir.
    $candidate = Join-Path ([System.IO.Path]::GetTempPath()) "fishfm-warm-silence-$PID.wav"
    try { $null = Write-SilentWav $candidate } catch { return $null }
    $script:warmGenerated = $candidate
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  try { return [System.Uri]::new((Resolve-Path -LiteralPath $candidate).Path) } catch { return $null }
}

function Stop-WarmHolders {
  foreach ($record in $script:warmPool) {
    try { $record.player.Stop() } catch { }
    try { $record.player.Close() } catch { }
  }
  $script:warmPool = @()
  # An in-flight holder is a real player too; leaving it open would keep a resource
  # the process is about to abandon.
  if ($null -ne $script:warmPending) {
    try { $script:warmPending.player.Close() } catch { }
    $script:warmPending = $null
  }
  if ($null -ne $script:warmGenerated) {
    try { Remove-Item -LiteralPath $script:warmGenerated -Force } catch { }
    $script:warmGenerated = $null
  }
}

# One place decides when warming gives up, so a synchronous rejection cannot retry
# forever while the asynchronous path counts toward the same ceiling.
function Fail-Warm([string]$reason) {
  $script:warmFailures += 1
  Write-Marker "WARM_FAILED reason=$reason count=$($script:warmFailures)"
  if ($script:warmFailures -ge 3) {
    $script:warmPath = $null
    Write-Marker 'WARM_DISABLED reason=repeated-failure'
  }
}

# Starts one holder. The player is muted and never played, so it holds the audio
# engine open without producing sound or a timeline.
function Start-WarmHolder {
  $player = [System.Windows.Media.MediaPlayer]::new()
  $player.Volume = 0
  try { $player.IsMuted = $true } catch { }
  $record = @{ player = $player; opened = $false; failed = $false; deadline = (Get-Date).AddMilliseconds(20000); watch = [System.Diagnostics.Stopwatch]::StartNew() }
  # The sender is the only reliable way to tell holders apart: several share one
  # handler shape, and a shared flag would let one holder's event settle another.
  $player.add_MediaOpened({
    param($sender, $eventArgs)
    foreach ($item in $script:warmPool) { if ($item.player -eq $sender) { $item.opened = $true } }
    if ($null -ne $script:warmPending -and $script:warmPending.player -eq $sender) { $script:warmPending.opened = $true }
  })
  $player.add_MediaFailed({
    param($sender, $eventArgs)
    foreach ($item in $script:warmPool) { if ($item.player -eq $sender) { $item.failed = $true } }
    if ($null -ne $script:warmPending -and $script:warmPending.player -eq $sender) { $script:warmPending.failed = $true }
  })
  $script:warmPending = $record
  try { $player.Open($script:warmPath) } catch {
    $script:warmPending = $null
    try { $player.Close() } catch { }
    Fail-Warm 'open-rejected'
  }
}


# Warming runs only while the host is idle and a track is actually playing. A
# holder Open issued while a real load is in flight slows that load (measured:
# ~5.8-6.2 s for the next track versus 4.6-5.1 s cold), so the pool fills in the
# long gaps during playback instead of competing for the engine. A short track may
# never fill it, which only means the next load is as slow as it is today.
function Step-Warm {
  if (-not $script:warmArmed -or $null -eq $script:warmPath) { return }
  if ($script:warmComplete) { return }
  if ($script:status -ne 'playing') { return }
  if ($null -ne $script:pendingOpen) { return }
  $pending = $script:warmPending
  if ($null -ne $pending) {
    if ($pending.failed -or (Get-Date) -ge $pending.deadline) {
      $script:warmPending = $null
      try { $pending.player.Close() } catch { }
      Fail-Warm $(if ($pending.failed) { 'media-failed' } else { 'open-timeout' })
      return
    }
    if (-not $pending.opened) { return }
    $script:warmPending = $null
    $script:warmPool += $pending
    $pending.watch.Stop()
    $openMs = [Math]::Round($pending.watch.Elapsed.TotalMilliseconds)
    Write-Marker "WARM_READY count=$($script:warmPool.Count) openMs=$openMs"
    if ($script:warmPool.Count -ge $script:warmTarget -and
        (-not $script:warmAdaptive -or $openMs -lt 1500 -or $script:warmPool.Count -ge 8)) {
      $script:warmComplete = $true
      Write-Marker "WARM_COMPLETE count=$($script:warmPool.Count) fast=$($openMs -lt 1500)"
    }
    return
  }
  if (-not $script:warmAdaptive -and $script:warmPool.Count -ge $script:warmTarget) { return }
  if ($script:warmPool.Count -ge 8) { return }
  Start-WarmHolder
}

function Stop-Playback {
  if ($null -ne $script:pendingOpen) {
    $cancelled = $script:pendingOpen
    $script:pendingOpen = $null
    Send-ResultError $cancelled.id 'cancelled' 'Media open was superseded by a playback control'
  }
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  $script:status = 'idle'
  $script:instance = $null
  $script:version = $null
  $script:resource = $null
  $script:durationMs = $null
  $script:opened = $false
  $script:failed = $null
  $script:startedSent = $false
  $script:positionAtPlay = 0
  $script:lastProgress = -1
}

# Media opening stays in the main event pump. Reading the pipe must continue so
# pause/stop/next can cancel an old load instead of waiting up to 12 seconds.
function Step-MediaOpen {
  $pending = $script:pendingOpen
  if ($null -eq $pending) { return }
  if ($null -ne $script:failed -or (Get-Date) -ge $pending.deadline) {
    $code = 'media_open_timeout'
    $message = "Media did not open within $($pending.timeoutMs) ms"
    if ($null -ne $script:failed) { $code = 'media_failed'; $message = $script:failedMessage }
    $script:pendingOpen = $null
    Stop-Playback
    $script:status = 'error'
    Send-ResultError $pending.id $code $message $true
    return
  }
  if (-not $script:opened) { return }
  $script:pendingOpen = $null
  try {
    $script:player.IsMuted = $script:muted
    $position = 0
    $seeked = $true
    if ($pending.startMs -gt 0) {
      $position = Set-PlaybackPosition $pending.startMs
      $seeked = $position -gt 0
      $script:seekSupported = $seeked
    }
    $script:status = 'ready'
    Send-Result $pending.id @{ positionMs = $position; seek = $seeked; muted = $script:muted; durationMs = $script:durationMs }
  } catch {
    Stop-Playback
    $script:status = 'error'
    Send-ResultError $pending.id 'media_failed' 'Could not finish opening media' $true
  }
}

$script:player.add_MediaOpened({
  $script:opened = $true
  $script:failed = $null
  try {
    $natural = $script:player.NaturalDuration
    if ($natural.HasTimeSpan) { $script:durationMs = [int][Math]::Round($natural.TimeSpan.TotalMilliseconds) }
  } catch { $script:durationMs = $null }
})

$script:player.add_MediaFailed({
  $script:failed = 'media_failed'
  $script:failedMessage = 'Media failed to open'
  try {
    if ($null -ne $script:player.ErrorException) { $script:failedMessage = $script:player.ErrorException.Message }
  } catch { }
})

$script:player.add_MediaEnded({
  $script:status = 'ended'
  $script:lastProgress = Get-Position
  Send-Event 'ended' @{ positionMs = $script:lastProgress }
  Write-Marker 'MEDIA_ENDED'
})

function Invoke-Command($command) {
  $id = [string]$command.id
  $type = [string]$command.type
  if ($null -ne $command.version) {
    if ([long]$command.version -lt $script:acceptedVersion) {
      Send-ResultError $id 'stale_version' 'Ignored an older playback command'
      return
    }
    $script:acceptedVersion = [long]$command.version
    if ($null -ne $script:instance) { $script:version = $command.version }
  }
  switch ($type) {
    'load' {
      $resource = [string]$command.resource
      if ([string]::IsNullOrWhiteSpace($resource)) {
        Send-ResultError $id 'resource_missing' 'load needs a resource handle'
        return
      }
      $instance = [string]$command.playInstanceId
      $version = $command.version
      $startMs = 0
      if ($null -ne $command.startPositionMs) { $startMs = [int]$command.startPositionMs }
      $openTimeoutMs = 12000
      if ($null -ne $command.openTimeoutMs) { $openTimeoutMs = [int]$command.openTimeoutMs }

      Stop-Playback
      $script:status = 'loading'
      $script:instance = $instance
      $script:version = $version
      $script:resource = $resource
      try {
        $uri = Resolve-Resource $resource
      } catch {
        $script:status = 'error'
        Send-ResultError $id 'unsupported_resource' 'Resource is not a readable local file or URL'
        return
      }
      try {
        $script:player.Open($uri)
      } catch {
        $script:status = 'error'
        Send-ResultError $id 'media_failed' 'Open() rejected the resource'
        return
      }
      $script:pendingOpen = @{ id = $id; startMs = $startMs; timeoutMs = $openTimeoutMs; deadline = (Get-Date).AddMilliseconds($openTimeoutMs) }
      # Warming starts only once a real load is in flight, so the first track of a
      # session is served exactly as before (cold) and the pool fills during the
      # playback that follows. Step-Warm never runs while an open is pending.
      $script:warmArmed = $true
    }
    'play' {
      if ($null -eq $script:instance) {
        Send-ResultError $id 'no_media' 'Nothing is loaded'
        return
      }
      $script:player.Play()
      $script:status = 'playing'
      $script:positionAtPlay = Get-Position
      $script:startedSent = $false
      $script:lastProgress = -1
      Send-Result $id @{ positionMs = $script:positionAtPlay }
    }
    'pause' {
      if ($null -ne $script:pendingOpen) { Stop-Playback }
      if ($null -ne $script:instance) { try { $script:player.Pause() } catch { } }
      if ($script:status -eq 'playing' -or $script:status -eq 'ready') { $script:status = 'paused' }
      Send-Result $id @{ positionMs = (Get-Position) }
    }
    'stop' {
      Stop-Playback
      Send-Result $id @{ positionMs = 0 }
    }
    'setMuted' {
      $script:muted = [bool]$command.muted
      try { $script:player.IsMuted = $script:muted } catch { }
      Send-Result $id @{ muted = $script:muted; positionMs = (Get-Position) }
    }
    'snapshot' { Send-Result $id $null }
    'ping' { Send-Result $id $null }
    'shutdown' {
      Stop-Playback
      Send-Result $id $null
      Send-Event 'exiting' @{}
      $script:running = $false
    }
    default { Send-ResultError $id 'invalid_command' "Unknown command: $type" }
  }
}

function Handle-Line([string]$line) {
  $command = $null
  try {
    $command = $line | ConvertFrom-Json
  } catch {
    Send-ResultError '' 'invalid_command' 'Command line is not JSON'
    return
  }
  try {
    Invoke-Command $command
  } catch {
    Send-ResultError ([string]$command.id) 'host_error' $_.Exception.Message
  }
}

function Step-Playback {
  if ($script:status -ne 'playing') { return }
  $position = Get-Position
  # 'started' only after the timeline really advanced; a transient 0 read after
  # a resume must not look like progress.
  if ($position -le 0 -or $position -le $script:positionAtPlay) { return }
  if (-not $script:startedSent) {
    $script:startedSent = $true
    $script:lastProgress = $position
    Send-Event 'started' @{ positionMs = $position; progressSource = 'audio' }
    return
  }
  if ($position -gt $script:lastProgress) {
    $script:lastProgress = $position
    Send-Event 'progress' @{ positionMs = $position; progressSource = 'audio' }
  }
}

$script:lastWatchdog = Get-Date
function Step-Watchdog {
  $now = Get-Date
  if (($now - $script:lastWatchdog).TotalMilliseconds -lt 1000) { return }
  $script:lastWatchdog = $now
  if ($script:ownerPid -le 0) { return }
  $alive = $true
  try { $null = [System.Diagnostics.Process]::GetProcessById($script:ownerPid) } catch { $alive = $false }
  if (-not $alive) {
    Write-Marker 'OWNER_GONE'
    Stop-Playback
    $script:running = $false
  }
}

try {
  $script:warmPath = Resolve-WarmResource
  if ($null -ne $script:warmPath) {
    Write-Marker "WARM_CONFIGURED holders=$($script:warmTarget)"
  } else {
    Write-Marker "WARM_DISABLED holders=$($script:warmTarget)"
  }
  Write-Marker "READY protocol=$script:protocol pid=$PID"
  while ($script:running) {
    if ($null -eq $script:server) {
      $script:server = [System.IO.Pipes.NamedPipeServerStream]::new(
        $PipeName,
        [System.IO.Pipes.PipeDirection]::InOut,
        1,
        [System.IO.Pipes.PipeTransmissionMode]::Byte,
        ([System.IO.Pipes.PipeOptions]::Asynchronous -bor [System.IO.Pipes.PipeOptions]::CurrentUserOnly)
      )
      $script:connectTask = $script:server.WaitForConnectionAsync()
    }
    Pump
    if ($null -eq $script:reader -and $script:connectTask.IsCompleted) {
      $script:connectTask.GetAwaiter().GetResult()
      $script:reader = [System.IO.StreamReader]::new($script:server)
      $script:writer = [System.IO.StreamWriter]::new($script:server)
      $script:writer.AutoFlush = $true
      $script:readTask = $script:reader.ReadLineAsync()
      Write-Marker 'CLIENT_CONNECTED'
      Send-Message @{
        type = 'hello'
        protocol = $script:protocol
        pid = $PID
        backend = 'wpf-mediaplayer'
        ownerPid = $script:ownerPid
        capabilities = @{ seek = $true; mute = $true; volume = $true }
      }
      Send-Message (@{ type = 'state' } + (Get-State))
    }
    if ($null -ne $script:reader -and $script:readTask.IsCompleted) {
      $line = $null
      try { $line = $script:readTask.GetAwaiter().GetResult() } catch { $line = $null }
      if ($null -eq $line) {
        # Client went away: keep playing and wait for the next one.
        $script:writer = $null
        $script:reader = $null
        $script:server.Dispose()
        $script:server = $null
        Write-Marker 'CLIENT_DISCONNECTED'
      } else {
        Handle-Line $line
        if ($script:running) { $script:readTask = $script:reader.ReadLineAsync() }
      }
    }
    Pump
    Step-MediaOpen
    Step-Warm
    Step-Playback
    Step-Watchdog
    Start-Sleep -Milliseconds $script:tickMs
  }
} finally {
  Stop-WarmHolders
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  if ($null -ne $script:server) { $script:server.Dispose() }
  Write-Marker 'EXIT'
}
