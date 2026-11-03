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
  # Default 0: the 2026-11-03 real-host measurements showed holder opens
  # competing with the media open the user is waiting for (9-14 s versus 5-6 s
  # per switch), so warming is opt-in via -WarmHolders 1..8. See
  # docs/spikes/N20-review-fixes.md for the original 2026-10-06 evidence.
  [int]$WarmHolders = 0,
  # Default pools may grow to eight until an actual holder opens quickly.
  # Explicit Node/backend pool sizes disable this unless requested otherwise.
  [int]$AdaptiveWarm = 1,
  # Overrides the silent resource the warm holders keep open. Left empty, the host
  # writes its own into the temp directory: audio must never be committed to this
  # repository (AGENTS.md), so the resource is generated rather than shipped.
  [string]$WarmResource = '',
  # 1 = replace the source with Open() on a switch (no Stop+Close first).
  # 0 = legacy teardown. Kept as a parameter so the two can be measured.
  [int]$ReusePlayer = 1
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$script:protocol = 1
$script:tickMs = 200
# A track switch used to call Stop() + Close() before Open(). On a network
# stream that teardown can take seconds and it blocks the single command loop,
# so a pause arriving during a switch waited behind it. WPF replaces the source
# on Open(), so the teardown is skipped unless an experiment proves it is needed.
$script:reusePlayer = $ReusePlayer -ne 0
$script:commandWatch = $null
$script:ownerPid = $OwnerPid
$script:running = $true
$script:volume = [Math]::Max(0.0, [Math]::Min(1.0, $Volume))

$script:player = [System.Windows.Media.MediaPlayer]::new()
$script:player.Volume = $script:volume
$script:pendingOpen = $null
# Preload: the next track's media is opened in a standby player while the
# current one plays, so a switch becomes a player swap instead of a cold open
# the user waits for. The standby is muted and never played until it is swapped.
$script:preloadPlayer = [System.Windows.Media.MediaPlayer]::new()
$script:preloadPlayer.Volume = 0
try { $script:preloadPlayer.IsMuted = $true } catch { }
$script:preload = $null
# A completed standby open. Kept separately from the pending request so the
# result can be answered while the media stays available for the next load.
$script:preloadReady = $null

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
$script:stallTimeoutMs = 15000
$script:progressWatch = [System.Diagnostics.Stopwatch]::new()

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
    errorCode = $script:failed
    errorMessage = $script:failedMessage
    retryable = $script:status -eq 'error' -and $null -ne $script:instance
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

function Get-CommandElapsedMs {
  if ($null -eq $script:commandWatch) { return 0 }
  return [int][Math]::Round($script:commandWatch.Elapsed.TotalMilliseconds)
}

function Send-Result([string]$id, $extra) {
  $payload = @{ type = 'result'; id = $id; ok = $true; state = (Get-State); hostMs = (Get-CommandElapsedMs) }
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
    hostMs = (Get-CommandElapsedMs)
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

# State-only reset. Kept separate from Stop-Playback so a switch can reset the
# bookkeeping without paying the network teardown: Open() replaces the source.
function Reset-PlaybackState {
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
  $script:progressWatch.Reset()
}

function Stop-Playback {
  if ($null -ne $script:pendingOpen) {
    $cancelled = $script:pendingOpen
    $script:pendingOpen = $null
    Send-ResultError $cancelled.id 'cancelled' 'Media open was superseded by a playback control'
  }
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  Reset-PlaybackState
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
    # Report this command's own wait, not the most recent command's.
    $script:commandWatch = $pending.watch
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
    $script:commandWatch = $pending.watch
    $playing = $false
    if ($pending.autoplay) {
      # One round trip: open, unmute/mute as requested, and start audio.
      $script:player.Play()
      $script:status = 'playing'
      $script:positionAtPlay = Get-Position
      $script:startedSent = $false
      $script:lastProgress = -1
      $script:progressWatch.Restart()
      $playing = $true
    } else {
      $script:status = 'ready'
    }
    Send-Result $pending.id @{ positionMs = $position; seek = $seeked; muted = $script:muted; durationMs = $script:durationMs; playing = $playing; preloaded = $pending.preloaded -eq $true; hostStartedAt = $pending.hostStartedAt }
  } catch {
    Stop-Playback
    $script:status = 'error'
    Send-ResultError $pending.id 'media_failed' 'Could not finish opening media' $true
  }
}

