#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs/unified-launch"
SETUP_LOG="$LOG_DIR/setup-last-run.log"
mkdir -p "$LOG_DIR"

if command -v python3 >/dev/null 2>&1; then
  SYSTEM_PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  SYSTEM_PYTHON="$(command -v python)"
else
  echo "Python 3.11 or newer was not found." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "Node.js 20.19 or newer was not found." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm was not found." >&2; exit 1; }

"$SYSTEM_PYTHON" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major<20 || (major===20 && minor<19)) throw new Error("Node.js 20.19 or newer is required")'

echo "SeenSooner unified setup"
echo "Project root: $ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  VENV_PYTHON="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/.venv/Scripts/python.exe" ]]; then
  VENV_PYTHON="$ROOT/.venv/Scripts/python.exe"
else
  echo "Creating the local Python virtual environment..."
  "$SYSTEM_PYTHON" -m venv "$ROOT/.venv"
  VENV_PYTHON="$ROOT/.venv/bin/python"
fi
"$VENV_PYTHON" -m pip install --upgrade pip
"$VENV_PYTHON" -m pip install -r "$ROOT/backend/requirements.txt"

for application in patient-app nurse-app display-app oversight-dashboard; do
  [[ -f "$ROOT/$application/package-lock.json" ]] || { echo "Missing package lock file for $application." >&2; exit 1; }
  echo "Installing locked Node.js dependencies for $application..."
  (cd "$ROOT/$application" && npm ci --no-audit --no-fund)
done

write_env_if_missing() {
  local path="$1"
  shift
  if [[ ! -f "$path" ]]; then
    printf '%s\n' "$@" > "$path"
    echo "Created local demo configuration: ${path#"$ROOT/"}"
  fi
}

write_env_if_missing "$ROOT/patient-app/.env.local" \
  'VITE_API_MODE=http' \
  'VITE_API_BASE_URL=http://127.0.0.1:8000' \
  'VITE_MOCK_BACKEND=false' \
  'VITE_SITE_CODES=ED-MAIN'
write_env_if_missing "$ROOT/nurse-app/.env.local" \
  'VITE_API_MODE=http' \
  'VITE_API_BASE_URL=http://127.0.0.1:8000' \
  'VITE_MOCK_BACKEND=false' \
  'VITE_STAFF_API_TOKEN=demo-staff-token' \
  'VITE_STAFF_NAME=Demo triage nurse' \
  'VITE_BACKEND_LABEL=Local W2 API'
write_env_if_missing "$ROOT/display-app/.env.local" \
  'VITE_API_MODE=http' \
  'VITE_API_BASE_URL=http://127.0.0.1:8000' \
  'VITE_MOCK_BACKEND=false' \
  'VITE_DEPARTMENT_NAME=Treatment-room waiting queue'
write_env_if_missing "$ROOT/oversight-dashboard/.env.local" \
  'VITE_API_BASE_URL=http://127.0.0.1:8000'

{
  echo "SeenSooner unified setup completed successfully."
  echo "Completed (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Python: $($SYSTEM_PYTHON --version 2>&1)"
  echo "Node.js: $(node --version)"
  echo "npm: $(npm --version)"
  echo "Installed frontend dependencies: patient-app, nurse-app, display-app, oversight-dashboard"
  echo "Ensured local demo environment files exist for API port 8000."
  echo "No model training, data regeneration, or deployment build was performed."
  echo "Next command: ./start-all.sh"
} > "$SETUP_LOG"

echo "Setup completed successfully."
echo "Next command: ./start-all.sh"
echo "Setup summary: $SETUP_LOG"
