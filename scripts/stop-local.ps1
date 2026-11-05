param()
$ErrorActionPreference = 'Continue'
$taskRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $taskRoot 'data'
$procFile = Join-Path $dataPath 'local-processes.json'

if (Test-Path $procFile) {
    try {
        $procs = Get-Content $procFile -Raw | ConvertFrom-Json
        foreach ($prop in $procs.PSObject.Properties) {
            $id = $prop.Value
            if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
                Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
                Write-Output "Stopped $($prop.Name) (PID: $id)"
            }
        }
    } catch {
        Write-Warning "Could not parse $procFile"
    }
}

# Ensure listeners on 3001, 8001 are stopped
foreach ($port in @(3001, 8001)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped process on port $port (PID: $($c.OwningProcess))"
        }
    }
}

# Stop PostgreSQL cleanly if running on 5543
$cluster = Join-Path $dataPath 'postgres'
if (Get-NetTCPConnection -LocalPort 5543 -State Listen -ErrorAction SilentlyContinue) {
    $pgCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($pgCommand -and (Test-Path $cluster)) {
        & $pgCommand.Source -D $cluster stop -m fast
        Write-Output "Stopped PostgreSQL database."
    }
}
Write-Output "All local services stopped."
