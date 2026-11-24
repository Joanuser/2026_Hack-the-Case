$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

python --version
node --version
npm --version

if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    python -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"

foreach ($App in @("patient-app", "display-app", "nurse-app")) {
    Push-Location -LiteralPath $App
    try {
        npm ci
    }
    finally {
        Pop-Location
    }
}

Write-Host "Setup complete. Next command: .\start-demo.ps1"
