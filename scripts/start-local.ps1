# Default: run exactly like the hosted site (Next.js + Supabase + direct Gemini streaming), so local tests
# match what customers get. -WithBackend runs the older FastAPI live pipeline and local PostgreSQL instead.
param([int]$FrontendPort=3001, [int]$BackendPort=8001, [switch]$WithBackend)
$ErrorActionPreference='Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $taskRoot 'backend'
$frontendPath = Join-Path $taskRoot 'frontend'
$dataPath = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$ports = if ($WithBackend) { @($FrontendPort,$BackendPort) } else { @($FrontendPort) }
foreach ($port in $ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Open the running application or choose another port."
    }
}
if ($WithBackend -and -not (Test-Path -LiteralPath (Join-Path $backendPath '.env'))) {
    throw 'Configure backend/.env first. See README.md.'
}
$env:PUBLIC_URL = "http://localhost:$FrontendPort"
$env:ALLOWED_ORIGINS = "[`"http://localhost:$FrontendPort`",`"http://127.0.0.1:$FrontendPort`"]"
$cluster = Join-Path $dataPath 'postgres'
if ($WithBackend -and (Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION')) -and -not (Get-NetTCPConnection -LocalPort 5543 -State Listen -ErrorAction SilentlyContinue)) {
    $pgCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if (-not $pgCommand) {throw 'Start the configured PostgreSQL database before running this script.'}
    # Launch in its own hidden console so closing this window does not kill PostgreSQL.
    $pgStart = Start-Process -FilePath $pgCommand.Source -ArgumentList '-D',('"' + $cluster + '"'),'-l',('"' + (Join-Path $dataPath 'postgres.log') + '"'),'-w','start' -WindowStyle Hidden -PassThru
    $pgStart.WaitForExit()
    if ($pgStart.ExitCode -ne 0) {throw 'PostgreSQL did not start. Inspect data/postgres.log.'}
}
if ($WithBackend) {
Push-Location $backendPath
try {
    & uv sync --frozen
    if ($LASTEXITCODE -ne 0) {throw 'Backend dependency installation failed.'}
    & uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {throw 'Database migration failed.'}
} finally {Pop-Location}
}
$envLocalPath = Join-Path $frontendPath '.env.local'
# Keep these as arrays. A one-item array returned from `if` becomes a plain string, and then `+` glued every
# setting into ONE space-separated line (that broke .env.local in the default mode). `@(...)` prevents both
# that and `-notmatch` returning True/False instead of lines when the file has a single line.
$existingEnv = @(if (Test-Path $envLocalPath) { @(Get-Content $envLocalPath) -notmatch '^(BACKEND_INTERNAL_URL|NEXT_PUBLIC_WS_URL|NEXT_PUBLIC_LIVE_TRANSPORT)=' })
$modeLines = @(if ($WithBackend) { "BACKEND_INTERNAL_URL=http://127.0.0.1:$BackendPort"; "NEXT_PUBLIC_WS_URL=ws://localhost:$BackendPort" } else { "NEXT_PUBLIC_LIVE_TRANSPORT=browser" })
$envLines = @($modeLines) + @($existingEnv)
Set-Content -LiteralPath $envLocalPath -Value ($envLines -join "`n")
Push-Location $frontendPath
try {
    if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) {throw 'Frontend dependency installation failed.'}
    }
    $origPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Output "Retrying frontend build to continue past advisory..."
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    }
    $ErrorActionPreference = $origPref
    # output: "standalone" leaves out the CSS/JS bundles (.next/static) and public/; without them every page
    # loads unstyled and without JavaScript. Next.js documents copying them next to server.js after each build.
    $standaloneRoot = Join-Path $frontendPath '.next\standalone'
    if (Test-Path $standaloneRoot) {
        $staticTarget = Join-Path $standaloneRoot '.next\static'
        $publicTarget = Join-Path $standaloneRoot 'public'
        foreach ($target in @($staticTarget, $publicTarget)) { if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force } }
        Copy-Item -LiteralPath (Join-Path $frontendPath '.next\static') -Destination $staticTarget -Recurse
        if (Test-Path (Join-Path $frontendPath 'public')) { Copy-Item -LiteralPath (Join-Path $frontendPath 'public') -Destination $publicTarget -Recurse }
    }
} finally {Pop-Location}
$backend = $null; $worker = $null
if ($WithBackend) {
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
$backend = Start-Process -FilePath $pythonPath -ArgumentList '-m','scripts.run_local','--port',"$BackendPort" -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'backend-out.log') -RedirectStandardError (Join-Path $dataPath 'backend-error.log') -PassThru
$worker = Start-Process -FilePath $pythonPath -ArgumentList '-m','app.services.worker' -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'worker-out.log') -RedirectStandardError (Join-Path $dataPath 'worker-error.log') -PassThru
}
$nodePath = (Get-Command node.exe).Source
# The standalone server.js reads env files only from .next\standalone, which has none, so server-only secrets
# (GEMINI_API_KEY, Cashfree...) were missing and live answers failed. Pass .env.local as process environment
# instead of copying the secrets file into build output (which a Docker image could ship).
if (Test-Path $envLocalPath) {
    foreach ($line in @(Get-Content $envLocalPath)) {
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
        $name = $Matches[1]; $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
        if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
}
$standaloneServer = Join-Path $frontendPath '.next\standalone\server.js'
if (Test-Path $standaloneServer) {
    $env:PORT = "$FrontendPort"
    $env:HOSTNAME = "127.0.0.1"
    $frontend = Start-Process -FilePath $nodePath -ArgumentList ('"' + $standaloneServer + '"') -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'frontend-out.log') -RedirectStandardError (Join-Path $dataPath 'frontend-error.log') -PassThru
} else {
    $nextPath = Join-Path $frontendPath 'node_modules\next\dist\bin\next'
    $frontend = Start-Process -FilePath $nodePath -ArgumentList ('"' + $nextPath + '"'),'start','--hostname','127.0.0.1','--port',"$FrontendPort" -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'frontend-out.log') -RedirectStandardError (Join-Path $dataPath 'frontend-error.log') -PassThru
}
@{backend=$(if ($backend) { $backend.Id } else { $null }); worker=$(if ($worker) { $worker.Id } else { $null }); frontend=$frontend.Id} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataPath 'local-processes.json')
Write-Output "InterviewPilot Live: http://localhost:$FrontendPort"
if ($WithBackend) { Write-Output "API documentation: http://localhost:$BackendPort/api/docs" } else { Write-Output 'Mode: same as the hosted site (no local backend). Use -WithBackend for the FastAPI pipeline.' }
Write-Output 'Process IDs and service logs are saved under data/. Stop these specific processes when finished.'
