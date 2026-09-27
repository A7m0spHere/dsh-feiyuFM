param([Parameter(Mandatory = $true)][string]$AudioPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Windows.Forms

function Wait-Pump([int]$Milliseconds) {
  $until = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while ([DateTime]::UtcNow -lt $until) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
  }
}

$player = [System.Windows.Media.MediaPlayer]::new()
$script:opened = $false
$script:ended = $false
$script:failed = $false
$player.add_MediaOpened({ $script:opened = $true })
$player.add_MediaEnded({ $script:ended = $true })
$player.add_MediaFailed({ $script:failed = $true })
try {
  $player.Volume = 0.15
  $player.Open([Uri](Resolve-Path -LiteralPath $AudioPath).Path)
  Wait-Pump 1000
  Write-Output "OPENED=$script:opened FAILED=$script:failed"
  $player.Play()
  Wait-Pump 1000
  Write-Output "PLAY position=$([Math]::Round($player.Position.TotalSeconds, 2))"
  $player.Pause()
  $pausedAt = $player.Position.TotalSeconds
  Wait-Pump 2000
  Write-Output "PAUSE before=$([Math]::Round($pausedAt, 2)) after=$([Math]::Round($player.Position.TotalSeconds, 2))"
  $player.IsMuted = $true
  Write-Output "MUTE value=$($player.IsMuted)"
  $player.Play()
  Wait-Pump 1000
  Write-Output "RESUME position=$([Math]::Round($player.Position.TotalSeconds, 2))"
  $player.IsMuted = $false
  Write-Output "UNMUTE value=$($player.IsMuted)"
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline -and -not $script:ended -and -not $script:failed) {
    Wait-Pump 100
  }
  Write-Output "ENDED=$script:ended FAILED=$script:failed position=$([Math]::Round($player.Position.TotalSeconds, 2))"
} finally {
  $player.Stop()
  $player.Close()
}
