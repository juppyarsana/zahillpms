# Set up a guest TV for Zahill TV (TV_LAUNCHER_PLAN.md, Phase 3), over the network with adb.
#
#   .\provision.ps1 -Tv 192.168.20.116 -Room 101 -Token <display token>
#   .\provision.ps1 -RoomsCsv rooms.csv -Token <display token>        # every TV in the file (room,ip)
#
# What it does, in order (stops at the first thing that fails):
#   1. connects, checks the model (AQUOS-TVX19A unless -AnyModel)
#   2. installs the app (release build if there is one) and lets it set itself as screensaver
#   3. writes Room ID / token / TV URL into the app, sets it as the screensaver
#   4. names the TV "Room 101" - the name guests see when they cast from their phone
#   5. disables the packages in the debloat list (never core Android; never the setup wizard
#      while it owns the saved Wi-Fi), remembering which ones it changed
#   6. makes Zahill TV the Home screen, removes the old com.zahill.tvscreensaver, presses Home
# Undo: .\restore.ps1 -Tv <ip>   (uses the state file written to provision\state\<ip>.json)
param(
    [string]$Tv,
    [string]$Room,
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$BaseUrl = 'https://tv.zahill.kdai.cloud',
    [string]$RoomsCsv,
    [string]$Apk,
    [string]$List = (Join-Path $PSScriptRoot 'debloat-tvx19a.txt'),
    [string]$DeviceName,
    [switch]$SkipDebloat,
    [switch]$AnyModel
)
$ErrorActionPreference = 'Stop'
$Pkg = 'com.zahill.tv'
$Model = 'AQUOS-TVX19A'

$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb -and (Test-Path 'C:\platform-tools\adb.exe')) { $adb = 'C:\platform-tools\adb.exe' }
if (-not $adb) { throw 'adb not found - install Android platform-tools and put adb on the PATH' }

if (-not $Apk) {
    $root = Split-Path -Parent $PSScriptRoot
    $release = Join-Path $root 'app\build\outputs\apk\release\app-release.apk'
    $debug = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk'
    $Apk = if (Test-Path $release) { $release } elseif (Test-Path $debug) { $debug } else { throw 'No APK: build it first (gradlew :app:assembleRelease)' }
}
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }

# Core Android / TV middleware: disabling one of these can stop the TV booting (CleanYourTV #884, #1578).
$CoreRe = '^(android|android\.ext\.(services|shared)|com\.android\.systemui|com\.android\.shell|com\.android\.phone|com\.android\.settings|com\.android\.tv\.settings|com\.(google\.)?android\.(permissioncontroller|packageinstaller|ext\.services|ext\.shared|modulemetadata|webview)|com\.google\.android\.(gms|gsf)|com\.google\.android\.overlay\.modules.*|com\.android\.providers\..*|com\.cltv\.mal|com\.mediatek\.(tis|tv\.service|tv\.agent|tvinput)|com\.mediatek\.wwtv\.tvcenter)$'
$Setupwraith = 'com.google.android.tungsten.setupwraith'

# adb writes failures to stderr; in Windows PowerShell 5.1 that would stop the script, so read it as text.
function Adb-Text([string[]]$AdbArgs) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $adb @AdbArgs 2>&1 | ForEach-Object { "$_" } | Out-String } finally { $ErrorActionPreference = $eap }
    return $out.Trim()
}
function Run([string]$Serial, [string[]]$AdbArgs) { Adb-Text (@('-s', $Serial) + $AdbArgs) }

function Read-List([string]$Path) {
    $pkgs = Get-Content $Path | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ } | ForEach-Object { ($_ -split '\s+')[0] }
    $bad = @($pkgs | Where-Object { $_ -notmatch '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$' })
    if ($bad.Count) { throw "Not a package name in ${Path}: $($bad -join ', ')" }
    $core = @($pkgs | Where-Object { $_ -cmatch $CoreRe })
    if ($core.Count) { throw "Refusing ${Path}: core Android / TV packages would stop the TV working: $($core -join ', ')" }
    return $pkgs
}

