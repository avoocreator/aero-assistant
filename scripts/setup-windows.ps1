# Membuat perintah "aero" dan "antigravity" supaya bisa dijalankan dari Win+R atau terminal
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'antigravity-launcher.vbs'

$binDir   = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
$cmdAero  = Join-Path $binDir 'aero.cmd'
$lnkAero  = Join-Path $binDir 'aero.lnk'
$cmdAg    = Join-Path $binDir 'antigravity.cmd'
$lnkAg    = Join-Path $binDir 'antigravity.lnk'

if ($Remove) {
  Remove-Item -Force -ErrorAction SilentlyContinue $cmdAero, $lnkAero, $cmdAg, $lnkAg
  Write-Host 'Perintah "aero" dan "antigravity" dihapus.'
  exit 0
}

if (-not (Test-Path $launcher)) { throw "antigravity-launcher.vbs tidak ditemukan di $root" }
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force $binDir | Out-Null }

# 1) CMD wrappers
@"
@echo off
start "" wscript.exe //nologo "$launcher"
"@ | Set-Content -Encoding ASCII $cmdAero

@"
@echo off
start "" wscript.exe //nologo "$launcher"
"@ | Set-Content -Encoding ASCII $cmdAg

# 2) Shortcuts
$ws = New-Object -ComObject WScript.Shell
foreach ($p in @($lnkAero, $lnkAg)) {
  $lnk = $ws.CreateShortcut($p)
  $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $lnk.Arguments = "//nologo `"$launcher`""
  $lnk.WorkingDirectory = $root
  $lnk.WindowStyle = 7
  $lnk.Save()
}

Write-Host "Perintah 'aero' dan 'antigravity' berhasil dipasang di $binDir"
