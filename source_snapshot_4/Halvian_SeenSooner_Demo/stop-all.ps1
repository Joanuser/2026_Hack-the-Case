[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDirectory = Join-Path $Root '.seensooner-runtime'
$StateFile = Join-Path $RuntimeDirectory 'processes.json'
$LogDirectory = Join-Path $Root 'logs\unified-launch'
$StopLog = Join-Path $LogDirectory 'stop-last-run.log'

function Test-TrackedProcess {
    param($Entry)
    $process = Get-Process -Id ([int]$Entry.pid) -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    try {
        $actualStart = $process.StartTime.ToUniversalTime()
        if ($Entry.PSObject.Properties.Name -contains 'startTimeUtcTicks') {
            $startMatches = [Math]::Abs($actualStart.Ticks - [int64]$Entry.startTimeUtcTicks) -lt (2 * [TimeSpan]::TicksPerSecond)
        }
        else {
            $expectedStart = [DateTimeOffset]::Parse([string]$Entry.startedAtUtc).UtcDateTime
            $startMatches = [Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -lt 2
        }
        $pathMatches = [System.IO.Path]::GetFullPath($process.Path).Equals([System.IO.Path]::GetFullPath($Entry.executable), [System.StringComparison]::OrdinalIgnoreCase)
        return $startMatches -and $pathMatches
    }
    catch {
        return $false
    }
}

function Test-PortInUse {
    param([int]$Port)
    return [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
Set-Location -LiteralPath $Root

if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) {
    Write-Host 'No SeenSooner runtime state was found. Nothing was stopped.'
    exit 0
}

$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
if (-not [string]::Equals([string]$state.projectRoot, $Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The runtime state belongs to a different project path. No process was stopped.'
}

$stopped = @()
$alreadyExited = @()
$skipped = @()
$failed = @()

foreach ($entry in @($state.services | Sort-Object { [int]$_.port } -Descending)) {
    $process = Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue
    if (-not $process) {
        $alreadyExited += $entry.name
        continue
    }
    if (-not (Test-TrackedProcess -Entry $entry)) {
        $skipped += "$($entry.name) (PID $($entry.pid) no longer matches the tracked executable and start time)"
        continue
    }
    try {
        & "$env:SystemRoot\System32\taskkill.exe" /PID ([string]$entry.pid) /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue)) {
            throw "taskkill exited with code $LASTEXITCODE"
        }
        $process.WaitForExit(10000) | Out-Null
        if (Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue) {
            $failed += "$($entry.name) (PID $($entry.pid))"
        }
        else {
            $stopped += "$($entry.name) (PID $($entry.pid))"
        }
    }
    catch {
        $failed += "$($entry.name) (PID $($entry.pid)): $($_.Exception.Message)"
    }
}

if ($failed.Count -eq 0 -and $skipped.Count -eq 0) {
    Remove-Item -LiteralPath $StateFile -Force
}

$portNotes = @()
foreach ($port in @(8000, 5173, 5174, 5175, 5176)) {
    if (Test-PortInUse -Port $port) {
        $portNotes += "Port $port remains in use. It was not terminated because it is not a verified tracked SeenSooner process."
    }
}

$lines = @(
    'SeenSooner unified stop result.'
    "Completed (local time): $([DateTimeOffset]::Now.ToString('o'))"
    "Stopped: $(if ($stopped.Count) { $stopped -join '; ' } else { 'none' })"
    "Already exited: $(if ($alreadyExited.Count) { $alreadyExited -join '; ' } else { 'none' })"
    "Skipped for safety: $(if ($skipped.Count) { $skipped -join '; ' } else { 'none' })"
    "Failures: $(if ($failed.Count) { $failed -join '; ' } else { 'none' })"
    "Port notes: $(if ($portNotes.Count) { $portNotes -join '; ' } else { 'all five project ports are free' })"
)
$lines | Set-Content -LiteralPath $StopLog -Encoding UTF8

foreach ($line in $lines) { Write-Host $line }

if ($failed.Count -gt 0) {
    throw 'One or more verified SeenSooner processes could not be stopped. Review the stop log before retrying.'
}
if ($skipped.Count -gt 0) {
    throw 'One or more PIDs were skipped because identity verification failed. No unverified process was terminated; the runtime state was retained for investigation.'
}
Write-Host 'Unified shutdown completed.' -ForegroundColor Green
