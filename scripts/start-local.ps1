param([int]$FrontendPort=3001, [int]$BackendPort=8001)
$ErrorActionPreference='Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $taskRoot 'backend'
$frontendPath = Join-Path $taskRoot 'frontend'
$dataPath = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
foreach ($port in @($FrontendPort,$BackendPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Open the running application or choose another port."
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $backendPath '.env'))) {
    throw 'Configure backend/.env first. See README.md.'
}
$env:PUBLIC_URL = "http://localhost:$FrontendPort"
$env:ALLOWED_ORIGINS = "[`"http://localhost:$FrontendPort`",`"http://127.0.0.1:$FrontendPort`"]"
$cluster = Join-Path $dataPath 'postgres'
if ((Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION')) -and -not (Get-NetTCPConnection -LocalPort 5543 -State Listen -ErrorAction SilentlyContinue)) {
    $pgCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if (-not $pgCommand) {throw 'Start the configured PostgreSQL database before running this script.'}
    & $pgCommand.Source -D $cluster -l (Join-Path $dataPath 'postgres.log') -w start
    if ($LASTEXITCODE -ne 0) {throw 'PostgreSQL did not start. Inspect data/postgres.log.'}
}
Push-Location $backendPath
try {
    & uv sync --frozen
    if ($LASTEXITCODE -ne 0) {throw 'Backend dependency installation failed.'}
    & uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {throw 'Database migration failed.'}
} finally {Pop-Location}
$envLocalPath = Join-Path $frontendPath '.env.local'
$existingEnv = if (Test-Path $envLocalPath) { (Get-Content $envLocalPath) -notmatch '^(BACKEND_INTERNAL_URL|NEXT_PUBLIC_WS_URL)=' } else { @() }
$envLines = @("BACKEND_INTERNAL_URL=http://127.0.0.1:$BackendPort", "NEXT_PUBLIC_WS_URL=ws://localhost:$BackendPort") + $existingEnv
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
} finally {Pop-Location}
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
$backend = Start-Process -FilePath $pythonPath -ArgumentList '-m','scripts.run_local','--port',"$BackendPort" -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'backend-out.log') -RedirectStandardError (Join-Path $dataPath 'backend-error.log') -PassThru
$worker = Start-Process -FilePath $pythonPath -ArgumentList '-m','app.services.worker' -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'worker-out.log') -RedirectStandardError (Join-Path $dataPath 'worker-error.log') -PassThru
$nextPath = Join-Path $frontendPath 'node_modules\next\dist\bin\next'
$nodePath = (Get-Command node.exe).Source
$frontend = Start-Process -FilePath $nodePath -ArgumentList ('"' + $nextPath + '"'),'start','--hostname','127.0.0.1','--port',"$FrontendPort" -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'frontend-out.log') -RedirectStandardError (Join-Path $dataPath 'frontend-error.log') -PassThru
@{backend=$backend.Id; worker=$worker.Id; frontend=$frontend.Id} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataPath 'local-processes.json')
Write-Output "InterviewPilot Live: http://localhost:$FrontendPort"
Write-Output "API documentation: http://localhost:$BackendPort/api/docs"
Write-Output 'Process IDs and service logs are saved under data/. Stop these specific processes when finished.'
