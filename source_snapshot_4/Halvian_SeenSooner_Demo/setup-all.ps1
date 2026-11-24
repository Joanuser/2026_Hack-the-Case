[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDirectory = Join-Path $Root 'logs\unified-launch'
$SetupLog = Join-Path $LogDirectory 'setup-last-run.log'

function Get-RequiredCommand {
    param([string]$Name, [string]$InstallHint)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found. $InstallHint"
    }
    return $command
}

function Convert-ToVersion {
    param([string]$Text, [string]$ToolName)
    if ($Text -notmatch '(\d+\.\d+(?:\.\d+)?)') {
        throw "Could not parse the $ToolName version from: $Text"
    }
    return [version]$Matches[1]
}

function Invoke-NativeCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE. Review the command output above, correct the issue, and rerun .\setup-all.ps1."
    }
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
Set-Location -LiteralPath $Root

Write-Host 'SeenSooner unified setup'
Write-Host "Project root: $Root"

$pythonCommand = Get-RequiredCommand -Name 'python' -InstallHint 'Install Python 3.11 or newer, then reopen PowerShell.'
$nodeCommand = Get-RequiredCommand -Name 'node' -InstallHint 'Install Node.js 20.19 or newer, then reopen PowerShell.'
$npmCommand = Get-RequiredCommand -Name 'npm.cmd' -InstallHint 'Install Node.js 20.19 or newer, then reopen PowerShell.'

$pythonText = (& $pythonCommand.Source --version 2>&1 | Out-String).Trim()
$nodeText = (& $nodeCommand.Source --version 2>&1 | Out-String).Trim()
$npmText = (& $npmCommand.Source --version 2>&1 | Out-String).Trim()
$pythonVersion = Convert-ToVersion -Text $pythonText -ToolName 'Python'
$nodeVersion = Convert-ToVersion -Text $nodeText -ToolName 'Node.js'

if ($pythonVersion -lt [version]'3.11') {
    throw "Python 3.11 or newer is required. Found $pythonVersion."
}
if ($nodeVersion -lt [version]'20.19') {
    throw "Node.js 20.19 or newer is required. Found $nodeVersion."
}

Write-Host "Python: $pythonText"
Write-Host "Node.js: $nodeText"
Write-Host "npm: $npmText"

$venvPython = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    Write-Host 'Creating the local Python virtual environment...'
    Invoke-NativeCommand -FilePath $pythonCommand.Source -Arguments @('-m', 'venv', (Join-Path $Root '.venv')) -Description 'Python virtual-environment creation'
}

Write-Host 'Installing Python dependencies...'
Invoke-NativeCommand -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip') -Description 'pip upgrade'
Invoke-NativeCommand -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '-r', (Join-Path $Root 'backend\requirements.txt')) -Description 'Python dependency installation'

$applications = @('patient-app', 'nurse-app', 'display-app', 'oversight-dashboard')
foreach ($application in $applications) {
    $applicationPath = Join-Path $Root $application
    $lockFile = Join-Path $applicationPath 'package-lock.json'
    if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
        throw "Missing package lock file: $lockFile"
    }
    Write-Host "Installing locked Node.js dependencies for $application..."
    Push-Location -LiteralPath $applicationPath
    try {
        Invoke-NativeCommand -FilePath $npmCommand.Source -Arguments @('ci', '--no-audit', '--no-fund') -Description "Node.js dependency installation for $application"
    }
    finally {
        Pop-Location
    }
}

$localEnvironmentFiles = @{
    'patient-app\.env.local' = @(
        'VITE_API_MODE=http'
        'VITE_API_BASE_URL=http://127.0.0.1:8000'
        'VITE_MOCK_BACKEND=false'
        'VITE_SITE_CODES=ED-MAIN'
    )
    'nurse-app\.env.local' = @(
        'VITE_API_MODE=http'
        'VITE_API_BASE_URL=http://127.0.0.1:8000'
        'VITE_MOCK_BACKEND=false'
        'VITE_STAFF_API_TOKEN=demo-staff-token'
        'VITE_STAFF_NAME=Demo triage nurse'
        'VITE_BACKEND_LABEL=Local W2 API'
    )
    'display-app\.env.local' = @(
        'VITE_API_MODE=http'
        'VITE_API_BASE_URL=http://127.0.0.1:8000'
        'VITE_MOCK_BACKEND=false'
        'VITE_DEPARTMENT_NAME=Treatment-room waiting queue'
    )
    'oversight-dashboard\.env.local' = @(
        'VITE_API_BASE_URL=http://127.0.0.1:8000'
    )
}
foreach ($relativePath in $localEnvironmentFiles.Keys) {
    $environmentPath = Join-Path $Root $relativePath
    if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
        $localEnvironmentFiles[$relativePath] | Set-Content -LiteralPath $environmentPath -Encoding UTF8
        Write-Host "Created local demo configuration: $relativePath"
    }
}

$summary = @(
    'SeenSooner unified setup completed successfully.'
    "Completed (local time): $([DateTimeOffset]::Now.ToString('o'))"
    "Python: $pythonText"
    "Node.js: $nodeText"
    "npm: $npmText"
    'Installed frontend dependencies: patient-app, nurse-app, display-app, oversight-dashboard'
    'Ensured local demo environment files exist for API port 8000.'
    'No model training, data regeneration, or production build was performed.'
    'Next command: .\start-all.ps1'
)
$summary | Set-Content -LiteralPath $SetupLog -Encoding UTF8

Write-Host ''
Write-Host 'Setup completed successfully.' -ForegroundColor Green
Write-Host 'Next command: .\start-all.ps1'
Write-Host "Setup summary: $SetupLog"
