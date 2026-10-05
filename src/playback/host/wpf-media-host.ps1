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
  [double]$Volume = 0.35
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
    Step-Playback
    Step-Watchdog
    Start-Sleep -Milliseconds $script:tickMs
  }
} finally {
  try { $script:player.Stop() } catch { }
  try { $script:player.Close() } catch { }
  if ($null -ne $script:server) { $script:server.Dispose() }
  Write-Marker 'EXIT'
}
