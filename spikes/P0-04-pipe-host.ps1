param(
  [Parameter(Mandatory = $true)][string]$PipeName
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Windows.Forms

$script:player = [System.Windows.Media.MediaPlayer]::new()
$script:player.Volume = 0.15
$script:status = 'idle'
$script:revision = 0
$script:writer = $null
$script:running = $true

function Send-Message($value) {
  if ($null -eq $script:writer) { return }
  try { $script:writer.WriteLine(($value | ConvertTo-Json -Compress -Depth 6)) }
  catch { $script:writer = $null }
}

function Snapshot {
  return @{
    type = 'snapshot'
    revision = $script:revision
    status = $script:status
    positionMs = [int][Math]::Round($script:player.Position.TotalMilliseconds)
    muted = $script:player.IsMuted
  }
}

$script:player.add_MediaOpened({
  if ($script:status -eq 'loading') { $script:status = 'ready' }
  $script:revision += 1
  Send-Message @{ type = 'event'; event = 'opened'; revision = $script:revision }
})
$script:player.add_MediaEnded({
  $script:status = 'ended'
  $script:revision += 1
  Send-Message @{ type = 'event'; event = 'ended'; revision = $script:revision }
  Write-Output 'FISHFM_P0_MEDIA_ENDED'
})
$script:player.add_MediaFailed({
  $script:status = 'error'
  $script:revision += 1
  Send-Message @{ type = 'event'; event = 'error'; revision = $script:revision }
  Write-Output 'FISHFM_P0_MEDIA_FAILED'
})

function Handle-Command($line) {
  try {
    $command = $line | ConvertFrom-Json
    switch ($command.type) {
      'load' {
        $script:player.Open([Uri](Resolve-Path -LiteralPath $command.path).Path)
        $script:status = 'loading'
        $script:revision += 1
      }
      'play' {
        $script:player.Play()
        $script:status = 'playing'
        $script:revision += 1
      }
      'pause' {
        $script:player.Pause()
        $script:status = 'paused'
        $script:revision += 1
      }
      'mute' {
        $script:player.IsMuted = [bool]$command.value
        $script:revision += 1
      }
      'stop' {
        $script:player.Stop()
        $script:status = 'stopped'
        $script:revision += 1
      }
      'exit' {
        $script:player.Stop()
        $script:status = 'stopped'
        $script:revision += 1
        $script:running = $false
      }
      'snapshot' { }
      default { throw "Unknown command type: $($command.type)" }
    }
    Send-Message (Snapshot)
  } catch {
    Send-Message @{ type = 'error'; code = 'invalid_command' }
  }
}

$server = $null
$reader = $null
try {
  while ($script:running) {
    if ($null -eq $server) {
      $server = [System.IO.Pipes.NamedPipeServerStream]::new(
        $PipeName,
        [System.IO.Pipes.PipeDirection]::InOut,
        1,
        [System.IO.Pipes.PipeTransmissionMode]::Byte,
        ([System.IO.Pipes.PipeOptions]::Asynchronous -bor [System.IO.Pipes.PipeOptions]::CurrentUserOnly)
      )
      $connectTask = $server.WaitForConnectionAsync()
      Write-Output 'FISHFM_P0_WAITING_FOR_CLIENT'
    }
    [System.Windows.Forms.Application]::DoEvents()
    if ($null -eq $reader -and $connectTask.IsCompleted) {
      $connectTask.GetAwaiter().GetResult()
      $reader = [System.IO.StreamReader]::new($server)
      $script:writer = [System.IO.StreamWriter]::new($server)
      $script:writer.AutoFlush = $true
      $readTask = $reader.ReadLineAsync()
      Write-Output 'FISHFM_P0_CLIENT_CONNECTED'
    }
    if ($null -ne $reader -and $readTask.IsCompleted) {
      try { $line = $readTask.GetAwaiter().GetResult() } catch { $line = $null }
      if ($null -eq $line) {
        $script:writer = $null
        $reader = $null
        $server.Dispose()
        $server = $null
        Write-Output 'FISHFM_P0_CLIENT_DISCONNECTED'
      } else {
        Handle-Command $line
        if ($script:running) { $readTask = $reader.ReadLineAsync() }
      }
    }
    Start-Sleep -Milliseconds 20
  }
} finally {
  $script:player.Stop()
  $script:player.Close()
  if ($null -ne $server) { $server.Dispose() }
  Write-Output 'FISHFM_P0_HOST_EXIT'
}
