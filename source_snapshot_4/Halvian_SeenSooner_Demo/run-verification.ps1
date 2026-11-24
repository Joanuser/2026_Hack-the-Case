$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    throw "Missing .venv. Run this first: .\setup-demo.ps1"
}

& ".venv\Scripts\python.exe" ".\verify_manifest.py"
& ".venv\Scripts\python.exe" "backend\run_integration_tests.py"
& ".venv\Scripts\python.exe" "simulation\validate_simulation_outputs.py" --out-dir "simulation\outputs_fixed"
foreach ($App in @("patient-app", "display-app", "nurse-app")) {
    Push-Location -LiteralPath $App
    try {
        npm run build
    }
    finally {
        Pop-Location
    }
}
& ".venv\Scripts\python.exe" ".\build_manifest.py"
Write-Host "All verification checks completed; manifest refreshed for locally regenerated evidence."