function Provision-One([string]$Ip, [string]$RoomId) {
    $serial = if ($Ip -match ':\d+$') { $Ip } else { "${Ip}:5555" }
    Write-Host "`n=== Room $RoomId - $serial" -ForegroundColor Cyan

    $c = Adb-Text @('connect', $serial)
    if ($c -notmatch 'connected') { throw "Cannot connect to ${serial}: $($c.Trim()). Is the TV on, with network debugging allowed?" }
    if ((Run $serial @('get-state')) -ne 'device') { throw "$serial is not ready (accept the debugging prompt on the TV, then run again)" }
    $model = Run $serial @('shell', 'getprop ro.product.model')
    if ($model -ne $Model -and -not $AnyModel) { throw "$serial is a '$model', not $Model - the debloat list is for $Model (use -AnyModel -SkipDebloat to set it up anyway)" }

    $stateDir = Join-Path $PSScriptRoot 'state'
    New-Item -ItemType Directory -Force $stateDir | Out-Null
    $stateFile = Join-Path $stateDir (($Ip -replace ':\d+$', '') + '.json')
    $state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { $null }
    $disabledByUs = New-Object System.Collections.ArrayList
    if ($state -and $state.disabled) { $state.disabled | ForEach-Object { [void]$disabledByUs.Add($_) } }
    $prevName = if ($state) { $state.device_name } else { Run $serial @('shell', 'settings get global device_name') }
    $prevSaver = if ($state) { $state.screensaver } else { Run $serial @('shell', 'settings get secure screensaver_components') }

    function Save-State {
        [ordered]@{
            tv = $Ip; room = $RoomId; model = $model; updated = (Get-Date).ToString('s')
            device_name = $prevName; screensaver = $prevSaver; disabled = @($disabledByUs)
        } | ConvertTo-Json | Set-Content -Encoding UTF8 $stateFile
    }
    Save-State

    # 2. Install
    Write-Host "Installing $(Split-Path -Leaf $Apk)..."
    $r = Run $serial @('install', '-r', $Apk)
    if ($r -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
        # Signed with another key (e.g. a debug build from another PC): replace it. Its settings are written again below.
        Write-Host 'Installed copy is signed with another key - replacing it.'
        Run $serial @('uninstall', $Pkg) | Out-Null
        $r = Run $serial @('install', $Apk)
    }
    if ($r -notmatch 'Success') { throw "Install failed: $r" }
    Run $serial @('shell', "pm grant $Pkg android.permission.WRITE_SECURE_SETTINGS") | Out-Null
    # Lets the app bring Home back after boot - the Live TV app opens itself over Home at power-on.
    Run $serial @('shell', "appops set $Pkg SYSTEM_ALERT_WINDOW allow") | Out-Null

    # 3. Room settings + screensaver
    $q = { param($s) "'" + ($s -replace "'", "'\''") + "'" }
    $r = Run $serial @('shell', "am start -n $Pkg/.SettingsActivity --es room_id $(& $q $RoomId) --es display_token $(& $q $Token) --es base_url $(& $q $BaseUrl)")
    if ($r -match 'Error') { throw "Could not write the room settings: $r" }
    Start-Sleep -Seconds 2
    Run $serial @('shell', "settings put secure screensaver_components $Pkg/.ZahillDreamService") | Out-Null
    Run $serial @('shell', 'settings put secure screensaver_enabled 1') | Out-Null
    Run $serial @('shell', 'settings put secure screensaver_activate_on_sleep 1') | Out-Null

    # 4. The name guests see in their Cast list
    $name = if ($DeviceName) { $DeviceName } else { "Room $RoomId" }
    Run $serial @('shell', "settings put global device_name $(& $q $name)") | Out-Null

    # 6a. Home first, so the stock launcher can go without the TV ever being left without one.
    $r = Run $serial @('shell', "cmd package set-home-activity $Pkg/.MainActivity")
    if ($r -notmatch 'Success') { throw "Could not make Zahill TV the Home screen: $r" }

    # 5. Debloat
    if (-not $SkipDebloat) {
        $pkgs = Read-List $List
        $installed = (Run $serial @('shell', 'pm list packages')) -split "`r?`n" | ForEach-Object { $_ -replace '^package:', '' }
        $already = (Run $serial @('shell', 'pm list packages -d')) -split "`r?`n" | ForEach-Object { $_ -replace '^package:', '' }
        foreach ($p in $pkgs) {
            if ($installed -notcontains $p) { Write-Host "  - $p (not on this TV)"; continue }
            if ($already -contains $p) { Write-Host "  - $p (already disabled)"; continue }
            if ($p -eq $Setupwraith) {
                $owners = Run $serial @('shell', "dumpsys wifi | grep -o 'cname=[^ ]*' | sort -u")
                if (-not $owners -or $owners -match 'setupwraith') {
                    Write-Warning "Skipping ${p}: it owns the saved Wi-Fi network (or that could not be checked); disabling it would delete the network. Forget and re-join the Wi-Fi in Settings, then run again."
                    continue
                }
            }
            $r = Run $serial @('shell', "pm disable-user --user 0 $p")
            if ($r -match 'disabled') { [void]$disabledByUs.Add($p); Save-State; Write-Host "  x $p" }
            else { Write-Warning "  $p not disabled: $r" }
        }
    }

    # 6b. Old screensaver app, then Home
    if ((Run $serial @('shell', 'pm list packages com.zahill.tvscreensaver')) -match 'tvscreensaver') {
        Run $serial @('uninstall', 'com.zahill.tvscreensaver') | Out-Null
        Write-Host 'Removed the old Zahill TV Screensaver app.'
    }
    Run $serial @('shell', 'input keyevent KEYCODE_HOME') | Out-Null
    Start-Sleep -Seconds 4
    $top = Run $serial @('shell', 'dumpsys activity activities | grep -m1 mResumedActivity')
    if ($top -notmatch [regex]::Escape("$Pkg/")) { throw "Home did not open Zahill TV: $top" }
    Save-State
    Write-Host "Room ${RoomId}: done. Zahill TV is Home, the screensaver is set, the TV is named '$name'." -ForegroundColor Green
}

if ($RoomsCsv) {
    $rows = Import-Csv $RoomsCsv
    $failed = @()
    foreach ($row in $rows) {
        if (-not $row.room -or -not $row.ip) { continue }
        try { Provision-One $row.ip $row.room } catch { Write-Warning "Room $($row.room) ($($row.ip)): $_"; $failed += $row.room }
    }
    if ($failed.Count) { Write-Host "`nNot finished: rooms $($failed -join ', ') - fix and run again for those (it is safe to repeat)." -ForegroundColor Yellow; exit 1 }
    Write-Host "`nAll $(@($rows).Count) TVs done." -ForegroundColor Green
} else {
    if (-not $Tv -or -not $Room) { throw 'Pass -Tv <ip> -Room <room id>, or -RoomsCsv <file with room,ip columns>' }
    Provision-One $Tv $Room
}