# Both the active and the standby player share one handler set; the sender
# decides which state the event belongs to, so a swap does not need re-wiring.
function Attach-PlayerEvents($player) {
  $player.add_MediaOpened({
    param($sender, $eventArgs)
    if ($sender -eq $script:player) {
      $script:opened = $true
      $script:failed = $null
      try {
        $natural = $script:player.NaturalDuration
        if ($natural.HasTimeSpan) { $script:durationMs = [int][Math]::Round($natural.TimeSpan.TotalMilliseconds) }
      } catch { $script:durationMs = $null }
      return
    }
    if ($null -ne $script:preload -and $sender -eq $script:preloadPlayer) {
      $script:preload.opened = $true
      try {
        $natural = $script:preloadPlayer.NaturalDuration
        if ($natural.HasTimeSpan) { $script:preload.durationMs = [int][Math]::Round($natural.TimeSpan.TotalMilliseconds) }
      } catch { }
    }
  })
  $player.add_MediaFailed({
    param($sender, $eventArgs)
    if ($sender -eq $script:player) {
      $script:failed = 'media_failed'
      $script:failedMessage = 'Media playback failed'
      try {
        if ($null -ne $eventArgs.ErrorException) { $script:failedMessage = $eventArgs.ErrorException.Message }
      } catch { }
      return
    }
    if ($null -ne $script:preload -and $sender -eq $script:preloadPlayer) {
      $script:preload.failed = $true
      try {
        if ($null -ne $eventArgs.ErrorException) { $script:preload.failedMessage = $eventArgs.ErrorException.Message }
      } catch { }
    }
  })
  $player.add_MediaEnded({
    param($sender, $eventArgs)
    if ($sender -ne $script:player) { return }
    if ($script:status -ne 'playing' -or $null -ne $script:failed) { return }
    $script:status = 'ended'
    $script:lastProgress = Get-Position
    Send-Event 'ended' @{ positionMs = $script:lastProgress }
    Write-Marker 'MEDIA_ENDED'
  })
}

Attach-PlayerEvents $script:player
Attach-PlayerEvents $script:preloadPlayer

function Stop-Preload {
  $cancelled = $script:preload
  $script:preload = $null
  $script:preloadReady = $null
  if ($null -ne $cancelled) {
    Send-ResultError $cancelled.id 'cancelled' 'Media preload was superseded by a playback control'
  }
  try { $script:preloadPlayer.Stop() } catch { }
  try { $script:preloadPlayer.Close() } catch { }
}

