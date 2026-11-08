# Builds the "Zahill TV Setup" folder (and a .zip of it) to copy to a PC in the hotel.
#
#   .\build.ps1                    # the folder without this PC's adb key: each TV asks once (OK on the TV)
#   .\build.ps1 -IncludeAdbKey     # with this PC's adb key: TVs that already trust this PC won't ask
#
# Output: setup-app\dist\ZahillTvSetup\ and setup-app\dist\ZahillTvSetup.zip (dist\ is not in git).
# Needs: C:\platform-tools (or adb on the PATH), a built APK (gradlew :app:assembleRelease).
# The rooms list comes from ..\TV_ROOMS.md; the setup records (state\*.json) are copied so Undo works there.
param([switch]$IncludeAdbKey)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$launcher = Split-Path -Parent $here
$out = Join-Path $here 'dist\ZahillTvSetup'
$tools = Join-Path $out 'tools'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb -and (Test-Path 'C:\platform-tools\adb.exe')) { $adb = 'C:\platform-tools\adb.exe' }
if (-not $adb) { throw 'adb not found' }
$adbDir = Split-Path -Parent $adb

$release = Join-Path $launcher 'app\build\outputs\apk\release'
$debug = Join-Path $launcher 'app\build\outputs\apk\debug'
$apkDir = if (Test-Path (Join-Path $release 'app-release.apk')) { $release } elseif (Test-Path (Join-Path $debug 'app-debug.apk')) { $debug } else { throw 'No APK: build it first (gradlew :app:assembleRelease)' }
$apk = Get-ChildItem $apkDir -Filter *.apk | Select-Object -First 1
$version = (Get-Content (Join-Path $apkDir 'output-metadata.json') -Raw | ConvertFrom-Json).elements[0].versionName
if ($apkDir -eq $debug) { Write-Warning 'Using the DEBUG build: TVs with the release build will need Set up, not Update app.' }

# Keep settings.dat (the saved token) if the folder already exists here; everything else is rebuilt.
if (Test-Path $out) { Get-ChildItem $out -Exclude settings.dat | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $tools 'adb'), (Join-Path $tools 'scripts\state') | Out-Null

& $csc /nologo /target:winexe /optimize+ /out:"$out\ZahillTvSetup.exe" `
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Security.dll `
    (Join-Path $here 'ZahillTvSetup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compile failed' }

foreach ($f in 'adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll', 'NOTICE.txt') {
    $p = Join-Path $adbDir $f
    if (Test-Path $p) { Copy-Item $p (Join-Path $tools 'adb') }
}
Copy-Item $apk.FullName (Join-Path $tools 'zahill-tv.apk')
Set-Content -Encoding ASCII (Join-Path $tools 'apk-version.txt') $version
$prov = Join-Path $launcher 'provision'
Copy-Item (Join-Path $prov 'provision.ps1'), (Join-Path $prov 'restore.ps1') (Join-Path $tools 'scripts')
Copy-Item (Join-Path $prov 'debloat-*.txt') (Join-Path $tools 'scripts')
Get-ChildItem (Join-Path $prov 'state') -File -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $tools 'scripts\state')

if ($IncludeAdbKey) {
    $key = Join-Path $env:USERPROFILE '.android\adbkey'
    if (-not (Test-Path $key)) { throw "No adb key at $key" }
    New-Item -ItemType Directory -Force (Join-Path $tools 'adbkey') | Out-Null
    Copy-Item $key, "$key.pub" (Join-Path $tools 'adbkey')
}

# Rooms from the table in TV_ROOMS.md: | Room | Address | ...
$rows = @('room,ip,name')
$seen = @{}
foreach ($line in Get-Content (Join-Path $launcher 'TV_ROOMS.md')) {
    if ($line -match '^\|\s*(\d{3})\s*\|\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\|') {
        if (-not $seen.ContainsKey($Matches[2])) { $seen[$Matches[2]] = 1; $rows += "$($Matches[1]),$($Matches[2]),"; }
    }
}
Set-Content -Encoding UTF8 (Join-Path $out 'rooms.csv') $rows

@"
Zahill TV Setup  (TV app $version)

1. Copy this whole folder to a PC on the hotel network (the TVs' network: .20, .30 or .1).
2. Double-click ZahillTvSetup.exe. Windows may warn once ("Windows protected your PC"):
   More info -> Run anyway. Windows Firewall may ask about adb: Cancel is fine (adb only
   connects out to the TVs).
3. Type the display token (PMS: Settings -> Property Details -> Device Setup) and press Save.
4. Check all, then select TVs and press Update app (new app version) or Set up (a new TV).

- Update app only changes the app; the TV keeps its room, Home and screensaver.
- The app asks the PMS whether a guest is in the room before changing a TV.
- A TV that was never connected to this PC shows "Waiting": someone presses OK
  ("Allow debugging", tick Always allow) on the TV once.
- "Check the address" (orange): the TV at that address is named after another room, so Set up
  refuses it. Find which room it is really in and fix the address with Edit.
- Keep this folder: tools\scripts\state holds what each setup changed, which Undo setup needs.
$(if ($IncludeAdbKey) { "- tools\adbkey is the key every TV trusts: keep this folder on the hotel PC only." })
"@ | Set-Content -Encoding UTF8 (Join-Path $out 'READ ME.txt')

$zip = Join-Path $here 'dist\ZahillTvSetup.zip'
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $out -DestinationPath $zip
Write-Host "Built $out (TV app $version, $($rows.Count - 1) TVs$(if ($IncludeAdbKey) { ', with this PC''s adb key' })) and $zip" -ForegroundColor Green
