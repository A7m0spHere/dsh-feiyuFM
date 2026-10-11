param([Parameter(Mandatory = $true)][ValidateSet('protect', 'unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
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