# The standby open is asynchronous like a real load: the loop keeps serving
# commands while it completes.
function Step-Preload {
  $pending = $script:preload
  if ($null -eq $pending) { return }
  if ($pending.failed -or (Get-Date) -ge $pending.deadline) {
    $code = if ($pending.failed) { 'media_failed' } else { 'media_open_timeout' }
    $message = if ($pending.failed) { $pending.failedMessage } else { "Preload did not open within $($pending.timeoutMs) ms" }
    $script:preload = $null
    Stop-Preload
    $script:commandWatch = $pending.watch
    Send-ResultError $pending.id $code $message $true
    return
  }
  if (-not $pending.opened) { return }
  $script:preload = $null
  # Keep the opened standby media for the next load; only the request is done.
  $script:preloadReady = @{ resource = $pending.resource; durationMs = $pending.durationMs }
  Write-Marker 'PRELOAD_READY'
  $script:commandWatch = $pending.watch
  Send-Result $pending.id @{ positionMs = 0; preloaded = $true; durationMs = $pending.durationMs }
}

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
      $hostStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
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
      if ($null -ne $command.muted) { $script:muted = [bool]$command.muted }
      $autoplay = $false
      if ($null -ne $command.autoplay) { $autoplay = [bool]$command.autoplay }

      $usePreload = $command.usePreload -eq $true
      if ($usePreload -and $null -ne $script:preloadReady -and $script:preloadReady.resource -eq $resource) {
        # The standby player already holds this exact resource: pause the old
        # track, swap players, and let Step-MediaOpen start the new one. The
        # user waits for a swap, not for a cold network open.
        if ($null -ne $script:pendingOpen) {
          $cancelled = $script:pendingOpen
          $script:pendingOpen = $null
          Send-ResultError $cancelled.id 'cancelled' 'Media open was superseded by a new load'
        }
        $retired = $script:player
        try { $retired.Pause() } catch { }
        $script:player = $script:preloadPlayer
        $script:preloadPlayer = $retired
        $script:player.Volume = $script:volume
        $script:preloadReady = $null
        # The old player becomes the standby. It is paused (not closed): a
        # Close() on a network stream can block the command loop for seconds,
        # and the next preload replaces its source anyway.
        Write-Marker 'PRELOAD_SWAP'
        Reset-PlaybackState
        $script:status = 'loading'
        $script:instance = $instance
        $script:version = $version
        $script:resource = $resource
        try {
          $natural = $script:player.NaturalDuration
          if ($natural.HasTimeSpan) { $script:durationMs = [int][Math]::Round($natural.TimeSpan.TotalMilliseconds) }
        } catch { $script:durationMs = $null }
        $script:opened = $true
        $script:pendingOpen = @{ id = $id; startMs = $startMs; timeoutMs = $openTimeoutMs; deadline = (Get-Date).AddMilliseconds($openTimeoutMs); autoplay = $autoplay; preloaded = $true; hostStartedAt = $hostStartedAt; watch = [System.Diagnostics.Stopwatch]::StartNew() }
        return
      }
      if ($null -ne $script:preload -or $null -ne $script:preloadReady) { Stop-Preload }

      # WPF does not fire MediaOpened when the same source is opened again on the
      # same player. A resume/recovery reload of the same handle must therefore
      # really tear the old media down first, or the open waits out its timeout.
      $sameSource = $script:reusePlayer -and $null -ne $script:instance -and $script:resource -eq $resource
      if ($sameSource) {
        Stop-Playback
      } elseif ($script:reusePlayer) {
        if ($null -ne $script:pendingOpen) {
          $cancelled = $script:pendingOpen
          $script:pendingOpen = $null
          Send-ResultError $cancelled.id 'cancelled' 'Media open was superseded by a new load'
        }
        Reset-PlaybackState
      } else {
        Stop-Playback
      }
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
        # A rejected open must not leave the previous source playing under an
        # "error" status: with the reuse-player path nothing else stopped it.
        Stop-Playback
        $script:status = 'error'
        Send-ResultError $id 'media_failed' 'Open() rejected the resource'
        return
      }
      $script:pendingOpen = @{ id = $id; startMs = $startMs; timeoutMs = $openTimeoutMs; deadline = (Get-Date).AddMilliseconds($openTimeoutMs); autoplay = $autoplay; hostStartedAt = $hostStartedAt; watch = [System.Diagnostics.Stopwatch]::StartNew() }
      # Warming starts only once a real load is in flight, so the first track of a
      # session is served exactly as before (cold) and the pool fills during the
      # playback that follows. Step-Warm never runs while an open is pending.
      $script:warmArmed = $true
    }
    'preload' {
      if ($null -ne $script:pendingOpen) { Send-ResultError $id 'busy' 'A load is in flight'; return }
      $resource = [string]$command.resource
      if ([string]::IsNullOrWhiteSpace($resource)) { Send-ResultError $id 'resource_missing' 'preload needs a resource handle'; return }
      $timeoutMs = 15000
      if ($null -ne $command.openTimeoutMs) { $timeoutMs = [int]$command.openTimeoutMs }
      if ($null -ne $script:preload -or $null -ne $script:preloadReady) { Stop-Preload }
      # The standby may be a swapped-out player: keep it silent before opening.
      $script:preloadPlayer.Volume = 0
      try { $script:preloadPlayer.IsMuted = $true } catch { }
      try { $uri = Resolve-Resource $resource } catch { Send-ResultError $id 'unsupported_resource' 'Resource is not a readable local file or URL'; return }
      $script:preload = @{ id = $id; resource = $resource; opened = $false; failed = $false; failedMessage = 'Media preload failed'; durationMs = $null; timeoutMs = $timeoutMs; deadline = (Get-Date).AddMilliseconds($timeoutMs); watch = [System.Diagnostics.Stopwatch]::StartNew() }
      try { $script:preloadPlayer.Open($uri) } catch {
        $script:preload = $null
        Send-ResultError $id 'media_failed' 'Open() rejected the preload resource'
        return
      }
    }
    'preloadCancel' {
      Stop-Preload
      Send-Result $id @{ preloaded = $false }
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
      $script:progressWatch.Restart()
      Send-Result $id @{ positionMs = $script:positionAtPlay }
    }
    'pause' {
      # A paused user should not keep a standby stream open, and cancelling it
      # here (instead of a separate command) keeps the pause on one round trip.
      if ($null -ne $script:preload -or $null -ne $script:preloadReady) { Stop-Preload }
      if ($null -ne $script:pendingOpen) { Stop-Playback }
      if ($null -ne $script:instance) { try { $script:player.Pause() } catch { } }
      if ($script:status -eq 'playing' -or $script:status -eq 'ready') { $script:status = 'paused' }
      $script:progressWatch.Reset()
      Send-Result $id @{ positionMs = (Get-Position) }
    }
    'stop' {
      if ($null -ne $script:preload -or $null -ne $script:preloadReady) { Stop-Preload }
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
      if ($null -ne $script:preload -or $null -ne $script:preloadReady) { Stop-Preload }
      Stop-Playback
      Send-Result $id $null
      Send-Event 'exiting' @{}
      $script:running = $false
    }
    default { Send-ResultError $id 'invalid_command' "Unknown command: $type" }
  }
}

