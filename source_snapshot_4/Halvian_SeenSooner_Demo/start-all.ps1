[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDirectory = Join-Path $Root '.seensooner-runtime'
$StateFile = Join-Path $RuntimeDirectory 'processes.json'
$LogDirectory = Join-Path $Root 'logs\unified-launch'
$LaunchLog = Join-Path $LogDirectory 'start-last-run.log'

$Services = @(
    [pscustomobject]@{ Name = 'Python API'; Key = 'api'; Port = 8000; Url = 'http://127.0.0.1:8000/api/health'; DisplayUrl = 'http://127.0.0.1:8000/api/health'; Kind = 'python'; Directory = 'backend' },
    [pscustomobject]@{ Name = 'Patient App'; Key = 'patient'; Port = 5173; Url = 'http://127.0.0.1:5173/'; DisplayUrl = 'http://127.0.0.1:5173/'; Kind = 'vite'; Directory = 'patient-app' },
    [pscustomobject]@{ Name = 'Nurse Dashboard'; Key = 'nurse'; Port = 5174; Url = 'http://127.0.0.1:5174/'; DisplayUrl = 'http://127.0.0.1:5174/'; Kind = 'vite'; Directory = 'nurse-app' },
    [pscustomobject]@{ Name = 'Waiting Room Display'; Key = 'display'; Port = 5175; Url = 'http://127.0.0.1:5175/'; DisplayUrl = 'http://127.0.0.1:5175/'; Kind = 'vite'; Directory = 'display-app' },
    [pscustomobject]@{ Name = 'AI Oversight Dashboard'; Key = 'oversight'; Port = 5176; Url = 'http://127.0.0.1:5176/'; DisplayUrl = 'http://127.0.0.1:5176/'; Kind = 'vite'; Directory = 'oversight-dashboard' }
)

function Test-PortInUse {
    param([int]$Port)
    return [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port
}

function Test-UrlReady {
    param([string]$Url, [int]$TimeoutSeconds = 2)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Wait-ForUrl {
    param([string]$Name, [string]$Url, [int]$TimeoutSeconds = 60)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-UrlReady -Url $Url) {
            return
        }
        Start-Sleep -Milliseconds 400
    }
    throw "$Name did not become ready within $TimeoutSeconds seconds. Check logs\unified-launch for details."
}

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

function Save-State {
    param([array]$Entries)
    $state = [ordered]@{
        schemaVersion = 1
        projectRoot = $Root
        startedAtUtc = [DateTime]::UtcNow.ToString('o')
        services = $Entries
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Stop-StartedProcesses {
    param([array]$Entries)
    foreach ($entry in @($Entries | Sort-Object { $_.pid } -Descending)) {
        if (Test-TrackedProcess -Entry $entry) {
            & "$env:SystemRoot\System32\taskkill.exe" /PID ([string]$entry.pid) /T /F 2>$null | Out-Null
        }
    }
}

function Assert-CorsAccess {
    param([string]$Name, [string]$Origin, [string]$Path = '/api/public/queue')
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000$Path" -Headers @{ Origin = $Origin } -UseBasicParsing -TimeoutSec 5
        $allowedOrigin = [string]$response.Headers['Access-Control-Allow-Origin']
        if ($response.StatusCode -ne 200 -or $allowedOrigin -ne $Origin) {
            throw "Unexpected API response or CORS header."
        }
    }
    catch {
        throw "$Name could not verify access to the shared Python API from origin $Origin. $($_.Exception.Message)"
    }
}

New-Item -ItemType Directory -Force -Path $RuntimeDirectory, $LogDirectory | Out-Null
Set-Location -LiteralPath $Root

$venvPython = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    throw 'Python dependencies are not set up. Run .\setup-all.ps1 first.'
}
$nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 20.19 or newer, then run .\setup-all.ps1.'
}

foreach ($service in $Services | Where-Object Kind -eq 'vite') {
    $viteFile = Join-Path $Root "$($service.Directory)\node_modules\vite\bin\vite.js"
    if (-not (Test-Path -LiteralPath $viteFile -PathType Leaf)) {
        throw "Missing Node.js dependencies for $($service.Name). Run .\setup-all.ps1 first."
    }
}

