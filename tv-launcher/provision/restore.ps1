# Put a guest TV back the way provision.ps1 found it (TV_LAUNCHER_PLAN.md, Phase 3).
#
#   .\restore.ps1 -Tv 192.168.20.116               # stock Home back, packages it disabled enabled again
#   .\restore.ps1 -Tv 192.168.20.116 -Uninstall    # ... and remove Zahill TV too
#
# Reads provision\state\<ip>.json: only the packages provision.ps1 disabled are enabled again
# (ones that were already off from the factory stay off), and the TV's name and screensaver go back.
param(
    [Parameter(Mandatory = $true)][string]$Tv,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb -and (Test-Path 'C:\platform-tools\adb.exe')) { $adb = 'C:\platform-tools\adb.exe' }
if (-not $adb) { throw 'adb not found' }
$serial = if ($Tv -match ':\d+$') { $Tv } else { "${Tv}:5555" }
# adb writes failures to stderr; in Windows PowerShell 5.1 that would stop the script, so read it as text.
function Adb-Text([string[]]$AdbArgs) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $adb @AdbArgs 2>&1 | ForEach-Object { "$_" } | Out-String } finally { $ErrorActionPreference = $eap }
    return $out.Trim()
}
function Run([string[]]$AdbArgs) { Adb-Text (@('-s', $serial) + $AdbArgs) }

$stateFile = Join-Path $PSScriptRoot ('state\' + ($Tv -replace ':\d+$', '') + '.json')
$state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { Write-Warning "No state file ($stateFile): only the stock Home is put back."; $null }

$c = Adb-Text @('connect', $serial)
if ($c -notmatch 'connected') { throw "Cannot connect to ${serial}: $($c.Trim())" }

# Stock Home first, so the TV always has one.
Run @('shell', 'pm enable com.google.android.tvlauncher') | Out-Null
Run @('shell', 'cmd package set-home-activity com.google.android.tvlauncher/.MainActivity') | Out-Null
if ($state) {
    foreach ($p in $state.disabled) {
        if ($p -eq 'com.google.android.tvlauncher') { continue }
        $r = Run @('shell', "pm enable $p")
        Write-Host "  + $p  $r"
    }
    if ($state.device_name -and $state.device_name -ne 'null') { Run @('shell', "settings put global device_name '$($state.device_name -replace "'", "'\''")'") | Out-Null }
    if ($state.screensaver -and $state.screensaver -ne 'null') { Run @('shell', "settings put secure screensaver_components $($state.screensaver)") | Out-Null }
}
if ($Uninstall) { Run @('uninstall', 'com.zahill.tv') | Out-Null; Write-Host 'Zahill TV removed.' }
Run @('shell', 'input keyevent KEYCODE_HOME') | Out-Null
if ($state) { Rename-Item $stateFile ($stateFile + '.restored-' + (Get-Date -Format 'yyyyMMdd-HHmm')) }
Write-Host "Restored $serial to the stock Home." -ForegroundColor Green