function Handle-Line([string]$line) {
  $script:commandWatch = [System.Diagnostics.Stopwatch]::StartNew()
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
  if ($null -ne $script:failed) {
    Fail-Playback $script:failed $script:failedMessage
    return
  }
  $position = Get-Position
  if ($position -gt [Math]::Max($script:positionAtPlay, $script:lastProgress)) {
    $script:progressWatch.Restart()
  } elseif ($script:progressWatch.Elapsed.TotalMilliseconds -ge $script:stallTimeoutMs) {
    Fail-Playback 'media_stalled' 'Audio timeline did not advance for 15 seconds'
    return
  }
  # 'started' only after the timeline really advanced; a transient 0 read after
  # a resume must not look like progress.
  if ($position -le 0 -or $position -le $script:positionAtPlay) { return }
  if (-not $script:startedSent) {
    $script:startedSent = $true
    $script:lastProgress = $position
    Send-Event 'started' @{ positionMs = $position; progressSource = 'audio'; hostEventAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    return
  }
  if ($position -gt $script:lastProgress) {
    $script:lastProgress = $position
    Send-Event 'progress' @{ positionMs = $position; progressSource = 'audio' }
  }
}

# Preserve instance/version/error in snapshots so reconnecting clients can adopt
# a failure whose event was lost. Status prevents duplicate events on later ticks.
function Fail-Playback([string]$code, [string]$message) {
  $script:status = 'error'
  $script:failed = $code
  $script:failedMessage = $message
  $script:progressWatch.Reset()
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  Send-Event 'error' @{ code = $code; message = $message; retryable = $true }
  Write-Marker "MEDIA_ERROR code=$code"
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
        capabilities = @{ seek = $true; mute = $true; volume = $true; autoplay = $true; reuseSwitch = $true; preload = $true }
      }
      Send-Message (@{ type = 'state' } + (Get-State))
    }
    if ($null -ne $script:reader) {
      # Drain every line that is already buffered before sleeping. One command
      # per 200 ms tick made a switch (stop+load+mute+play) pay a tick per step
      # and let a pause wait a whole tick behind a finished command.
      $handled = 0
      while ($null -ne $script:reader -and $script:readTask.IsCompleted -and $handled -lt 8) {
        $line = $null
        try { $line = $script:readTask.GetAwaiter().GetResult() } catch { $line = $null }
        if ($null -eq $line) {
          # Client went away: keep playing and wait for the next one.
          $script:writer = $null
          $script:reader = $null
          $script:server.Dispose()
          $script:server = $null
          Write-Marker 'CLIENT_DISCONNECTED'
          break
        }
        Handle-Line $line
        $handled += 1
        if (-not $script:running) { break }
        $script:readTask = $script:reader.ReadLineAsync()
      }
    }
    Pump
    Step-MediaOpen
    Step-Preload
    Step-Warm
    Step-Playback
    Step-Watchdog
    Start-Sleep -Milliseconds $script:tickMs
  }
} finally {
  Stop-WarmHolders
  Stop-Preload
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  if ($null -ne $script:server) { $script:server.Dispose() }
  Write-Marker 'EXIT'
}