if (Test-Path -LiteralPath $StateFile -PathType Leaf) {
    $existingState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    if (-not [string]::Equals([string]$existingState.projectRoot, $Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "The runtime state belongs to a different project path. Remove only this project's .seensooner-runtime directory after reviewing it."
    }
    $validEntries = @($existingState.services | Where-Object { Test-TrackedProcess -Entry $_ })
    if ($validEntries.Count -eq $Services.Count) {
        $allReady = $true
        foreach ($service in $Services) {
            if (-not (Test-UrlReady -Url $service.Url)) { $allReady = $false }
        }
        if ($allReady) {
            Write-Host 'SeenSooner is already running from this project.' -ForegroundColor Green
            $Services | Select-Object Name, DisplayUrl | Format-Table -AutoSize
            exit 0
        }
    }
    if ($validEntries.Count -gt 0) {
        throw 'Some tracked SeenSooner services are still running. Run .\stop-all.ps1, then retry.'
    }
    Remove-Item -LiteralPath $StateFile -Force
}

$conflicts = @($Services | Where-Object { Test-PortInUse -Port $_.Port })
if ($conflicts.Count -gt 0) {
    $details = ($conflicts | ForEach-Object { "$($_.Name) requires port $($_.Port)" }) -join '; '
    throw "Startup stopped because required ports are already in use: $details. No process was terminated."
}

$started = @()
try {
    foreach ($service in $Services) {
        $workingDirectory = Join-Path $Root $service.Directory
        $stdout = Join-Path $LogDirectory "$($service.Key).out.log"
        $stderr = Join-Path $LogDirectory "$($service.Key).err.log"
        if ($service.Kind -eq 'python') {
            $filePath = $venvPython
            $argumentList = @('-u', 'server.py', '--host', '127.0.0.1', '--port', [string]$service.Port)
        }
        else {
            $filePath = $nodeCommand.Source
            $viteFile = Join-Path $workingDirectory 'node_modules\vite\bin\vite.js'
            $argumentList = @(('"{0}"' -f $viteFile), '--host', '127.0.0.1', '--port', [string]$service.Port, '--strictPort')
        }

        Write-Host "Starting $($service.Name) on port $($service.Port)..."
        $process = Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $workingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
        Start-Sleep -Milliseconds 250
        if ($process.HasExited) {
            $errorText = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Raw).Trim() } else { '' }
            throw "$($service.Name) exited during startup. $errorText"
        }
        $entry = [pscustomobject]@{
            name = $service.Name
            key = $service.Key
            pid = $process.Id
            executable = $process.Path
            startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
            startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
            port = $service.Port
            url = $service.DisplayUrl
            stdoutLog = $stdout
            stderrLog = $stderr
        }
        $started += $entry
        Save-State -Entries $started
    }

    foreach ($service in $Services) {
        Wait-ForUrl -Name $service.Name -Url $service.Url
    }

    Assert-CorsAccess -Name 'Patient App' -Origin 'http://127.0.0.1:5173'
    Assert-CorsAccess -Name 'Nurse Dashboard' -Origin 'http://127.0.0.1:5174'
    Assert-CorsAccess -Name 'Waiting Room Display' -Origin 'http://127.0.0.1:5175'
    Assert-CorsAccess -Name 'AI Oversight Dashboard' -Origin 'http://127.0.0.1:5176' -Path '/api/oversight/summary'

    $lines = @(
        'SeenSooner unified startup completed successfully.'
        "Completed (local time): $([DateTimeOffset]::Now.ToString('o'))"
        'Python API: http://127.0.0.1:8000/api/health'
        'Patient App: http://127.0.0.1:5173/'
        'Nurse Dashboard: http://127.0.0.1:5174/'
        'Waiting Room Display: http://127.0.0.1:5175/'
        'AI Oversight Dashboard: http://127.0.0.1:5176/'
        'All four frontends passed their shared-API CORS checks.'
        'The oversight dashboard receives aggregate-only runtime, model-evaluation, target, and scenario context; its monthly chart fixtures remain illustrative.'
        'Stop command: .\stop-all.ps1'
    )
    $lines | Set-Content -LiteralPath $LaunchLog -Encoding UTF8

    Write-Host ''
    Write-Host 'All SeenSooner services are ready.' -ForegroundColor Green
    $Services | Select-Object Name, DisplayUrl | Format-Table -AutoSize
    Write-Host 'Shared API connectivity: PASS for all four frontends.'
    Write-Host 'Oversight data mode: aggregate backend context plus separately labelled illustrative monthly fixtures.'
    Write-Host 'Stop command: .\stop-all.ps1'
}
catch {
    Stop-StartedProcesses -Entries $started
    if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile -Force }
    throw "Unified startup failed. $($_.Exception.Message)"
}
