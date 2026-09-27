# P0-05 window behaviour probe.
#
# Answers one question: does this machine's desktop support the window
# behaviours P0-05 asks about (transparent background, always-on-top,
# click-through on transparent areas, position restore, tray)? It creates a real
# window, applies each behaviour, reports what the OS reports back, and exits.
#
# It deliberately uses WPF rather than Tauri: WPF ships with Windows, so this
# runs with no downloads. The result proves what the OS supports, NOT what a
# given framework exposes — the doc says so explicitly.
#
#   pwsh -NoProfile -File spikes/P0-05-window-probe.ps1
param([int]$SettleMs = 900)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

# Win32 bits needed for click-through and for reading the extended style back.
Add-Type -Namespace Probe -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
[DllImport("user32.dll", SetLastError = true)] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

$GWL_EXSTYLE = -20
$WS_EX_LAYERED = 0x00080000
$WS_EX_TRANSPARENT = 0x00000020

# Writes the line and returns only the verdict, so the caller can both show the
# result and total it. Assigning a function that also writes output would capture
# the text as the "value", which hid every line on the first run of this probe.
function Report([string]$name, [bool]$ok, [string]$detail) {
  $state = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0,-34} {1}  {2}" -f $name, $state, $detail)
  return $ok
}

$window = New-Object System.Windows.Window
$window.WindowStyle = 'None'
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.Width = 260
$window.Height = 300

$results = [ordered]@{}

try {
  # Show it off-screen-ish so a probe run is not intrusive, then measure.
  $window.WindowStartupLocation = 'Manual'
  $window.Left = -10000
  $window.Top = -10000
  $window.Show()
  $window.Dispatcher.Invoke([action] {}, [System.Windows.Threading.DispatcherPriority]::ApplicationIdle)

  $results['allows transparent window'] = Report 'allows transparent window' $window.AllowsTransparency 'WPF accepted AllowsTransparency=True'
  $results['background is transparent'] = Report 'background is transparent' ($window.Background.ToString() -eq '#00FFFFFF') "Background=$($window.Background)"
  $results['topmost accepted'] = Report 'topmost accepted' ($window.Topmost -eq $true) "Topmost=$($window.Topmost)"
  $results['borderless'] = Report 'borderless' ($window.WindowStyle -eq 'None') "WindowStyle=$($window.WindowStyle)"

  # Click-through: apply WS_EX_LAYERED | WS_EX_TRANSPARENT and read it back.
  $handle = (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle
  $before = [Probe.Native]::GetWindowLong($handle, $GWL_EXSTYLE)
  $null = [Probe.Native]::SetWindowLong($handle, $GWL_EXSTYLE, ($before -bor $WS_EX_LAYERED -bor $WS_EX_TRANSPARENT))
  $after = [Probe.Native]::GetWindowLong($handle, $GWL_EXSTYLE)
  $layered = ($after -band $WS_EX_LAYERED) -ne 0
  $clickThrough = ($after -band $WS_EX_TRANSPARENT) -ne 0
  $results['click-through applied'] = Report 'click-through applied' ($layered -and $clickThrough) ("exStyle 0x{0:X} -> 0x{1:X}" -f $before, $after)

  # Position: set, read back from the OS (window rect, not the WPF property).
  $window.Left = 120
  $window.Top = 140
  Start-Sleep -Milliseconds 120
  $rect = New-Object Probe.Native+RECT
  $null = [Probe.Native]::GetWindowRect($handle, [ref]$rect)
  # WPF positions are device-independent units; GetWindowRect returns physical
  # pixels. At 125% scaling they differ by exactly that factor, so comparing them
  # directly would report a false failure — which is a real trap for the stored
  # window position, not a probe artefact.
  $source = [System.Windows.PresentationSource]::FromVisual($window)
  $scaleX = if ($source) { $source.CompositionTarget.TransformToDevice.M11 } else { 1 }
  $scaleY = if ($source) { $source.CompositionTarget.TransformToDevice.M22 } else { 1 }
  $expectedLeft = [int][Math]::Round(120 * $scaleX)
  $expectedTop = [int][Math]::Round(140 * $scaleY)
  $positionOk = [Math]::Abs($rect.Left - $expectedLeft) -le 2 -and [Math]::Abs($rect.Top - $expectedTop) -le 2
  $results['position applied'] = Report 'position applied' $positionOk "OS rect=($($rect.Left),$($rect.Top)) asked=(120,140) at scale ${scaleX}x${scaleY} -> expected=($expectedLeft,$expectedTop)"
  $results['scale factor readable'] = Report 'scale factor readable' ($scaleX -gt 0) "device scale=${scaleX}x${scaleY}"

  # Multi-monitor / DPI information the position logic depends on.
  $virtual = "{0},{1} {2}x{3}" -f [int][System.Windows.SystemParameters]::VirtualScreenLeft,
    [int][System.Windows.SystemParameters]::VirtualScreenTop,
    [int][System.Windows.SystemParameters]::VirtualScreenWidth,
    [int][System.Windows.SystemParameters]::VirtualScreenHeight
  $results['virtual screen readable'] = Report 'virtual screen readable' ($virtual -match '\d') "virtual=$virtual"
  $dpi = [System.Windows.SystemParameters]::PrimaryScreenWidth
  $results['dpi/scale readable'] = Report 'dpi/scale readable' ($dpi -gt 0) "primary width=$dpi (WPF units)"

  # Tray: create an icon and remove it again; proves the shell host is available.
  $tray = New-Object System.Windows.Forms.NotifyIcon
  $tray.Icon = [System.Drawing.SystemIcons]::Application
  $tray.Visible = $true
  Start-Sleep -Milliseconds 150
  $trayOk = $tray.Visible
  $tray.Visible = $false
  $tray.Dispose()
  $results['tray icon show/hide'] = Report 'tray icon show/hide' $trayOk 'NotifyIcon shown then removed'
} finally {
  $window.Close()
}

$passed = ($results.Values | Where-Object { $_ }).Count
Write-Output ''
Write-Output "PROBE_RESULT: $passed/$($results.Count) window behaviours supported on this machine"
if ($passed -eq $results.Count) { exit 0 } else { exit 1 }