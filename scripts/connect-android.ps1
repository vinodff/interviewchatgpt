param([string]$Serial = '', [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$adbPath = if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
if (-not (Test-Path -LiteralPath $adbPath)) { $adbPath = (Get-Command adb.exe -ErrorAction Stop).Source }
if (-not $Serial) {
    $lines = & $adbPath devices
    $devices = @($lines | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
    if ($devices.Count -ne 1) { throw 'Connect and authorize one Android phone with USB debugging, or pass -Serial from adb devices.' }
    $Serial = $devices[0]
}
$adbArgs = @('-s', $Serial)
foreach ($port in @(3001, 8001)) {
    & $adbPath @adbArgs reverse "tcp:$port" "tcp:$port"
    if ($LASTEXITCODE -ne 0) { throw "Could not forward port $port. Check the USB connection and debugging permission." }
}
if (-not $SkipInstall) {
    $apkPath = Join-Path $taskRoot 'artifacts\android\InterviewPilotLive-test.apk'
    if (-not (Test-Path -LiteralPath $apkPath)) { throw 'Run scripts/build-android.ps1 first.' }
    & $adbPath @adbArgs install -r $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
}
& $adbPath @adbArgs shell am start -n 'live.interviewpilot.mobile.debug/live.interviewpilot.mobile.MainActivity'
if ($LASTEXITCODE -ne 0) { throw 'Could not open the Android app.' }
Write-Output 'Android is connected to http://localhost:3001 on this PC. Keep the local services and USB connection running.'
