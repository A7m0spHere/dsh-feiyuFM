param([Parameter(Mandatory = $true)][ValidateSet('protect', 'unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 cannot resolve the ProtectedData assembly by its full
# name; `System.Security` loads it there. PowerShell 7 takes the first branch.
try {
  Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
} catch {
  Add-Type -AssemblyName System.Security
}
$inputText = [Console]::In.ReadToEnd()
if ($Operation -eq 'protect') {
  $plain = [System.Text.Encoding]::UTF8.GetBytes($inputText)
  try {
    $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
      $plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([Convert]::ToBase64String($cipher))
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
} else {
  $cipher = [Convert]::FromBase64String($inputText)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  try {
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
}
