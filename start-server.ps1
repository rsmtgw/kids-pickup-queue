# Starts uvicorn as a detached background process independent of this terminal.
# The server survives screen lock, VS Code close, and terminal exit.
# Logs go to backend\logs.txt (same as before).

param(
    [int]$Port = 8000,
    [switch]$Stop
)

$PidFile = "$PSScriptRoot\backend\server.pid"
$UvicornExe = "$PSScriptRoot\.venv\Scripts\uvicorn.exe"
$BackendDir = "$PSScriptRoot\backend"

if ($Stop) {
    if (Test-Path $PidFile) {
        $pid = Get-Content $PidFile
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Remove-Item $PidFile -Force
        Write-Host "Server (PID $pid) stopped."
    } else {
        Write-Host "No PID file found. Checking port $Port..."
        $tcp = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($tcp) {
            $owning = $tcp.OwningProcess | Select-Object -First 1
            Stop-Process -Id $owning -Force
            Write-Host "Killed PID $owning on port $Port."
        } else {
            Write-Host "No process on port $Port."
        }
    }
    exit
}

# Check if already running
if (Test-Path $PidFile) {
    $existingPid = Get-Content $PidFile
    $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Server already running (PID $existingPid). Use -Stop to stop it first."
        exit
    }
    Remove-Item $PidFile -Force
}

$proc = Start-Process `
    -FilePath $UvicornExe `
    -ArgumentList "main:app --port $Port" `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -PassThru

$proc.Id | Out-File $PidFile -Encoding ascii
Write-Host "Server started (PID $($proc.Id)) on port $Port."
Write-Host "To stop: .\start-server.ps1 -Stop"
