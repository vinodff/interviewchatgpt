param([switch]$Release)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw 'Install Android SDK 36 and set ANDROID_HOME. See docs/ANDROID.md.' }
$buildType = if ($Release) { 'Release' } else { 'Debug' }
Push-Location (Join-Path $taskRoot 'android')
try {
    & .\gradlew.bat ":app:assemble$buildType" ":app:test${buildType}UnitTest" ":app:lint$buildType" --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build or validation failed.' }
} finally { Pop-Location }
$artifactPath = Join-Path $taskRoot 'artifacts\android'
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
if ($Release) {
    $apkSource = Join-Path $taskRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
    $apkTarget = Join-Path $artifactPath 'InterviewPilotLive-release-unsigned.apk'
} else {
    $apkSource = Join-Path $taskRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    $apkTarget = Join-Path $artifactPath 'InterviewPilotLive-test.apk'
}
Copy-Item -LiteralPath $apkSource -Destination $apkTarget -Force
$hash = (Get-FileHash -LiteralPath $apkTarget -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$apkTarget.sha256" -Value "$hash  $(Split-Path -Leaf $apkTarget)"
Write-Output "APK: $apkTarget"
if ($Release) { Write-Output 'Release APK is unsigned. Sign with your own protected release key before installation/distribution.' }
