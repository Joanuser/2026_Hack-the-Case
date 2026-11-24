$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    throw "Missing .venv. Run this first: .\setup-demo.ps1"
}
& ".venv\Scripts\python.exe" ".\start_demo.py"
